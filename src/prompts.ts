/** Model-facing wording for steps 3 to 5 of the README. Product text: edit freely.
 * Bump PROMPT_VERSION when the template instructions change so cached templates rebuild. */
import {
	MAX_EMPHASIS_LENGTH,
	MAX_SLOTS,
	MAX_VALUE_LENGTH,
	sentences,
} from "./template.ts";
import type { Concept, Meme, Template } from "./types.ts";

export const PROMPT_VERSION = 3;

export interface ModelRequest {
	systemPrompt: string;
	user: string;
}

const numbered = (lines: readonly string[]) =>
	lines.map((line, index) => `${index + 1}. ${line || "(empty)"}`).join("\n");

/** Step 2: choose, from candidate memes, the one whose joke structure fits the concept. */
export function pickRequest(
	concept: Concept,
	candidates: readonly Pick<Meme, "name" | "caption">[],
): ModelRequest {
	return {
		systemPrompt: [
			'You choose which meme to use for a study question. Pick the meme whose joke structure fits the concept: a comparison, an escalation, a betrayal, a "nobody: / me:" contrast, and so on.',
			"Judge each meme by its original caption, which shows the shape of its joke.",
			'Reply with one JSON object and nothing else: {"choice": number}, where the number is the meme\'s number in the list.',
		].join("\n"),
		user: [
			`The learner is being asked:\n${concept.prompt}`,
			concept.context ? `Shown with the question:\n${concept.context}` : "",
			`Memes:\n${numbered(candidates.map((meme) => `${meme.name}: ${meme.caption.join(" / ")}`))}`,
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}

/** Step 3: reduce a caption to fixed memetic phrasing plus fillable slots. */
export function templateRequest(
	meme: Pick<Meme, "name" | "caption">,
): ModelRequest {
	return {
		systemPrompt: [
			"You turn the caption of an image meme into a reusable template.",
			"Keep the wording that makes the meme recognizable exactly as written. Replace only the parts that are about the caption's particular topic with placeholders written {slot_name}.",
			"Rules:",
			`- Return the same number of lines, in the same order. An empty line stays empty.`,
			`- Use 1 to ${MAX_SLOTS} slots. Slot names are lowercase snake_case and say what belongs there (achievement, descriptor, name).`,
			"- For every slot give the exact original words it replaces. Putting those words back must reproduce the caption word for word.",
			"- When a whole line is topic-specific, that line may be a single slot.",
			"- Describe in a few words how the meme's character talks.",
			'Reply with one JSON object and nothing else: {"lines": string[], "slots": [{"name": string, "hint": string, "original": string}], "voice": string}',
		].join("\n"),
		user: `Meme: ${meme.name}\nCaption lines:\n${numbered(meme.caption)}`,
	};
}

/** Steps 4 and 5: fill the slots with facts about the concept, optionally add emphasis. */
export function fillRequest(input: {
	meme: Pick<Meme, "name">;
	template: Template;
	concept: Concept;
	emphasis: boolean;
	/** A fact from an earlier attempt that did not agree with the question. */
	avoid?: string;
}): ModelRequest {
	const { template } = input;
	const answer = input.concept.answer
		? `The correct answer is: ${input.concept.answer.correct.join(" | ")}. The fact must say so.`
		: "";
	const emphasis = input.emphasis
		? `- You may add one short interjection (at most ${MAX_EMPHASIS_LENGTH} characters) in the character's voice that repeats the key term for emphasis, placed after one of the numbered sentences. Use null when it would not sound right.`
		: '- Set "emphasis" to null.';
	return {
		systemPrompt: [
			"You write the caption of a study meme. A learner is being asked about a concept; the meme must state the correct answer so that it sticks.",
			"You are given a meme template with slots. Fill every slot.",
			"Rules:",
			"- The filled caption must state true facts that answer the learner's question. Never invent names, dates or numbers. Prefer the single most important fact.",
			"- Make it funny the way the meme is funny: a setup and punchline, a contrast, or an exaggeration of the fact. A joke must never need a claim that is false or unsupported by the fact; when it would, state the plain fact instead.",
			`- Each value is a short phrase (at most ${MAX_VALUE_LENGTH} characters) that reads grammatically inside its sentence. Plain text only.`,
			"- Do not rewrite the fixed words of the template; you only supply slot values.",
			emphasis,
			'- "fact" is the same fact as one plain sentence, without the meme.',
			'Reply with one JSON object and nothing else: {"values": {slot_name: string}, "emphasis": {"after": number, "text": string} | null, "fact": string}',
		].join("\n"),
		user: [
			`The learner is being asked:\n${input.concept.prompt}`,
			input.concept.context
				? `Shown with the question:\n${input.concept.context}`
				: "",
			answer,
			input.avoid
				? `An earlier attempt wrote this fact, which does not agree with the question: "${input.avoid}". Write a fact that does.`
				: "",
			`Meme: ${input.meme.name}${template.voice ? `\nCharacter voice: ${template.voice}` : ""}`,
			`Template sentences:\n${numbered(sentences(template).map((sentence) => sentence.text))}`,
			`Slots:\n${template.slots.map((slot) => `- ${slot.name}: ${slot.hint} (the original meme said "${slot.original}")`).join("\n")}`,
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}

/** The first complete JSON object in a model reply, tolerating fences and prose around it. */
export function extractJson(text: string): unknown {
	for (
		let start = text.indexOf("{");
		start !== -1;
		start = text.indexOf("{", start + 1)
	) {
		let depth = 0,
			quoted = false,
			escaped = false;
		for (let index = start; index < text.length; index++) {
			const character = text[index]!;
			if (quoted) {
				if (escaped) escaped = false;
				else if (character === "\\") escaped = true;
				else if (character === '"') quoted = false;
			} else if (character === '"') quoted = true;
			else if (character === "{") depth++;
			else if (character === "}" && --depth === 0) {
				try {
					return JSON.parse(text.slice(start, index + 1));
				} catch {
					break;
				}
			}
		}
	}
	throw new Error("The reply did not contain a JSON object");
}
