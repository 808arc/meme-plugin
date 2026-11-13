/** Server side of the meme plugin: owns settings, the meme pool, the cooldown
 * record, cached templates and every model call. Writes only under ctx.dataDirectory. */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
	PluginBackendContext,
	PluginCallPurpose,
	PluginModelSpec,
} from "learnharness-plugin-api";
import { MAX_CONTEXT_LENGTH, MAX_PROMPT_LENGTH } from "./concept.ts";
import {
	BUTTONLESS,
	FACT_CHECK,
	MEME_MODES,
	type MemeStage,
	OWN_MEMES,
	PICK_STEP,
	STAGE_TOPIC,
	type ConcreteMode,
	type MemeMode,
	TEACHER_TOOL,
} from "./config.ts";
import {
	agreementRequest,
	parseAgreement,
	parseAnswer,
	quickAgreement,
} from "./factcheck.ts";
import { loadImage } from "./images.ts";
import {
	CUSTOM_FILE,
	CUSTOM_IMAGES,
	IMAGE_FILE,
	loadCustomMemes,
	memegenMemes,
} from "./library.ts";
import {
	concreteMode,
	modeFillRequest,
	parseModeFilling,
	readOptions,
} from "./modes.ts";
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
import {
	coolingDown,
	pickMeme,
	preferredPool,
	recordRejection,
	recordUse,
	shortlist,
} from "./scheduler.ts";
import { applySettingsPatch, readSettings } from "./settings.ts";
import {
	judgeRequest,
	parseJudgement,
	type SearchAgent,
	searchCandidates,
	verdict,
	webMeme,
} from "./search.ts";
import { assemble, parseFilling, parseTemplate } from "./template.ts";
import type {
	AutomaticResult,
	Concept,
	Filling,
	GeneratedMeme,
	Meme,
	MemeExport,
	MemeImage,
	PluginState,
	Settings,
	TeacherMemes,
	Template,
	Usage,
} from "./types.ts";

const STATE_VERSION = 1;
const STATE_FILE = "state.json";
/** A meme whose caption cannot be templated is skipped; try this many before giving up. */
const MEME_ATTEMPTS = 3;
const MAX_OUTPUT_TOKENS = 2048;
const TOOL_NAME = "meme_teach";
/** Reveal rule (prompt-only, see docs/teacher-meme-tool.md): the tool only ever gets a
 * concept, and only after the learner has tried. */
const REVEAL_RULE = `Only call it after the learner has answered the current question or it has been revealed. Never call it while a question is pending. Pass the concept as "prompt" and never state the answer to an unrevealed question. If the tool is not offered in a turn, the meme limit is reached: do not mention it.`;
const TEACHER_INSTRUCTIONS: Record<Exclude<TeacherMemes, "off">, string> = {
	teacher: `A meme plugin is enabled. You may call the ${TOOL_NAME} tool, without being asked, when a meme would help a concept stick. ${REVEAL_RULE}`,
	wrong: `A meme plugin is enabled. Call the ${TOOL_NAME} tool only right after the learner answered a question incorrectly, to help the correct answer stick once it has been revealed. ${REVEAL_RULE}`,
};

/** Local calendar day, for the automatic-meme budget. */
const dayKey = (now: number) => new Date(now).toLocaleDateString("en-CA");

interface CachedTemplate extends Template {
	captionHash: string;
	promptVersion: number;
}
interface Stored {
	version: number;
	settings: Settings;
	usage: Record<string, Usage>;
	templates: Record<string, CachedTemplate>;
	/** Automatic memes made today; the shared budget in config.ts. */
	automatic: { day: string; count: number };
	/** #18: questions that already had their automatic turn, and how many were answered. */
	buttonless: { seen: string[]; revealed: number };
}

/** The model answered, but not with something the plugin can accept. */
class RejectedReply extends Error {}

