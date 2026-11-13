import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSessionViewContext } from "learnharness-plugin-api";
import { conceptFromView, MAX_PROMPT_LENGTH } from "../src/concept.ts";

/** Only the fields conceptFromView reads; the host supplies the full snapshot. */
function view(
	input: unknown,
	transcript: unknown[] = [],
): PluginSessionViewContext {
	return {
		sessionId: "s",
		kind: "teaching",
		title: "t",
		messages: [],
		transcript,
		input,
	} as unknown as PluginSessionViewContext;
}
const teacher = (text: string) => ({
	id: "m",
	role: "assistant",
	parts: [
		{ type: "reasoning", text: "hidden" },
		{ type: "text", text },
	],
});

test("a revealed native question is the concept, with its context and options", () => {
	const question = {
		id: "q",
		kind: "quiz",
		mode: "single",
		question: " Who backed CUDA? ",
		context: "GPU computing, 2006.",
		options: [
			{ label: "Jensen Huang", value: "a" },
			{ label: "Lisa Su", value: "b" },
		],
	};
	assert.deepEqual(
		conceptFromView(view({ type: "answer", revealed: true, question })),
		{
			status: "found",
			concept: {
				prompt: "Who backed CUDA?",
				context:
					"GPU computing, 2006.\n\nAnswer options shown to the learner: Jensen Huang | Lisa Su",
			},
		},
	);
	assert.deepEqual(
		conceptFromView(view({ type: "answer", revealed: false, question })),
		{ status: "hidden" },
	);
});

test("plugin questions and practice problems are read from their own fields", () => {
	assert.deepEqual(
		conceptFromView(
			view({
				type: "plugin-question-answer",
				revealed: true,
				input: { question: "Order these steps", payload: {} },
			}),
		),
		{ status: "found", concept: { prompt: "Order these steps" } },
	);
	assert.deepEqual(
		conceptFromView(
			view({
				type: "plugin-question-answer",
				revealed: false,
				input: { question: "x", payload: {} },
			}),
		),
		{ status: "hidden" },
	);
	assert.deepEqual(
		conceptFromView(
			view({
				type: "thinking",
				problem: { statement: "Derive the gradient." },
			}),
		),
		{ status: "found", concept: { prompt: "Derive the gradient." } },
	);
	assert.deepEqual(
		conceptFromView(
			view({
				type: "plugin-problem-submission",
				input: { statement: "Write a loop." },
			}),
		),
		{ status: "found", concept: { prompt: "Write a loop." } },
	);
});

test("without a pending question the teacher's latest message is used", () => {
	const transcript = [
		teacher("Old message?"),
		{ id: "u", role: "user", parts: [{ type: "text", text: "learner reply" }] },
		teacher(
			"CUDA is a platform.\n\nWhy did it need a patron?\n\nTake your time.",
		),
	];
	assert.deepEqual(conceptFromView(view({ type: "text" }, transcript)), {
		status: "found",
		concept: { prompt: "Why did it need a patron?" },
	});
	assert.deepEqual(
		conceptFromView(
			view({ type: "text" }, [teacher("A statement.\n\nAnother statement.")]),
		),
		{ status: "found", concept: { prompt: "Another statement." } },
	);
	assert.deepEqual(conceptFromView(view({ type: "text" })), { status: "none" });
	assert.deepEqual(
		conceptFromView(
			view(
				{ type: "unavailable", revealed: false, expanded: false },
				transcript,
			),
		),
		{ status: "hidden" },
	);
});

test("long questions are clipped to the backend's limit", () => {
	const result = conceptFromView(
		view({
			type: "thinking",
			problem: { statement: "x".repeat(MAX_PROMPT_LENGTH + 500) },
		}),
	);
	assert.equal(result.status, "found");
	if (result.status === "found")
		assert.equal(result.concept.prompt.length, MAX_PROMPT_LENGTH);
});
