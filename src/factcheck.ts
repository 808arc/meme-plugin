/** Fact check: a generated fact must agree with the question before its meme is shown.
 * The shortcut and the reply parser are pure; the model is only asked when the shortcut is silent. */
import type { ModelRequest } from "./prompts.ts";
import { normalize } from "./caption.ts";
import type { Concept, ConceptAnswer } from "./types.ts";

const MAX_LABEL_LENGTH = 200;

const escapeRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word containment on normalized text. */
function mentions(text: string, label: string): boolean {
	const needle = normalize(label);
	return (
		!!needle &&
		new RegExp(
			`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}])`,
			"u",
		).test(text)
	);
}

/** Certain cases only: the fact names a correct option and no wrong one. `undefined` means ask the model. */
export function quickAgreement(
	fact: string,
	answer: ConceptAnswer,
): boolean | undefined {
	const text = normalize(fact);
	if (answer.others.some((label) => mentions(text, label))) return undefined;
	return answer.correct.some((label) => mentions(text, label))
		? true
		: undefined;
}

/** Self-check request: one cheap question about the fact, answered as JSON. */
export function agreementRequest(input: {
	concept: Concept;
	fact: string;
}): ModelRequest {
	const { concept } = input;
	const rule = concept.answer
		? `The correct answer is: ${concept.answer.correct.join(" | ")}. The fact must state that this answer is correct and must not state that any other option is correct.`
		: "The fact must be true and must directly answer the question.";
	return {
		systemPrompt: [
			"You check one study fact against a learner's question.",
			rule,
			'Reply with one JSON object and nothing else: {"agrees": boolean}',
		].join("\n"),
		user: [
			`Question:\n${concept.prompt}`,
			concept.context ? `Shown with the question:\n${concept.context}` : "",
			`Fact:\n${input.fact}`,
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}

export function parseAgreement(raw: unknown): boolean {
	const agrees =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as Record<string, unknown>).agrees
			: undefined;
	if (typeof agrees !== "boolean")
		throw new Error('"agrees" must be true or false');
	return agrees;
}

/** The answer key sent by the frontend, validated; anything malformed is dropped. */
export function parseAnswer(raw: unknown): ConceptAnswer | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const item = raw as Record<string, unknown>;
	const list = (value: unknown): string[] | undefined => {
		if (!Array.isArray(value)) return undefined;
		const labels = value.map((label) =>
			typeof label === "string" ? label.trim() : "",
		);
		if (labels.some((label) => !label || label.length > MAX_LABEL_LENGTH))
			return undefined;
		return labels;
	};
	const correct = list(item.correct);
	const others = list(item.others);
	if (!correct?.length || !others) return undefined;
	return { correct, others };
}
