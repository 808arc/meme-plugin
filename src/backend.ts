/** Server side of the meme plugin: owns settings, the meme pool, the cooldown
 * record, cached templates and every model call. Writes only under ctx.dataDirectory. */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
	PluginBackendContext,
	PluginModelSpec,
} from "learnharness-plugin-api";
import { MAX_CONTEXT_LENGTH, MAX_PROMPT_LENGTH } from "./concept.ts";
import {
	FACT_CHECK,
	type MemeStage,
	PICK_STEP,
	STAGE_TOPIC,
} from "./config.ts";
import {
	agreementRequest,
	parseAgreement,
	parseAnswer,
	quickAgreement,
} from "./factcheck.ts";
import { loadImage } from "./images.ts";
import { loadCustomMemes, memegenMemes } from "./library.ts";
import {
	extractJson,
	fillRequest,
	type ModelRequest,
	PROMPT_VERSION,
	pickRequest,
	templateRequest,
} from "./prompts.ts";
import {
	chooseReuse,
	conceptKey,
	mayReuse,
	newEntry,
	rateGenerated,
	readGenerated,
	readRating,
	recordFresh,
	recordReuse,
	type StoredMeme,
	writeGenerated,
} from "./reuse.ts";
import { coolingDown, pickMeme, recordUse, shortlist } from "./scheduler.ts";
import { applySettingsPatch, readSettings } from "./settings.ts";
import { assemble, parseFilling, parseTemplate } from "./template.ts";
import type {
	Concept,
	Filling,
	GeneratedMeme,
	Meme,
	MemeImage,
	PluginState,
	Settings,
	Template,
	Usage,
} from "./types.ts";

const STATE_VERSION = 1;
const STATE_FILE = "state.json";
/** A meme whose caption cannot be templated is skipped; try this many before giving up. */
const MEME_ATTEMPTS = 3;
const MAX_OUTPUT_TOKENS = 2048;

interface CachedTemplate extends Template {
	captionHash: string;
	promptVersion: number;
}
interface Stored {
	version: number;
	settings: Settings;
	usage: Record<string, Usage>;
	templates: Record<string, CachedTemplate>;
}

/** The model answered, but not with something the plugin can accept. */
class RejectedReply extends Error {}

function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected an operation input object.");
	return value as Record<string, unknown>;
}

function readState(file: string): Stored {
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return {
				version: STATE_VERSION,
				settings: readSettings(undefined),
				usage: {},
				templates: {},
			};
		throw new Error(
			`Meme plugin could not read ${STATE_FILE}: ${(error as Error).message}`,
		);
	}
	const stored = object(raw);
	// Never rewrite a format this build does not understand.
	if (stored.version !== STATE_VERSION)
		throw new Error(
			`Meme plugin data has format ${String(stored.version)}; this version reads format ${STATE_VERSION}.`,
		);
	const usage: Record<string, Usage> = {};
	for (const [id, entry] of Object.entries(
		stored.usage && typeof stored.usage === "object" ? stored.usage : {},
	)) {
		const item = entry as Partial<Usage> | null;
		if (
			item &&
			Number.isInteger(item.uses) &&
			Number.isFinite(item.lastUsedAt) &&
			Number.isFinite(item.dueAt)
		)
			usage[id] = {
				uses: item.uses!,
				lastUsedAt: item.lastUsedAt!,
				dueAt: item.dueAt!,
			};
	}
	const templates = (
		stored.templates &&
		typeof stored.templates === "object" &&
		!Array.isArray(stored.templates)
			? stored.templates
			: {}
	) as Record<string, CachedTemplate>;
	return {
		version: STATE_VERSION,
		settings: readSettings(stored.settings),
		usage,
		templates,
	};
}

