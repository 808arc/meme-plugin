/** Step 1 of the README: take the concept from what LearnHarness is asking.
 * Reads only the host's detached session snapshot; never the page DOM. */
import type { PluginSessionViewContext } from "learnharness-plugin-api";
import type { Concept } from "./types.ts";

export const MAX_PROMPT_LENGTH = 2000;
export const MAX_CONTEXT_LENGTH = 2000;

export type ConceptResult =
	| { status: "found"; concept: Concept }
	/** A question exists but the learner has not revealed it; a meme would show it early. */
	| { status: "hidden" }
	| { status: "none" };

const clip = (text: string, limit: number) =>
	text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;

function found(prompt: string, context?: string): ConceptResult {
	const question = prompt.trim();
	if (!question) return { status: "none" };
	const extra = context?.trim();
	return {
		status: "found",
		concept: {
			prompt: clip(question, MAX_PROMPT_LENGTH),
			...(extra ? { context: clip(extra, MAX_CONTEXT_LENGTH) } : {}),
		},
	};
}

/** The teacher's latest prose, used when no question card is pending. */
function latestTeacherText(view: PluginSessionViewContext): string {
	for (let index = view.transcript.length - 1; index >= 0; index--) {
		const message = view.transcript[index]!;
		if (message.role !== "assistant") continue;
		const text = message.parts
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text as string)
			.join("\n")
			.trim();
		if (!text) continue;
		// Prefer the closing question when the teacher ended on one.
		const paragraphs = text
			.split(/\n{2,}/)
			.map((part) => part.trim())
			.filter(Boolean);
		const asking = paragraphs.findLast((part) => part.includes("?"));
		return asking ?? paragraphs.at(-1) ?? text;
	}
	return "";
}

export function conceptFromView(view: PluginSessionViewContext): ConceptResult {
	const input = view.input;
	switch (input.type) {
		case "answer": {
			if (!input.revealed) return { status: "hidden" };
			const options = input.question.options
				.map((option) => option.label)
				.filter(Boolean);
			const context = [
				input.question.context ?? "",
				options.length
					? `Answer options shown to the learner: ${options.join(" | ")}`
					: "",
			]
				.filter(Boolean)
				.join("\n\n");
			return found(input.question.question, context);
		}
		case "plugin-question-answer":
			return input.revealed
				? found(input.input.question)
				: { status: "hidden" };
		case "thinking":
			return found(input.problem.statement);
		case "plugin-problem-submission":
			return found(input.input.statement);
		case "unavailable":
			return input.revealed
				? found(latestTeacherText(view))
				: { status: "hidden" };
		case "text":
			return found(latestTeacherText(view));
	}
}

// #17 meme modes. Design: docs/meme-modes.md.

/** What Hint and Think may read from a question the learner has not revealed. */
export interface EarlyRead {
	concept: Concept;
	/** Option labels, for the no-answer check. Never which one is correct. */
	options: string[];
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const labels = (options: unknown): string[] =>
	Array.isArray(options)
		? options.map((option) => text(option?.label).trim()).filter(Boolean)
		: [];

/** Pre-reveal read path, for Hint and Think only. Fields are whitelisted: question
 * text, context and option labels. Never the draft, payload, history, or any answer
 * key the host might attach. Anything else unrevealed stays unread (null). */
export function conceptBeforeReveal(
	view: PluginSessionViewContext,
): EarlyRead | null {
	const input = view.input;
	if (input.type === "answer" && !input.revealed) {
		const question = input.question;
		const options = labels(question.options);
		const result = found(
			text(question.question),
			[
				text(question.context),
				options.length
					? `Answer options the learner will see: ${options.join(" | ")}`
					: "",
			]
				.filter(Boolean)
				.join("\n\n"),
		);
		return result.status === "found"
			? { concept: result.concept, options }
			: null;
	}
	if (input.type === "plugin-question-answer" && !input.revealed) {
		const result = found(text(input.input.question));
		return result.status === "found"
			? { concept: result.concept, options: [] }
			: null;
	}
	return null;
}

/** Option labels of a revealed native question, for the no-answer check. */
export function optionLabels(view: PluginSessionViewContext): string[] {
	const input = view.input;
	return input.type === "answer" && input.revealed
		? labels(input.question.options)
		: [];
}
