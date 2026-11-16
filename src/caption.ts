/** Captions: validation of model output. The process follows the Vellum meme-generator
 * skill (MIT, github.com/vellum-ai/vellum-assistant, skills/meme-generator): pick the
 * template by its joke structure, then write tight copy, one short line per box.
 * The model proposes; this module decides what is accepted. */
import type { Caption } from "./types.ts";

/** "3-8 words per line max" (Vellum); the character limit catches long words too. */
export const MAX_LINE_WORDS = 8;
export const MAX_LINE_LENGTH = 70;
export const MAX_FACT_LENGTH = 300;

function record(value: unknown, what: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${what} must be a JSON object`);
	return value as Record<string, unknown>;
}

/** One line of plain text: no control characters, braces or line breaks. */
export function cleanText(value: unknown): string {
	if (typeof value !== "string") return "";
	return value
		.replace(/[\u0000-\u001f\u007f{}]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Comparison form: case, spacing and quote style do not make two captions different. */
export function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

const words = (line: string) => line.split(" ").filter(Boolean).length;

/** Accept model-written lines: exactly one per box, each short enough to read on a
 * meme, at least one not empty, plus the fact as one plain sentence. */
export function parseCaption(raw: unknown, boxes: number): Caption {
	const item = record(raw, "The reply");
	if (!Array.isArray(item.lines) || item.lines.length !== boxes)
		throw new Error(
			`"lines" must have exactly ${boxes} ${boxes === 1 ? "entry" : "entries"}, one per text box`,
		);
	const lines = item.lines.map(cleanText);
	lines.forEach((line, index) => {
		if (line.length > MAX_LINE_LENGTH || words(line) > MAX_LINE_WORDS)
			throw new Error(
				`line ${index + 1} is too long; a meme line has at most ${MAX_LINE_WORDS} words`,
			);
	});
	if (lines.every((line) => !line))
		throw new Error('"lines" are all empty; write the meme text');
	const fact = cleanText(item.fact).slice(0, MAX_FACT_LENGTH);
	if (!fact) throw new Error('"fact" is missing');
	return { lines, fact };
}