export function activate(ctx: PluginBackendContext): () => void {
	const file = path.join(ctx.dataDirectory, STATE_FILE);
	let state = readState(file);
	let disposed = false;
	let generating = false;
	/** Memes the current model could not template; not retried until the next activation. */
	const unusable = new Set<string>();

	const alive = () => {
		if (disposed || ctx.signal.aborted)
			throw new Error("Meme plugin is disabled.");
	};
	const save = (next: Stored) => {
		alive();
		fs.mkdirSync(ctx.dataDirectory, { recursive: true });
		const temporary = path.join(
			ctx.dataDirectory,
			`.state-${randomUUID()}.tmp`,
		);
		try {
			fs.writeFileSync(temporary, JSON.stringify(next, null, "\t") + "\n", {
				flag: "wx",
				mode: 0o600,
			});
			fs.renameSync(temporary, file);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
		state = next;
	};

	const pool = () => {
		const custom = loadCustomMemes(ctx.dataDirectory);
		const memegen = state.settings.useMemegen
			? memegenMemes(state.settings.imageBaseUrl)
			: [];
		return {
			memes: [...custom.memes, ...memegen],
			custom: custom.memes.length,
			memegen: memegen.length,
			problems: custom.problems,
		};
	};
	const view = (): PluginState => {
		const current = pool(),
			now = Date.now();
		return {
			settings: { ...state.settings },
			pool: {
				memegen: current.memegen,
				custom: current.custom,
				coolingDown: current.memes.filter((meme) =>
					coolingDown(state.usage, meme.id, now),
				).length,
			},
			problems: current.problems,
		};
	};

	async function resolveModel(): Promise<PluginModelSpec> {
		const catalog = await ctx.inference.catalog();
		alive();
		const pin = state.settings.model
			? { model: state.settings.model, thinkingLevel: undefined }
			: catalog.slots.cheap;
		if (!pin?.model)
			throw new Error(
				"Choose a model in the Meme plugin settings, or configure the cheap model slot.",
			);
		if (
			!catalog.models.some(
				(model) =>
					model.provider === pin.model.provider && model.id === pin.model.id,
			)
		)
			throw new Error(
				"The selected meme model is not available. Choose a configured model in the Meme plugin settings.",
			);
		return {
			...pin.model,
			...(pin.thinkingLevel ? { thinkingLevel: pin.thinkingLevel } : {}),
		};
	}

	/** One model exchange that must end in JSON accepted by `parse`. The model gets a
	 * single chance to correct a rejected reply, with the reason. */
	async function ask<T>(
		model: PluginModelSpec,
		request: ModelRequest,
		parse: (raw: unknown) => T,
	): Promise<T> {
		const messages: Parameters<
			typeof ctx.inference.complete
		>[0]["context"]["messages"] = [
			{ role: "user", content: request.user, timestamp: Date.now() },
		];
		for (let attempt = 0; ; attempt++) {
			// The learner clicked the action: user-initiated, never background work.
			const reply = await ctx.inference.complete({
				model,
				purpose: "user",
				context: { systemPrompt: request.systemPrompt, messages },
				options: { maxTokens: MAX_OUTPUT_TOKENS },
				signal: ctx.signal,
			});
			alive();
			if (reply.stopReason === "error" || reply.stopReason === "aborted")
				throw new Error(
					reply.errorMessage ||
						`The model request ${reply.stopReason === "aborted" ? "was cancelled" : "failed"}.`,
				);
			const text = reply.content
				.flatMap((part) => (part.type === "text" ? [part.text] : []))
				.join("");
			try {
				return parse(extractJson(text));
			} catch (error) {
				const reason = (error as Error).message;
				if (attempt >= 1)
					throw new RejectedReply(
						`The model did not produce a usable meme caption: ${reason}`,
					);
				messages.push(reply, {
					role: "user",
					content: `That reply cannot be used: ${reason}. Reply again with only the corrected JSON object.`,
					timestamp: Date.now(),
				});
			}
		}
	}

	/** Step 2: the model picks among memes that are not cooling down (cooldown is the
	 * filter). If its answer is unusable, a random eligible meme is used instead. */
	async function choose(
		model: PluginModelSpec,
		concept: Concept,
		ids: readonly string[],
		memes: readonly Meme[],
	): Promise<string | undefined> {
		const candidates = shortlist(
			ids,
			state.usage,
			Date.now(),
			PICK_STEP.candidates,
		);
		if (candidates.length < 2) return candidates[0];
		const listed = candidates.map((id) => memes.find((m) => m.id === id)!);
		try {
			return await ask(model, pickRequest(concept, listed), (raw) => {
				const choice =
					raw && typeof raw === "object"
						? (raw as { choice?: unknown }).choice
						: undefined;
				if (
					typeof choice !== "number" ||
					!Number.isInteger(choice) ||
					choice < 1 ||
					choice > candidates.length
				)
					throw new Error(
						`choice must be a whole number from 1 to ${candidates.length}`,
					);
				return candidates[choice - 1]!;
			});
		} catch (error) {
			if (!(error instanceof RejectedReply)) throw error;
			return pickMeme(candidates, state.usage, Date.now());
		}
	}

	/** Step 3, cached: a meme's template does not depend on the concept. */
	async function templateFor(
		meme: Meme,
		model: PluginModelSpec,
	): Promise<Template> {
		const captionHash = createHash("sha256")
			.update(meme.caption.join("\n"))
			.digest("hex");
		const cached = state.templates[meme.id];
		if (
			cached?.captionHash === captionHash &&
			cached.promptVersion === PROMPT_VERSION
		) {
			try {
				return parseTemplate(
					{ lines: cached.lines, slots: cached.slots, voice: cached.voice },
					meme.caption,
				);
			} catch {
				/* hand-edited or stale: rebuild */
			}
		}
		const template = await ask(model, templateRequest(meme), (raw) =>
			parseTemplate(raw, meme.caption),
		);
		save({
			...state,
			templates: {
				...state.templates,
				[meme.id]: { ...template, captionHash, promptVersion: PROMPT_VERSION },
			},
		});
		return template;
	}

	/** Steps 4 and 5 plus the fact check. A fact that disagrees with the question is
	 * regenerated, a bounded number of times; after that the meme is not shown at all. */
	async function fillChecked(
		model: PluginModelSpec,
		meme: Meme,
		template: Template,
		concept: Concept,
	): Promise<Filling> {
		let avoid: string | undefined;
		for (let attempt = 1; ; attempt++) {
			const filling = await ask(
				model,
				fillRequest({
					meme,
					template,
					concept,
					emphasis: state.settings.emphasis,
					avoid,
				}),
				(raw) => parseFilling(raw, template),
			);
			// Certain agreement needs no model call; otherwise a cheap self-check decides.
			const verdict =
				(concept.answer && quickAgreement(filling.fact, concept.answer)) ??
				(await ask(
					model,
					agreementRequest({ concept, fact: filling.fact }),
					parseAgreement,
				));
			if (verdict) return filling;
			if (attempt >= FACT_CHECK.MAX_FACT_ATTEMPTS)
				throw new Error(FACT_CHECK.UNRELIABLE_MESSAGE);
			avoid = filling.fact;
		}
	}

	/** "Once used, store it": start or extend the meme's cooldown. */
	const markUsed = (id: string) =>
		save({
			...state,
			usage: {
				...state.usage,
				[id]: recordUse(state.usage[id], Date.now(), state.settings),
			},
		});

	/** Request id of the running generate call; stage events carry it so a window
	 * only follows its own request. Null when the caller sent none. */
	let stageFor: string | null = null;
	const stage = (name: MemeStage) => {
		if (stageFor === null || disposed || ctx.signal.aborted) return;
		ctx.events.emit(STAGE_TOPIC, { requestId: stageFor, stage: name });
	};

	async function generate(input: unknown): Promise<GeneratedMeme> {
		const value = object(input);
		const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
		if (!prompt) throw new Error("There is no question to turn into a meme.");
		if (
			prompt.length > MAX_PROMPT_LENGTH ||
			(value.context !== undefined &&
				(typeof value.context !== "string" ||
					value.context.length > MAX_CONTEXT_LENGTH))
		)
			throw new Error("The question is too long to turn into a meme.");
		const answer = parseAnswer(value.answer);
		const concept: Concept = {
			prompt,
			...(typeof value.context === "string" && value.context.trim()
				? { context: value.context.trim() }
				: {}),
			...(answer ? { answer } : {}),
		};
		const exclude =
			typeof value.excludeMemeId === "string" ? value.excludeMemeId : undefined;

		stage("selecting");
		const memes = pool().memes;
		// Before any model is needed: an earlier meme for this concept, if this
		// concept's reuse share allows. A reuse counts as a use for the cooldown.
		const key = conceptKey(prompt);
		const store = readGenerated(ctx.dataDirectory);
		const earlier = mayReuse(store.concepts[key])
			? chooseReuse(
					store.concepts[key]?.memes ?? [],
					new Set(memes.map((meme) => meme.id)),
					exclude,
				)
			: undefined;
		if (earlier) {
			markUsed(earlier.meme.meme.id);
			writeGenerated(ctx.dataDirectory, recordReuse(store, key));
			return {
				...earlier.meme,
				concept,
				generatedId: earlier.id,
				reused: true,
			};
		}

		const model = await resolveModel();
		if (!memes.length)
			throw new Error(
				"The meme pool is empty. Enable the bundled catalogue or add custom memes.",
			);
		const tried = new Set<string>([...unusable, ...(exclude ? [exclude] : [])]);
		// Never let exclusions empty the pool: a repeat beats no meme.
		if (memes.every((meme) => tried.has(meme.id))) tried.clear();
		let failure: unknown;
		for (let attempt = 0; attempt < MEME_ATTEMPTS; attempt++) {
			// Step 2: the model chooses a fitting meme among those not cooling down.
			const id = await choose(
				model,
				concept,
				memes
					.map((meme) => meme.id)
					.filter((candidate) => !tried.has(candidate)),
				memes,
			);
			const meme = memes.find((candidate) => candidate.id === id);
			if (!meme) break;
			tried.add(meme.id);
			stage("writing");
			let template: Template;
			try {
				template = await templateFor(meme, model);
			} catch (error) {
				alive();
				// A failed request (quota, network) is not the meme's fault: report it as is.
				if (!(error instanceof RejectedReply)) throw error;
				unusable.add(meme.id);
				failure = error;
				continue;
			}
			// Steps 4 and 5, then the fact check. A meme whose fact cannot be made to agree is not shown.
			const filling = await fillChecked(model, meme, template, concept);
			const emphasis = state.settings.emphasis ? filling.emphasis : null;
			// "Once used, store it": only a meme that was actually produced starts its cooldown.
			markUsed(meme.id);
			const stored: StoredMeme = {
				meme: {
					id: meme.id,
					origin: meme.origin,
					name: meme.name,
					...(meme.source ? { source: meme.source } : {}),
					boxes: meme.boxes,
					hasImage: !!meme.image,
				},
				originalCaption: meme.caption,
				templateLines: template.lines,
				lines: assemble(template, filling.values, emphasis),
				values: filling.values,
				emphasis,
				fact: filling.fact,
			};
			const entry = newEntry(stored, Date.now());
			// Re-read: a rating may have been written while the model was answering.
			writeGenerated(
				ctx.dataDirectory,
				recordFresh(readGenerated(ctx.dataDirectory), key, entry),
			);
			return { ...stored, concept, generatedId: entry.id };
		}
		throw failure instanceof Error
			? failure
			: new Error("No meme could be prepared.");
	}

	const unregister = [
		ctx.handle("get-state", () => {
			alive();
			return view();
		}),
		ctx.handle("save-settings", (input) => {
			alive();
			save({ ...state, settings: applySettingsPatch(state.settings, input) });
			return view();
		}),
		ctx.handle("reset-usage", () => {
			alive();
			save({ ...state, usage: {} });
			return view();
		}),
		ctx.handle("generate", async (input) => {
			alive();
			// One paid request chain at a time, however many windows ask.
			if (generating) throw new Error("A meme is already being made.");
			generating = true;
			const requestId = object(input).requestId;
			stageFor = typeof requestId === "string" ? requestId : null;
			try {
				const meme = await generate(input);
				// A reopened (reused) meme carries the learner's earlier rating.
				const rating = meme.generatedId
					? (readRating(ctx.dataDirectory, meme.generatedId) ?? null)
					: null;
				return { ...meme, rating };
			} finally {
				generating = false;
				stageFor = null;
			}
		}),
		ctx.handle("rate", (input) => {
			alive();
			const { id, rating } = object(input);
			if (typeof id !== "string" || !id) throw new Error("Unknown meme.");
			if (rating !== "up" && rating !== "down" && rating !== null)
				throw new Error('A rating is "up", "down" or null.');
			if (!rateGenerated(ctx.dataDirectory, id, rating))
				throw new Error("Unknown meme.");
			return null;
		}),
		ctx.handle("get-image", async (input): Promise<MemeImage | null> => {
			alive();
			const id = object(input).id;
			const meme =
				typeof id === "string"
					? pool().memes.find((candidate) => candidate.id === id)
					: undefined;
			if (!meme) throw new Error("Unknown meme.");
			const image = await loadImage(meme, ctx.dataDirectory, ctx.signal);
			alive();
			return image;
		}),
	];
	return () => {
		if (disposed) return;
		disposed = true;
		for (const release of unregister) release();
	};
}
