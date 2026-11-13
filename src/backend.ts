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
import { BUTTONLESS, TEACHER_TOOL } from "./config.ts";
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
import { assemble, parseFilling, parseTemplate } from "./template.ts";
import type {
	AutomaticResult,
	Concept,
	GeneratedMeme,
	Meme,
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

	/** The shared daily budget for automatic memes (teacher tool and buttonless mode). */
	const automaticUsed = () =>
		state.automatic.day === dayKey(Date.now()) ? state.automatic.count : 0;
	const spendAutomatic = () =>
		save({
			...state,
			automatic: { day: dayKey(Date.now()), count: automaticUsed() + 1 },
		});

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

	async function generate(
		input: unknown,
		purpose: PluginCallPurpose,
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
		const concept: Concept = {
			prompt,
			...(typeof value.context === "string" && value.context.trim()
				? { context: value.context.trim() }
				: {}),
		};
		const exclude =
			typeof value.excludeMemeId === "string" ? value.excludeMemeId : undefined;

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
				template = await templateFor(meme, model, purpose);
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
				purpose,
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
			const meme = await guarded(() => generate(input, "background"));
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
		ctx.handle("get-state", () => {
			alive();
			return view();
		}),
		ctx.handle("save-settings", (input) => {
			alive();
			save({ ...state, settings: applySettingsPatch(state.settings, input) });
			syncTeacherTool();
			return view();
		}),
		ctx.handle("reset-usage", () => {
			alive();
			save({ ...state, usage: {} });
			return view();
		}),
		ctx.handle("generate", (input) => guarded(() => generate(input, "user"))),
		// #18: the frontend saw an answered question; the backend decides whether it gets a meme.
		ctx.handle("auto-meme", async (input): Promise<AutomaticResult> => {
			alive();
			const value = object(input);
			const key = typeof value.key === "string" ? value.key : "";
			if (!key || key.length > 1000)
				throw new Error("An automatic meme needs a question key.");
			const frequency = state.settings.automaticMemes;
			// #17: an automatic meme states the answer, so it runs in Answer mode only.
			const mode = (state.settings as { mode?: unknown }).mode;
			if (frequency === "off" || (mode !== undefined && mode !== "answer"))
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
