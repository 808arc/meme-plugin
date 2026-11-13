/** Caption templates: validation of model output and deterministic assembly.
 * The model proposes; this module decides what is accepted and builds the text. */
import type { Emphasis, Filling, Slot, Template } from "./types.ts";

const SLOT_NAME = /^[a-z][a-z0-9_]{0,23}$/;
const SLOT = /\{([a-z][a-z0-9_]{0,23})\}/g;
export const MAX_SLOTS = 6;
export const MAX_VALUE_LENGTH = 90;
export const MAX_EMPHASIS_LENGTH = 40;
export const MAX_FACT_LENGTH = 300;

function record(value: unknown, what: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${what} must be a JSON object`);
	return value as Record<string, unknown>;
}

/** One line of plain text: no control characters, braces or line breaks. */
export function cleanText(value: unknown): string {
	if (typeof value !== "string") return "";
	return value.replace(/[\u0000-\u001f\u007f{}]/g, " ").replace(/\s+/g, " ").trim();
}

/** Comparison form: case, spacing and quote style do not make two captions different. */
export function normalize(text: string): string {
	return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

export function slotNames(lines: readonly string[]): string[] {
	const names = new Set<string>();
	for (const line of lines) for (const match of line.matchAll(SLOT)) names.add(match[1]!);
	return [...names];
}

export function fill(text: string, values: Readonly<Record<string, string>>): string {
	return text.replace(SLOT, (whole, name: string) => values[name] ?? whole);
}

/** Accept a model-proposed template only if it provably reproduces the caption. */
export function parseTemplate(raw: unknown, caption: readonly string[]): Template {
	const item = record(raw, "The template");
	if (!Array.isArray(item.lines) || item.lines.length !== caption.length) throw new Error(`"lines" must have exactly ${caption.length} entries, one per caption line`);
	// A box the original meme leaves empty stays empty whatever the model wrote there.
	const lines = item.lines.map((line, index) => (typeof line === "string" && caption[index] ? line.replace(/\s+/g, " ").trim() : ""));
	if (!Array.isArray(item.slots)) throw new Error('"slots" must be an array');
	const slots: Slot[] = item.slots.map((entry) => {
		const slot = record(entry, "Each slot");
		const name = typeof slot.name === "string" ? slot.name : "";
		if (!SLOT_NAME.test(name)) throw new Error(`Slot name "${name}" must be lowercase snake_case, at most 24 characters`);
		const original = cleanText(slot.original);
		if (!original) throw new Error(`Slot "${name}" needs the original words it replaces`);
		return { name, hint: cleanText(slot.hint).slice(0, 120) || name.replace(/_/g, " "), original };
	});
	if (!slots.length || slots.length > MAX_SLOTS) throw new Error(`A template needs between 1 and ${MAX_SLOTS} slots`);
	if (new Set(slots.map((slot) => slot.name)).size !== slots.length) throw new Error("Slot names must be unique");
	const used = slotNames(lines);
	for (const slot of slots) if (!used.includes(slot.name)) throw new Error(`Slot "${slot.name}" is declared but not used in any line`);
	for (const name of used) if (!slots.some((slot) => slot.name === name)) throw new Error(`Line placeholder {${name}} has no slot entry`);
	const originals = Object.fromEntries(slots.map((slot) => [slot.name, slot.original]));
	lines.forEach((line, index) => {
		if (/[{}]/.test(line.replace(SLOT, ""))) throw new Error(`Line ${index + 1} contains braces that are not a {slot_name} placeholder`);
		// The fixed phrasing is whatever survives this check: the model cannot reword the meme.
		if (normalize(fill(line, originals)) !== normalize(caption[index] ?? "")) throw new Error(`Line ${index + 1} does not reproduce the original caption when its slots are filled with their "original" words`);
	});
	return { lines, slots, voice: cleanText(item.voice).slice(0, 200) };
}

/** Template sentences in reading order. Emphasis positions refer to this list. */
export function sentences(template: Pick<Template, "lines">): { line: number; text: string }[] {
	return template.lines.flatMap((text, line) => text.split(/(?<=[.!?…])\s+/).filter(Boolean).map((part) => ({ line, text: part })));
}

/** Accept model-proposed slot values, clamped to what fits on a meme. */
export function parseFilling(raw: unknown, template: Template): Filling {
	const item = record(raw, "The reply");
	const given = record(item.values, '"values"');
	const values: Record<string, string> = {};
	for (const slot of template.slots) {
		const value = cleanText(given[slot.name]);
		if (!value) throw new Error(`"values.${slot.name}" is missing`);
		if (value.length > MAX_VALUE_LENGTH) throw new Error(`"values.${slot.name}" is longer than ${MAX_VALUE_LENGTH} characters; a meme needs a short phrase`);
		values[slot.name] = value;
	}
	const fact = cleanText(item.fact).slice(0, MAX_FACT_LENGTH);
	if (!fact) throw new Error('"fact" is missing');
	let emphasis: Emphasis | null = null;
	if (item.emphasis !== null && item.emphasis !== undefined) {
		const entry = record(item.emphasis, '"emphasis"');
		const text = cleanText(entry.text);
		const count = sentences(template).length;
		// Emphasis is optional decoration: an unusable one is dropped, not an error.
		if (text && text.length <= MAX_EMPHASIS_LENGTH && Number.isInteger(entry.after) && (entry.after as number) >= 1 && (entry.after as number) <= count) emphasis = { after: entry.after as number, text };
	}
	return { values, emphasis, fact };
}

/** Build the final caption lines. Fixed phrasing comes from the template, never the model. */
export function assemble(template: Pick<Template, "lines">, values: Readonly<Record<string, string>>, emphasis: Emphasis | null): string[] {
	const lines = template.lines.map(() => [] as string[]);
	sentences(template).forEach((sentence, index) => {
		lines[sentence.line]!.push(fill(sentence.text, values));
		if (emphasis && emphasis.after === index + 1) lines[sentence.line]!.push(emphasis.text);
	});
	return lines.map((parts) => parts.join(" "));
}