/** #32: the chat a request belongs to, from its `sessionId`; "" when absent. */
function chatKey(input: unknown): string {
	const id =
		input && typeof input === "object"
			? (input as { sessionId?: unknown }).sessionId
			: undefined;
	return typeof id === "string" ? id.slice(0, 200) : "";
}

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
				automatic: { day: "", count: 0 },
				buttonless: { seen: [], revealed: 0 },
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
		automatic: readAutomatic(stored.automatic),
		buttonless: readButtonless(stored.buttonless),
	};
}

function readButtonless(value: unknown): Stored["buttonless"] {
	const item = value as Partial<Stored["buttonless"]> | null | undefined;
	const revealed = item?.revealed;
	return {
		seen: Array.isArray(item?.seen)
			? item.seen.filter((key): key is string => typeof key === "string")
			: [],
		revealed:
			typeof revealed === "number" &&
			Number.isInteger(revealed) &&
			revealed >= 0
				? revealed
				: 0,
	};
}

function readAutomatic(value: unknown): Stored["automatic"] {
	const item = value as Partial<Stored["automatic"]> | null | undefined;
	return item &&
		typeof item.day === "string" &&
		Number.isInteger(item.count) &&
		item.count! >= 0
		? { day: item.day, count: item.count! }
		: { day: "", count: 0 };
}

export interface BackendOptions {
	/** Builds the search agent from the learner's settings. Without one, web search
	 * is skipped and the plugin generates. The host supplies the provider. */
	createSearchAgent?: (settings: Settings) => SearchAgent | null;
}

