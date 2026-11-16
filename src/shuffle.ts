/** Shuffle options for the Tone, Teacher memes and Automatic memes settings: the
 * setting resolves to one of its concrete values each time it applies. */
import { TONES, type Tone, type ToneSetting } from "./config.ts";
import type { AutomaticMemes, TeacherMemes } from "./types.ts";

/** Tones Shuffle draws from: every tone except "none". */
export const SHUFFLED_TONES: readonly Exclude<Tone, "none">[] = Object.freeze(
	TONES.filter((tone): tone is Exclude<Tone, "none"> => tone !== "none"),
);
export type ConcreteTeacherMemes = Exclude<TeacherMemes, "off" | "shuffle">;
export const SHUFFLED_TEACHER: readonly ConcreteTeacherMemes[] = Object.freeze([
	"teacher",
	"wrong",
]);
export type ConcreteAutomaticMemes = Exclude<AutomaticMemes, "off" | "shuffle">;
export const SHUFFLED_AUTOMATIC: readonly ConcreteAutomaticMemes[] =
	Object.freeze(["every", "nth", "wrong", "asked", "asked-nth"]);

const draw = <T>(values: readonly T[], random: () => number): T =>
	values[Math.min(values.length - 1, Math.floor(random() * values.length))]!;

/** The tone for one meme: Shuffle draws a fresh one each time. */
export function concreteTone(
	setting: ToneSetting,
	random: () => number = Math.random,
): Tone {
	return setting === "shuffle" ? draw(SHUFFLED_TONES, random) : setting;
}

/** The teacher rule for one teacher turn: Shuffle draws a fresh one each turn. */
export function concreteTeacher(
	setting: Exclude<TeacherMemes, "off">,
	random: () => number = Math.random,
): ConcreteTeacherMemes {
	return setting === "shuffle" ? draw(SHUFFLED_TEACHER, random) : setting;
}

/** FNV-1a: a stable number for a question key. */
function hash(text: string): number {
	let value = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index);
		value = Math.imul(value, 0x01000193);
	}
	return value >>> 0;
}

/** The trigger for one question. Shuffle derives it from the question key, so the
 * asked check and the reveal check of the same question always agree. */
export function concreteAutomatic(
	setting: AutomaticMemes,
	key: string,
): ConcreteAutomaticMemes | "off" {
	return setting === "shuffle"
		? SHUFFLED_AUTOMATIC[hash(key) % SHUFFLED_AUTOMATIC.length]!
		: setting;
}
