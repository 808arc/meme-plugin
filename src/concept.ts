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

/** #18: the last native question the learner answered, read from the session history. */
export interface AnsweredQuestion {
	/** Session and question call id. */
	key: string;
	concept: Concept;
	/** The host graded the answer as wrong. Ungraded answers are not wrong. */
	wrong: boolean;
	/** When the learner answered, in ms; NaN when unknown. */
	answeredAt: number;
}

/** The host stores the graded answer (`QuestionAnswerData`) as the question call's tool
 * result `details`. Only the latest one counts; a dismissed question has no answer to show. */
export function lastAnsweredQuestion(
	view: PluginSessionViewContext,
): AnsweredQuestion | null {
	for (let index = view.messages.length - 1; index >= 0; index--) {
		// Read as plain data: the deep readonly message type is too large to narrow.
		const message = view.messages[index] as unknown as {
			role?: unknown;
			toolCallId?: unknown;
			details?: unknown;
		};
		if (message.role !== "toolResult" || typeof message.toolCallId !== "string")
			continue;
		const details = message.details as
			| {
					questionText?: unknown;
					answeredAt?: unknown;
					options?: unknown;
					correct?: unknown;
					dismissed?: unknown;
			  }
			| null
			| undefined;
		if (
			!details ||
			typeof details !== "object" ||
			typeof details.questionText !== "string" ||
			typeof details.answeredAt !== "string"
		)
			continue;
		if (details.dismissed === true) return null;
		const options = Array.isArray(details.options)
			? details.options
					.map((option: { label?: unknown } | null) =>
						typeof option?.label === "string" ? option.label : "",
					)
					.filter(Boolean)
			: [];
		const result = found(
			details.questionText,
			options.length
				? `Answer options shown to the learner: ${options.join(" | ")}`
				: undefined,
		);
		if (result.status !== "found") return null;
		return {
			key: `${view.sessionId}:${message.toolCallId}`,
			concept: result.concept,
			wrong: details.correct === false,
			answeredAt: Date.parse(details.answeredAt),
		};
	}
	return null;
}