export function activate(
	ctx: PluginBackendContext,
	options: BackendOptions = {},
): () => void {
	const file = path.join(ctx.dataDirectory, STATE_FILE);
	let state = readState(file);
	let disposed = false;
	let generating = false;
	/** Memes the current model could not template; not retried until the next activation. */
	const unusable = new Set<string>();
	/** The web meme shown last; its image is served by `get-image`. */
	const webFound = new Map<string, Meme>();
	/** #32: memes made in Shuffle, per chat (session id). In memory: a plugin reload
	 * or a save of the mode setting starts the sequence again at Answer. */
	const shufflePosition = new Map<string, number>();

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

	/** #21: where custom memes are read from. Outside data/ it is only ever read. */
	const customDirectory = () =>
		state.settings.customFolder || ctx.dataDirectory;

	/** The shared daily budget for automatic memes (teacher tool and buttonless mode). */
	const automaticUsed = () =>
		state.automatic.day === dayKey(Date.now()) ? state.automatic.count : 0;
	const spendAutomatic = () =>
		save({
			...state,
			automatic: { day: dayKey(Date.now()), count: automaticUsed() + 1 },
		});

	const pool = () => {
		const folder = customDirectory();
		const custom = loadCustomMemes(folder);
		if (folder !== ctx.dataDirectory && !fs.existsSync(folder))
			custom.problems.unshift(`Custom memes folder not found: ${folder}`);
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
	const view = (chat: string): PluginState => {
		const current = pool(),
			now = Date.now();
		return {
			settings: { ...state.settings },
			nextMode: concreteMode(
				state.settings.mode,
				shufflePosition.get(chat) ?? 0,
			),
			pool: {
				memegen: current.memegen,
				custom: current.custom,
				coolingDown: current.memes.filter((meme) =>
					coolingDown(state.usage, meme.id, now),
				).length,
			},
			customFolder: customDirectory(),
			problems: current.problems,
			automatic: {
				used: automaticUsed(),
				perDay: TEACHER_TOOL.automaticMemesPerDay,
			},
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
		purpose: PluginCallPurpose,
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
			// "user" when the learner pressed Meme this; "background" when the teacher chose to.
			const reply = await ctx.inference.complete({
				model,
				purpose,
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
		purpose: PluginCallPurpose,
		model: PluginModelSpec,
		concept: Concept,
		ids: readonly string[],
		memes: readonly Meme[],
	): Promise<string | undefined> {
		const datedIds = new Set(
			memes.filter((meme) => meme.dated).map((meme) => meme.id),
		);
		const candidates = shortlist(
			ids,
			state.usage,
			Date.now(),
			PICK_STEP.candidates,
			Math.random,
			(id) => datedIds.has(id),
		);
		if (candidates.length < 2) return candidates[0];
		const listed = candidates.map((id) => memes.find((m) => m.id === id)!);
		try {
			return await ask(purpose, model, pickRequest(concept, listed), (raw) => {
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
		purpose: PluginCallPurpose,
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
		const template = await ask(purpose, model, templateRequest(meme), (raw) =>
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
		purpose: PluginCallPurpose,
		model: PluginModelSpec,
		meme: Meme,
		template: Template,
		concept: Concept,
	): Promise<Filling> {
		let avoid: string | undefined;
		for (let attempt = 1; ; attempt++) {
			const filling = await ask(
				purpose,
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
			stage("checking");
			const verdict =
				(concept.answer && quickAgreement(filling.fact, concept.answer)) ??
				(await ask(
					purpose,
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

	/** Web search, when on and an agent is configured. Null means: generate instead.
	 * Each prefiltered hit is judged by the model (safety, relevance, accuracy) and its
	 * image must load; any failure rejects that hit (fail closed) and tries the next. */
	async function webResult(
		purpose: PluginCallPurpose,
		concept: Concept,
		exclude: string | undefined,
	): Promise<GeneratedMeme | null> {
		const { webSearch, searchAgent } = state.settings;
		if (!webSearch || !searchAgent) return null;
		const agent = options.createSearchAgent?.(state.settings);
		if (!agent) return null;
		stage("search");
		const hits = await searchCandidates(agent, concept, ctx.signal);
		alive();
		for (const hit of hits) {
			const meme = webMeme(hit);
			if (meme.id === exclude) continue;
			let match: "answer" | "related" | null;
			try {
				const model = await resolveModel();
				const judgement = await ask(
					purpose,
					model,
					judgeRequest(hit, concept),
					parseJudgement,
				);
				match = verdict(hit, judgement);
				// Never show a credit-only card: the image must load before the meme is offered.
				if (match) await loadImage(meme, ctx.dataDirectory, ctx.signal);
			} catch {
				match = null;
			}
			alive();
			if (!match) continue;
			webFound.clear();
			webFound.set(meme.id, meme);
			return {
				meme: {
					id: meme.id,
					origin: "web",
					name: meme.name,
					source: meme.source,
					credit: meme.credit,
					boxes: [],
					hasImage: true,
				},
				webMatch: match,
				concept,
				originalCaption: [],
				templateLines: [],
				lines: [],
				values: {},
				emphasis: null,
				fact: "",
			};
		}
		return null;
	}

	/** #17/#32: a meme records its mode unless it is a plain Answer meme. */
	const modeField = (mode: ConcreteMode, labelled: boolean) =>
		mode === "answer" && !labelled ? {} : { mode };

	/** One meme for one question. Pipeline, in order; each step stops at its first hit:
	 *  1. reuse an earlier meme for the same question and mode (#9);
	 *  2. web search for an existing meme (#11): Answer mode only, and only when
	 *     enabled and a search agent is configured;
	 *  3. template: own memes first by the own-memes share (#21), then the catalogue,
	 *     through the pick step (#4); templates are cached per meme;
	 *  4. caption: fill the template (#4 humor rule; #17 mode prompts);
	 *  5. check: Answer runs the fact check (#7); Hint and Think run the no-answer
	 *     check (#17).
	 * `mode` is passed in, never read from settings here: automatic callers (teacher
	 * tool, buttonless) always pass "answer". `labelled` (#32): the mode came from
	 * Shuffle, so an Answer meme carries its mode too, for the label. */
	async function generate(
		input: unknown,
		purpose: PluginCallPurpose,
		mode: ConcreteMode,
		labelled = false,
	): Promise<GeneratedMeme> {
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
		// "Not this one" (#21): the meme on screen counts as one more use, so its
		// cooldown restarts one step longer, and at least the minimum after rejecting.
		// It comes back later, never at once.
		const rejected =
			typeof value.rejectMemeId === "string" ? value.rejectMemeId : undefined;
		const exclude =
			rejected ??
			(typeof value.excludeMemeId === "string"
				? value.excludeMemeId
				: undefined);
		// #17: the mode is the backend's stored setting, read once per meme. A question
		// read before reveal is refused unless the mode allows it, before any model call.
		const early = value.early === true;
		if (early && !(MEME_MODES.preReveal as readonly string[]).includes(mode))
			throw new Error("Reveal the question first. A meme would show it early.");
		const options = mode === "answer" ? [] : readOptions(value.options);

		const memes = pool().memes;
		if (rejected && memes.some((meme) => meme.id === rejected))
			save({
				...state,
				usage: {
					...state.usage,
					[rejected]: recordRejection(
						state.usage[rejected],
						Date.now(),
						state.settings,
					),
				},
			});

		// Before any model is needed: an earlier meme for this concept, if this
		// concept's reuse share allows. A reuse counts as a use for the cooldown.
		stage("reuse");
		// The mode is part of the key: a meme made in one mode is never reused in another.
		const key = `${mode}:${conceptKey(prompt)}`;
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
			const { mode: _stored, ...base } = earlier.meme;
			return {
				...base,
				...modeField(mode, labelled),
				concept,
				generatedId: earlier.id,
				reused: true,
			};
		}

		// Source 4 of the README: an existing meme found on the web beats generating one.
		// Hint and Think never show a web meme: its text would state the answer.
		const web =
			mode === "answer" ? await webResult(purpose, concept, exclude) : null;
		if (web) return web;

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
			// Step 2: own memes first (#21, by the own-memes share), then the model
			// chooses a fitting meme among those not cooling down (#4).
			const candidates = memes.filter((meme) => !tried.has(meme.id));
			stage("selecting");
			const id = await choose(
				purpose,
				model,
				concept,
				preferredPool(
					candidates.map((meme) => meme.id),
					new Set(
						candidates
							.filter((meme) => meme.origin === "custom")
							.map((meme) => meme.id),
					),
					state.usage,
					Date.now(),
					state.settings.ownMemesShare / 100,
				),
				memes,
			);
			const meme = memes.find((candidate) => candidate.id === id);
			if (!meme) break;
			tried.add(meme.id);
			stage("writing");
			let template: Template;
			try {
				template = await templateFor(meme, model, purpose);
			} catch (error) {
				alive();
				// A failed request (quota, network) is not the meme's fault: report it as is.
				if (!(error instanceof RejectedReply)) throw error;
				unusable.add(meme.id);
				failure = error;
				continue;
			}
			// Steps 4 and 5. Answer mode: then the fact check (#7); a meme whose fact
			// cannot be made to agree is not shown. Hint and Think (#17): the no-answer
			// check; a caption that gives the answer away is rejected and, after one
			// correction, another meme is tried.
			let filling: Filling;
			if (mode === "answer")
				filling = await fillChecked(purpose, model, meme, template, concept);
			else {
				try {
					filling = await ask(
						purpose,
						model,
						modeFillRequest(mode, { meme, template, concept, early }),
						(raw) => {
							stage("checking");
							return parseModeFilling(raw, template, options);
						},
					);
				} catch (error) {
					alive();
					if (!(error instanceof RejectedReply)) throw error;
					failure = error;
					continue;
				}
			}
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
				...modeField(mode, labelled),
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

	/** "Export my memes" (#21): copy custom-memes.json and its images into a new
	 * folder under data/exports/. The SDK has no save dialog, and the plugin writes
	 * only inside data/, so the learner copies that folder wherever they like. */
	function exportMemes(): MemeExport {
		const source = customDirectory();
		let list: Buffer;
		try {
			list = fs.readFileSync(path.join(source, CUSTOM_FILE));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw new Error(`There are no custom memes to export in ${source}.`);
			throw error;
		}
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const target = path.join(
			ctx.dataDirectory,
			OWN_MEMES.exportsFolder,
			`memes-${stamp}`,
		);
		fs.mkdirSync(path.join(target, CUSTOM_IMAGES), { recursive: true });
		fs.writeFileSync(path.join(target, CUSTOM_FILE), list, { flag: "wx" });
		let images = 0;
		const imagesFrom = path.join(source, CUSTOM_IMAGES);
		const names = fs.existsSync(imagesFrom) ? fs.readdirSync(imagesFrom) : [];
		for (const name of names) {
			const file = path.join(imagesFrom, name);
			// Same rule as reading: plain image files only, never links or folders.
			if (!IMAGE_FILE.test(name) || !fs.lstatSync(file).isFile()) continue;
			fs.copyFileSync(
				file,
				path.join(target, CUSTOM_IMAGES, name),
				fs.constants.COPYFILE_EXCL,
			);
			images++;
		}
		return { path: target, images };
	}

	// One paid request chain at a time, however many windows or tool calls ask.
	const guarded = async (run: () => Promise<GeneratedMeme>) => {
		alive();
		if (generating) throw new Error("A meme is already being made.");
		generating = true;
		try {
			return await run();
		} finally {
			generating = false;
		}
	};

	/** Teacher turns per chat (one per tool-loadout request) and the turn of the last meme. */
	const turns = new Map<string, { turn: number; memeTurn: number | null }>();
	const budgetLeft = () => automaticUsed() < TEACHER_TOOL.automaticMemesPerDay;
	const capReached = (chat: { turn: number; memeTurn: number | null }) =>
		chat.memeTurn !== null &&
		chat.turn - chat.memeTurn < TEACHER_TOOL.turnsPerMeme;

	const teacherTool = (chat: { turn: number; memeTurn: number | null }) => ({
		name: TOOL_NAME,
		label: "Teacher meme",
		description:
			"Put one meme in the chat to help a concept stick. Only after the learner has tried the question; never reveal an unrevealed answer.",
		parameters: {
			type: "object",
			properties: {
				prompt: { type: "string", minLength: 1, maxLength: MAX_PROMPT_LENGTH },
				context: { type: "string", maxLength: MAX_CONTEXT_LENGTH },
			},
			required: ["prompt"],
			additionalProperties: false,
		},
		execute: async (
			_toolCallId: string,
			input: unknown,
			signal?: AbortSignal,
		) => {
			alive();
			if (signal?.aborted) throw new Error("Meme tool cancelled");
			if (capReached(chat))
				throw new Error("Meme limit for this part of the lesson reached.");
			if (!budgetLeft())
				throw new Error("Today's automatic meme budget is used up.");
			// Not asked for by the learner: automatic work, classified as background.
			const meme = await guarded(() => generate(input, "background", "answer"));
			chat.memeTurn = chat.turn;
			spendAutomatic();
			return {
				content: [
					{
						type: "text" as const,
						text: `Meme shown to the learner: ${meme.lines.filter(Boolean).join(" / ")}. Fact it teaches: ${meme.fact}`,
					},
				],
				details: meme,
			};
		},
	});

	// Teacher tool and instructions exist only while the setting is on; changes apply to future turns.
	let teacherRelease: (() => void)[] = [];
	const syncTeacherTool = () => {
		for (const release of teacherRelease.splice(0)) release();
		const mode = state.settings.teacherMemes;
		if (disposed || mode === "off") return;
		teacherRelease = [
			ctx.registerInstructions({
				agents: ["teacher"],
				text: TEACHER_INSTRUCTIONS[mode],
			}),
			ctx.registerTools({
				// Teaching sessions only.
				agents: ["teacher"],
				create: (context) => {
					const chat = turns.get(context.chatId) ?? {
						turn: 0,
						memeTurn: null,
					};
					turns.set(context.chatId, chat);
					chat.turn++;
					// Over the cap or budget, the tool is simply not offered this turn.
					return capReached(chat) || !budgetLeft() ? [] : [teacherTool(chat)];
				},
			}),
		];
	};
	syncTeacherTool();

	const unregister = [
		() => {
			for (const release of teacherRelease.splice(0)) release();
		},
		ctx.handle("get-state", (input) => {
			alive();
			return view(chatKey(input));
		}),
		ctx.handle("save-settings", (input) => {
			alive();
			save({ ...state, settings: applySettingsPatch(state.settings, input) });
			// #32: a saved mode setting starts the Shuffle sequence again.
			if (input && typeof input === "object" && "mode" in input)
				shufflePosition.clear();
			syncTeacherTool();
			return view(chatKey(input));
		}),
		ctx.handle("export-memes", () => {
			alive();
			return exportMemes();
		}),
		ctx.handle("reset-usage", (input) => {
			alive();
			save({ ...state, usage: {} });
			return view(chatKey(input));
		}),
		ctx.handle("generate", (input) =>
			guarded(async () => {
				const requestId = object(input).requestId;
				stageFor = typeof requestId === "string" ? requestId : null;
				const chat = chatKey(input);
				const setting = state.settings.mode;
				const position = shufflePosition.get(chat) ?? 0;
				try {
					const meme = await generate(
						input,
						"user",
						concreteMode(setting, position),
						setting === "shuffle",
					);
					// #32: a meme made in Shuffle moves the chat to the next mode.
					if (setting === "shuffle") shufflePosition.set(chat, position + 1);
					// A reopened (reused) meme carries the learner's earlier rating.
					const rating = meme.generatedId
						? (readRating(ctx.dataDirectory, meme.generatedId) ?? null)
						: null;
					return { ...meme, rating };
				} finally {
					stageFor = null;
				}
			}),
		),
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
		// #18: the frontend saw an answered question; the backend decides whether it gets a meme.
		ctx.handle("auto-meme", async (input): Promise<AutomaticResult> => {
			alive();
			const value = object(input);
			const key = typeof value.key === "string" ? value.key : "";
			if (!key || key.length > 1000)
				throw new Error("An automatic meme needs a question key.");
			const frequency = state.settings.automaticMemes;
			// #17: an automatic meme states the answer, so it runs in Answer mode only.
			// #32: Shuffle is not Answer, so it gets no automatic memes either.
			if (frequency === "off" || state.settings.mode !== "answer")
				return { status: "off" };
			if (state.buttonless.seen.includes(key)) return { status: "seen" };
			// Marked before any model call: a failed or skipped question is never retried.
			const revealed = state.buttonless.revealed + 1;
			save({
				...state,
				buttonless: {
					seen: [...state.buttonless.seen, key].slice(
						-BUTTONLESS.rememberedQuestions,
					),
					revealed,
				},
			});
			if (
				(frequency === "nth" && revealed % BUTTONLESS.everyNth !== 0) ||
				(frequency === "wrong" && value.wrong !== true)
			)
				return { status: "skipped" };
			if (!budgetLeft()) return { status: "budget" };
			// Not asked for by the learner: background work, like the teacher tool.
			const meme = await guarded(() =>
				generate(
					{
						prompt: value.prompt,
						...(value.context !== undefined ? { context: value.context } : {}),
					},
					"background",
					"answer",
				),
			);
			spendAutomatic();
			return { status: "meme", meme };
		}),
		ctx.handle("get-image", async (input): Promise<MemeImage | null> => {
			alive();
			const id = object(input).id;
			const meme =
				typeof id === "string"
					? (pool().memes.find((candidate) => candidate.id === id) ??
						webFound.get(id))
					: undefined;
			if (!meme) throw new Error("Unknown meme.");
			const image = await loadImage(
				meme,
				ctx.dataDirectory,
				ctx.signal,
				customDirectory(),
			);
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
