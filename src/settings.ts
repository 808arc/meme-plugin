/** Settings defaults and validation, shared by the backend (authority) and the
 * settings page (inline validation). */
import { MEME_MODES, OWN_MEMES, TONE_SETTINGS } from "./config.ts";
import type {
	AutomaticMemes,
	SearchProvider,
	Settings,
	TeacherMemes,
} from "./types.ts";

/** #31: search providers, default first. */
export const SEARCH_PROVIDERS: readonly SearchProvider[] = Object.freeze([
	"none",
	"tavily",
]);

export const TEACHER_MEMES: readonly TeacherMemes[] = Object.freeze([
	"off",
	"teacher",
	"wrong",
	"shuffle",
]);

export const AUTOMATIC_MEMES: readonly AutomaticMemes[] = Object.freeze([
	"off",
	"every",
	"nth",
	"wrong",
	"asked",
	"asked-nth",
	"shuffle",
]);

export const DEFAULT_SETTINGS: Settings = Object.freeze({
	model: null,
	captionModel: null,
	cooldownDays: 14,
	cooldownGrowth: 2,
	useMemegen: true,
	imageBaseUrl: "https://api.memegen.link",
	ownMemesShare: OWN_MEMES.sharePercent,
	rejectCooldownDays: OWN_MEMES.rejectCooldownDays,
	customFolder: OWN_MEMES.folder,
	webSearch: true,
	searchAgent: null,
	searchProvider: "none",
	mode: MEME_MODES.defaultMode,
	tone: "none",
	teacherMemes: "off",
	automaticMemes: "off",
});

export const LIMITS = Object.freeze({
	cooldownDays: { min: 0, max: 365 },
	cooldownGrowth: { min: 1, max: 10 },
	ownMemesShare: { min: 0, max: 100 },
	rejectCooldownDays: { min: 0, max: 365 },
});

/** #21: empty (the plugin's data/ folder) or an absolute path. No Node imports here:
 * the settings page shares this check. */
export function customFolderProblem(value: string): string | undefined {
	if (!value) return undefined;
	if (value.length > 1024 || /[\u0000-\u001f]/.test(value))
		return "Enter a folder path, or leave empty to use the plugin's data folder.";
	if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value))
		return "Use an absolute path, for example /Users/me/memes.";
	return undefined;
}

/** Undefined when acceptable, otherwise the message to show. Empty means "no images". */
export function imageBaseUrlProblem(value: string): string | undefined {
	if (!value) return undefined;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return "Enter an http(s) address, or leave empty to show text only.";
	}
	if (url.protocol !== "https:" && url.protocol !== "http:")
		return "Only http(s) addresses are supported.";
	if (url.search || url.hash || url.username || url.password)
		return "Use a plain address without query, fragment or credentials.";
	return undefined;
}

function range(value: unknown, key: keyof typeof LIMITS): number {
	const { min, max } = LIMITS[key];
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < min ||
		value > max
	)
		throw new Error(`${key} must be a number from ${min} to ${max}`);
	return value;
}

/** Settings that take one of a fixed list of values. */
const CHOICES: Partial<Record<keyof Settings, readonly string[]>> = {
	searchProvider: SEARCH_PROVIDERS,
	mode: MEME_MODES.modes,
	tone: TONE_SETTINGS,
	teacherMemes: TEACHER_MEMES,
	automaticMemes: AUTOMATIC_MEMES,
};
/** Text settings: how the value is tidied, and what makes it unacceptable. */
const TEXTS: Partial<
	Record<
		keyof Settings,
		[(value: string) => string, typeof customFolderProblem]
	>
> = {
	customFolder: [(value) => value.trim(), customFolderProblem],
	imageBaseUrl: [
		(value) => value.trim().replace(/\/+$/, ""),
		imageBaseUrlProblem,
	],
};
const MODELS = new Set(["model", "captionModel", "searchAgent"]);
const SWITCHES = new Set(["useMemegen", "webSearch"]);

function readModel(value: unknown, key: string) {
	if (value === null) return null;
	const model = value as { provider?: unknown; id?: unknown } | undefined;
	if (
		!model ||
		typeof model !== "object" ||
		typeof model.provider !== "string" ||
		!model.provider ||
		typeof model.id !== "string" ||
		!model.id
	)
		throw new Error(`${key} must be {provider, id} or null`);
	return { provider: model.provider, id: model.id };
}

function readValue(key: string, value: unknown): unknown {
	const own = <T extends object>(table: T) =>
		Object.hasOwn(table, key) ? table[key as keyof T] : undefined;
	const choices = own(CHOICES);
	if (choices) {
		if (!choices.includes(value as string))
			throw new Error(`${key} must be one of ${choices.join(", ")}`);
		return value;
	}
	if (own(LIMITS)) return range(value, key as keyof typeof LIMITS);
	if (MODELS.has(key)) return readModel(value, key);
	if (SWITCHES.has(key)) {
		if (typeof value !== "boolean")
			throw new Error(`${key} must be true or false`);
		return value;
	}
	const text = own(TEXTS);
	if (text) {
		if (typeof value !== "string") throw new Error(`${key} must be text`);
		const [tidy, problemOf] = text;
		const tidied = tidy(value);
		const problem = problemOf(tidied);
		if (problem) throw new Error(problem);
		return tidied;
	}
	throw new Error(`Unknown setting: ${key}`);
}

/** Apply a partial change; unknown keys and invalid values reject the whole patch. */
export function applySettingsPatch(
	current: Settings,
	patch: unknown,
): Settings {
	if (patch === null || typeof patch !== "object" || Array.isArray(patch))
		throw new Error("Settings change must be an object");
	const next: Record<string, unknown> = { ...current };
	for (const [key, value] of Object.entries(patch))
		next[key] = readValue(key, value);
	return next as unknown as Settings;
}

/** Stored settings from an older or hand-edited file: keep what is valid, default the rest. */
export function readSettings(stored: unknown): Settings {
	let settings: Settings = { ...DEFAULT_SETTINGS };
	if (stored === null || typeof stored !== "object" || Array.isArray(stored))
		return settings;
	for (const [key, value] of Object.entries(stored)) {
		try {
			settings = applySettingsPatch(settings, { [key]: value });
		} catch {
			/* keep the default for this key */
		}
	}
	return settings;
}
