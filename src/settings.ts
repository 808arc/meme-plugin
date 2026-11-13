/** Settings defaults and validation, shared by the backend (authority) and the
 * settings page (inline validation). */
import { MEME_MODES, type MemeMode, OWN_MEMES } from "./config.ts";
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
]);

export const AUTOMATIC_MEMES: readonly AutomaticMemes[] = Object.freeze([
	"off",
	"every",
	"nth",
	"wrong",
]);

export const DEFAULT_SETTINGS: Settings = Object.freeze({
	model: null,
	emphasis: true,
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

/** Apply a partial change; unknown keys and invalid values reject the whole patch. */
export function applySettingsPatch(
	current: Settings,
	patch: unknown,
): Settings {
	if (patch === null || typeof patch !== "object" || Array.isArray(patch))
		throw new Error("Settings change must be an object");
	const next: Settings = { ...current };
	for (const [key, value] of Object.entries(patch)) {
		switch (key) {
			case "model": {
				if (value === null) {
					next.model = null;
					break;
				}
				const model = value as { provider?: unknown; id?: unknown } | undefined;
				if (
					!model ||
					typeof model !== "object" ||
					typeof model.provider !== "string" ||
					!model.provider ||
					typeof model.id !== "string" ||
					!model.id
				)
					throw new Error("model must be {provider, id} or null");
				next.model = { provider: model.provider, id: model.id };
				break;
			}
			case "searchAgent": {
				if (value === null) {
					next.searchAgent = null;
					break;
				}
				const agent = value as { provider?: unknown; id?: unknown } | undefined;
				if (
					!agent ||
					typeof agent !== "object" ||
					typeof agent.provider !== "string" ||
					!agent.provider ||
					typeof agent.id !== "string" ||
					!agent.id
				)
					throw new Error("searchAgent must be {provider, id} or null");
				next.searchAgent = { provider: agent.provider, id: agent.id };
				break;
			}
			case "searchProvider":
				if (!SEARCH_PROVIDERS.includes(value as SearchProvider))
					throw new Error(
						`searchProvider must be one of ${SEARCH_PROVIDERS.join(", ")}`,
					);
				next.searchProvider = value as SearchProvider;
				break;
			case "emphasis":
			case "useMemegen":
			case "webSearch":
				if (typeof value !== "boolean")
					throw new Error(`${key} must be true or false`);
				next[key] = value;
				break;
			case "cooldownDays":
			case "cooldownGrowth":
			case "ownMemesShare":
			case "rejectCooldownDays":
				next[key] = range(value, key);
				break;
			case "customFolder": {
				if (typeof value !== "string")
					throw new Error("customFolder must be text");
				const trimmed = value.trim();
				const problem = customFolderProblem(trimmed);
				if (problem) throw new Error(problem);
				next.customFolder = trimmed;
				break;
			}
			case "imageBaseUrl": {
				if (typeof value !== "string")
					throw new Error("imageBaseUrl must be text");
				const trimmed = value.trim().replace(/\/+$/, "");
				const problem = imageBaseUrlProblem(trimmed);
				if (problem) throw new Error(problem);
				next.imageBaseUrl = trimmed;
				break;
			}
			case "mode":
				if (!MEME_MODES.modes.includes(value as MemeMode))
					throw new Error(`mode must be one of ${MEME_MODES.modes.join(", ")}`);
				next.mode = value as MemeMode;
				break;
			case "teacherMemes":
				if (!TEACHER_MEMES.includes(value as TeacherMemes))
					throw new Error(
						`teacherMemes must be one of ${TEACHER_MEMES.join(", ")}`,
					);
				next.teacherMemes = value as TeacherMemes;
				break;
			case "automaticMemes":
				if (!AUTOMATIC_MEMES.includes(value as AutomaticMemes))
					throw new Error(
						`automaticMemes must be one of ${AUTOMATIC_MEMES.join(", ")}`,
					);
				next.automaticMemes = value as AutomaticMemes;
				break;
			default:
				throw new Error(`Unknown setting: ${key}`);
		}
	}
	return next;
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
