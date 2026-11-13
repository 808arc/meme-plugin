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
import { loadImage } from "./images.ts";
import { loadCustomMemes, memegenMemes } from "./library.ts";
import {
	extractJson,
	fillRequest,
	type ModelRequest,
	PROMPT_VERSION,
	templateRequest,
} from "./prompts.ts";
import { coolingDown, pickMeme, recordUse } from "./scheduler.ts";
import { applySettingsPatch, readSettings } from "./settings.ts";
import { findWebMeme, type SearchAgent } from "./search.ts";
import { assemble, parseFilling, parseTemplate } from "./template.ts";
import type {
	Concept,
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

	/** Web search, when on and an agent is configured. Null means: generate instead. */
	async function webResult(
		concept: Concept,
		exclude: string | undefined,
	): Promise<GeneratedMeme | null> {
		const { webSearch, searchAgent } = state.settings;
		if (!webSearch || !searchAgent) return null;
		const agent = options.createSearchAgent?.(state.settings);
		if (!agent) return null;
		const meme = await findWebMeme(agent, concept, ctx.signal);
		alive();
		if (!meme || meme.id === exclude) return null;
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
			concept,
			originalCaption: [],
			templateLines: [],
			lines: [],
			values: {},
			emphasis: null,
			fact: "",
		};
	}

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
		const concept: Concept = {
			prompt,
			...(typeof value.context === "string" && value.context.trim()
				? { context: value.context.trim() }
				: {}),
		};
		const exclude =
			typeof value.excludeMemeId === "string" ? value.excludeMemeId : undefined;

		// Source 4 of the README: an existing meme found on the web beats generating one.
		const web = await webResult(concept, exclude);
		if (web) return web;

		const model = await resolveModel();
		const memes = pool().memes;
		if (!memes.length)
			throw new Error(
				"The meme pool is empty. Enable the bundled catalogue or add custom memes.",
			);
		const tried = new Set<string>([...unusable, ...(exclude ? [exclude] : [])]);
		// Never let exclusions empty the pool: a repeat beats no meme.
		if (memes.every((meme) => tried.has(meme.id))) tried.clear();
		let failure: unknown;
		for (let attempt = 0; attempt < MEME_ATTEMPTS; attempt++) {
			// Step 2: random, skipping memes that are cooling down.
			const id = pickMeme(
				memes
					.map((meme) => meme.id)
					.filter((candidate) => !tried.has(candidate)),
				state.usage,
				Date.now(),
			);
			const meme = memes.find((candidate) => candidate.id === id);
			if (!meme) break;
			tried.add(meme.id);
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
			// Steps 4 and 5.
			const filling = await ask(
				model,
				fillRequest({
					meme,
					template,
					concept,
					emphasis: state.settings.emphasis,
				}),
				(raw) => parseFilling(raw, template),
			);
			const emphasis = state.settings.emphasis ? filling.emphasis : null;
			// "Once used, store it": only a meme that was actually produced starts its cooldown.
			save({
				...state,
				usage: {
					...state.usage,
					[meme.id]: recordUse(
						state.usage[meme.id],
						Date.now(),
						state.settings,
					),
				},
			});
			return {
				meme: {
					id: meme.id,
					origin: meme.origin,
					name: meme.name,
					...(meme.source ? { source: meme.source } : {}),
					boxes: meme.boxes,
					hasImage: !!meme.image,
				},
				concept,
				originalCaption: meme.caption,
				templateLines: template.lines,
				lines: assemble(template, filling.values, emphasis),
				values: filling.values,
				emphasis,
				fact: filling.fact,
			};
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
			try {
				return await generate(input);
			} finally {
				generating = false;
			}
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
