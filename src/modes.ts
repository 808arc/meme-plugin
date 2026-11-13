/** #17 meme modes: the Hint and Think prompts and the no-answer check. Answer mode
 * keeps using fillRequest in prompts.ts, unchanged. Design: docs/meme-modes.md. */
import {
	type ConcreteMode,
	MEME_MODES,
	type MemeMode,
	SHUFFLE_SEQUENCE,
} from "./config.ts";
import type { ModelRequest } from "./prompts.ts";
import { numbered } from "./prompts.ts";
import {
	assemble,
	cleanText,
	MAX_VALUE_LENGTH,
	parseFilling,
	sentences,
} from "./template.ts";
import type { Concept, Filling, Meme, Template } from "./types.ts";

/** The modes whose caption must not state the answer. */
export type QuestionMode = Exclude<ConcreteMode, "answer">;

/** #32: the concrete mode for one question. Shuffle follows SHUFFLE_SEQUENCE by the
 * chat's position (how many memes it has already made in Shuffle); other modes are
 * returned as they are. */
export function concreteMode(
	setting: MemeMode,
	position: number,
): ConcreteMode {
	if (setting !== "shuffle") return setting;
	const index = Number.isInteger(position) && position >= 0 ? position : 0;
	return SHUFFLE_SEQUENCE[index % SHUFFLE_SEQUENCE.length]!;
}

export interface ModeFillInput {
	meme: Pick<Meme, "name">;
	template: Template;
	concept: Concept;
	/** The learner has not revealed the question yet. */
	early: boolean;
}

const TASK: Record<QuestionMode, readonly string[]> = {
	hint: [
		"You write the caption of a study meme that gives a hint. The learner has not answered yet. The meme must point toward the answer without stating it, so the learner still has to recall it.",
		"Good hints name the category the answer belongs to, its first letter, how many words it has, a property, a related clue, or what it is not.",
	],
	think: [
		'You write the caption of a study meme that makes the learner think before answering. The meme poses a question or a contrast, for example two claims where only one is true, or "which one is the impostor?". The learner must commit to a choice before the answer is shown.',
		"Never say or hint which claim is the true one. Both claims must sound plausible; exactly one must be true.",
	],
};
const NOTE: Record<QuestionMode, string> = {
	hint: "the hint as one plain sentence, still without the answer",
	think:
		"the question the learner must answer, as one plain sentence (for example: Which panel is true?), without the answer",
};

/** Hint or Think caption request. Emphasis is always off: it repeats the key term. */
export function modeFillRequest(
	mode: QuestionMode,
	input: ModeFillInput,
): ModelRequest {
	const { template } = input;
	return {
		systemPrompt: [
			...TASK[mode],
			"You are given a meme template with slots. Fill every slot.",
			"Rules:",
			'- Never write the answer, nor a synonym, translation, abbreviation or spelling of it. Never write the text of any answer option. This applies to every slot value and to "fact".',
			"- Everything the caption says must be true. Never invent names, dates or numbers.",
			`- Each value is a short phrase (at most ${MAX_VALUE_LENGTH} characters) that reads grammatically inside its sentence. Plain text only.`,
			"- Do not rewrite the fixed words of the template; you only supply slot values.",
			'- Set "emphasis" to null.',
			`- "answer" is the answer you are pointing at, in as few words as possible (at most ${MEME_MODES.maxAnswerLength} characters). It is only used to check the caption and is never shown.`,
			`- "fact" is ${NOTE[mode]}.`,
			'Reply with one JSON object and nothing else: {"values": {slot_name: string}, "emphasis": null, "answer": string, "fact": string}',
		].join("\n"),
		user: [
			input.early
				? `The learner will be asked this next (they have not seen it yet):\n${input.concept.prompt}`
				: `The learner is being asked:\n${input.concept.prompt}`,
			input.concept.context
				? `Shown with the question:\n${input.concept.context}`
				: "",
			`Meme: ${input.meme.name}${template.voice ? `\nCharacter voice: ${template.voice}` : ""}`,
			`Template sentences:\n${numbered(sentences(template).map((sentence) => sentence.text))}`,
			`Slots:\n${template.slots.map((slot) => `- ${slot.name}: ${slot.hint} (the original meme said "${slot.original}")`).join("\n")}`,
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}

export const hintFillRequest = (input: ModeFillInput) =>
	modeFillRequest("hint", input);
export const thinkFillRequest = (input: ModeFillInput) =>
	modeFillRequest("think", input);

/** Comparison form for the no-answer check: case, accents, punctuation and spacing
 * do not matter; padded so that matches fall on whole words. */
function fold(text: string): string {
	const folded = text
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
	return ` ${folded} `;
}

/** Deterministic: true when any shown text contains any forbidden term as whole words. */
export function givesAnswerAway(
	shown: readonly string[],
	forbidden: readonly string[],
): boolean {
	const haystack = fold(shown.join("\n"));
	return forbidden.some((term) => {
		const needle = fold(term);
		return needle.trim() !== "" && haystack.includes(needle);
	});
}

/** Option labels sent with a Hint or Think request: every label, since the plugin
 * never knows which one is correct. Oversized input is refused, not clipped. */
export function readOptions(value: unknown): string[] {
	if (value === undefined) return [];
	if (
		!Array.isArray(value) ||
		value.length > MEME_MODES.maxOptions ||
		value.some(
			(option) =>
				typeof option !== "string" ||
				option.length > MEME_MODES.maxOptionLength,
		)
	)
		throw new Error("The answer options could not be read.");
	return value.map(cleanText).filter(Boolean);
}

/** Accept a Hint or Think reply only if neither the caption nor the note contains the
 * model's own answer or any option label. The answer is dropped here: it is never
 * returned, stored or shown. Error text never quotes the answer. */
export function parseModeFilling(
	raw: unknown,
	template: Template,
	options: readonly string[],
): Filling {
	const filling = parseFilling(raw, template);
	const answer = cleanText((raw as Record<string, unknown>).answer);
	if (!answer)
		throw new Error(
			'"answer" is missing; name the answer you are pointing at (it is never shown)',
		);
	if (answer.length > MEME_MODES.maxAnswerLength)
		throw new Error(
			`"answer" is longer than ${MEME_MODES.maxAnswerLength} characters; use the shortest form`,
		);
	const lines = assemble(template, filling.values, null);
	if (givesAnswerAway([...lines, filling.fact], [answer, ...options]))
		throw new Error(
			'the caption or "fact" gives the answer away: it contains the answer or an answer option. Point at it without writing it',
		);
	return { values: filling.values, emphasis: null, fact: filling.fact };
}
