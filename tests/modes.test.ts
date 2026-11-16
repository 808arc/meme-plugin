/** #17 meme modes: the pre-reveal read path, the Hint/Think prompts and the
 * no-answer check. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSessionViewContext } from "learnharness-plugin-api";
import {
	conceptBeforeReveal,
	conceptFromView,
	optionLabels,
} from "../src/concept.ts";
import { SHUFFLE_SEQUENCE } from "../src/config.ts";
import {
	concreteMode,
	givesAnswerAway,
	hintFillRequest,
	parseModeFilling,
	readOptions,
	thinkFillRequest,
} from "../src/modes.ts";

const SECRET = "SECRET-ANSWER-KEY";
function view(input: unknown): PluginSessionViewContext {
	return {
		sessionId: "s",
		kind: "teaching",
		title: "t",
		messages: [{ role: "custom", content: SECRET }],
		transcript: [
			{ id: "m", role: "assistant", parts: [{ type: "text", text: SECRET }] },
		],
		input,
	} as unknown as PluginSessionViewContext;
}
/** A host that leaks answer-key fields onto the question object at runtime. */
const leaky = {
	id: "q",
	kind: "quiz",
	mode: "single-select",
	question: "Who backed CUDA?",
	context: "GPU computing, 2006.",
	options: [
		{ label: "Jensen Huang", value: "a", correct: true, explanation: SECRET },
		{ label: "Lisa Su", value: "b" },
	],
	correctIndices: [0],
	correctAnswer: SECRET,
	committedAnswer: SECRET,
	explanation: SECRET,
};
const draft = { values: ["a"], text: SECRET, thinking: SECRET };

test("before reveal only question text, context and option labels are read", () => {
	const hidden = view({
		type: "answer",
		revealed: false,
		question: leaky,
		draft,
	});
	// Answer mode's read path is unchanged: nothing is read.
	assert.deepEqual(conceptFromView(hidden), { status: "hidden" });
	const early = conceptBeforeReveal(hidden);
	assert.deepEqual(early, {
		concept: {
			prompt: "Who backed CUDA?",
			context:
				"GPU computing, 2006.\n\nAnswer options the learner will see: Jensen Huang | Lisa Su",
		},
		options: ["Jensen Huang", "Lisa Su"],
	});
	assert.ok(
		!JSON.stringify(early).includes(SECRET),
		"no answer key, draft or history",
	);
});

test("an unrevealed plugin question is read without its payload; other inputs are not read early", () => {
	assert.deepEqual(
		conceptBeforeReveal(
			view({
				type: "plugin-question-answer",
				revealed: false,
				input: { question: "Order these steps", payload: { answer: SECRET } },
				draft: { answer: { status: "ready", value: SECRET } },
			}),
		),
		{ concept: { prompt: "Order these steps" }, options: [] },
	);
	assert.equal(
		conceptBeforeReveal(
			view({ type: "unavailable", revealed: false, expanded: false }),
		),
		null,
		"nothing safe to read",
	);
	assert.equal(
		conceptBeforeReveal(
			view({ type: "answer", revealed: true, question: leaky }),
		),
		null,
		"revealed questions use the normal path",
	);
	assert.equal(
		conceptBeforeReveal(
			view({ type: "answer", revealed: false, question: { question: "  " } }),
		),
		null,
	);
	assert.deepEqual(
		optionLabels(view({ type: "answer", revealed: true, question: leaky })),
		["Jensen Huang", "Lisa Su"],
	);
	assert.deepEqual(
		optionLabels(view({ type: "answer", revealed: false, question: leaky })),
		[],
	);
});

test("the no-answer check matches whole words, ignoring case, accents and punctuation", () => {
	assert.equal(givesAnswerAway(["Ask JENSEN-huang!"], ["Jensen Huang"]), true);
	assert.equal(givesAnswerAway(["Café owner"], ["cafe"]), true);
	assert.equal(givesAnswerAway(["2 + 2 is 4"], ["4"]), true);
	assert.equal(givesAnswerAway(["It starts with J"], ["Jensen Huang"]), false);
	assert.equal(givesAnswerAway(["forty"], ["4"]), false);
	assert.equal(givesAnswerAway(["Sunday"], ["Sun"]), false, "whole words only");
	assert.equal(givesAnswerAway(["anything"], ["", "?!"]), false);
});

/** Two boxes, as the "Two panel" meme has. */
const BOXES = 2;
const reply = (
	values: Record<string, string>,
	fact: string,
	answer?: string,
) => ({
	lines: [values.rejected, values.preferred],
	fact,
	...(answer === undefined ? {} : { answer }),
});

test("a Hint or Think reply is rejected when it names the answer or any option", () => {
	const ok = parseModeFilling(
		reply(
			{ rejected: "a chip rival's boss", preferred: "a GPU maker's boss" },
			"Think of who runs the company that sells GeForce.",
			"Jensen Huang",
		),
		BOXES,
		["Jensen Huang", "Lisa Su"],
	);
	assert.deepEqual(ok, {
		lines: ["a chip rival's boss", "a GPU maker's boss"],
		fact: "Think of who runs the company that sells GeForce.",
	});
	assert.ok(!("answer" in ok), "the model's answer is dropped");

	const leak = (values: Record<string, string>, fact: string) => () =>
		parseModeFilling(reply(values, fact, "Jensen Huang"), BOXES, [
			"Jensen Huang",
			"Lisa Su",
		]);
	assert.throws(
		leak({ rejected: "x", preferred: "jensen huang" }, "Hint."),
		/give the answer away/,
	);
	assert.throws(
		leak({ rejected: "Lisa Su", preferred: "y" }, "Hint."),
		/give the answer away/,
		"wrong options too",
	);
	assert.throws(
		leak({ rejected: "x", preferred: "y" }, "It is Jensen Huang."),
		/give the answer away/,
		"the note counts",
	);
	// Without options, the model's own answer is still checked.
	assert.throws(
		() =>
			parseModeFilling(
				reply({ rejected: "x", preferred: "Huang" }, "Hint.", "Huang"),
				BOXES,
				[],
			),
		/give the answer away/,
	);
	assert.throws(
		() =>
			parseModeFilling(
				reply({ rejected: "x", preferred: "y" }, "Hint."),
				BOXES,
				[],
			),
		/"answer" is missing/,
	);
	assert.throws(
		() =>
			parseModeFilling(
				reply({ rejected: "x", preferred: "y" }, "Hint.", "z".repeat(81)),
				BOXES,
				[],
			),
		/"answer" is longer/,
	);
	// The rejection reason never quotes the answer (it can reach the screen).
	try {
		leak({ rejected: "x", preferred: "Jensen Huang" }, "Hint.")();
	} catch (error) {
		assert.ok(!(error as Error).message.includes("Jensen"));
	}
});

test("option input is refused when malformed, never clipped", () => {
	assert.deepEqual(readOptions(undefined), []);
	assert.deepEqual(readOptions([" A ", ""]), ["A"]);
	assert.throws(() => readOptions("A | B"), /options/);
	assert.throws(() => readOptions([1]), /options/);
	assert.throws(() => readOptions(Array(13).fill("x")), /options/);
	assert.throws(() => readOptions(["x".repeat(201)]), /options/);
});

test("Hint and Think prompts forbid the answer and say when the question is unseen", () => {
	const input = {
		meme: {
			name: "Two panel",
			caption: ["manual backups", "automatic backups"],
		},
		concept: { prompt: "Who backed CUDA?", context: "GPU history" },
		early: true,
	};
	const hint = hintFillRequest(input);
	const think = thinkFillRequest({ ...input, early: false });
	assert.match(hint.systemPrompt, /gives a hint/);
	assert.match(think.systemPrompt, /only one is true/);
	for (const request of [hint, think]) {
		assert.match(request.systemPrompt, /Never write the answer/);
		assert.match(
			request.systemPrompt,
			/Never write the text of any answer option/,
		);
		assert.match(
			request.systemPrompt,
			/Write exactly 2 lines, one per text box/,
		);
		assert.match(request.systemPrompt, /"lines": string\[\]/);
		assert.match(request.systemPrompt, /"answer": string/);
		assert.match(
			request.user,
			/Who backed CUDA\?[\s\S]*GPU history[\s\S]*Meme: Two panel/,
		);
	}
	assert.match(hint.user, /have not seen it yet/);
	assert.match(think.user, /^The learner is being asked/);
});

// #32 shuffle mode

test("shuffle resolves to answer, hint, think, then repeats; other modes pass through", () => {
	const order = [0, 1, 2, 3, 4, 5, 6].map((position) =>
		concreteMode("shuffle", position),
	);
	assert.deepEqual(order, [
		"answer",
		"hint",
		"think",
		"answer",
		"hint",
		"think",
		"answer",
	]);
	assert.deepEqual(SHUFFLE_SEQUENCE, ["answer", "hint", "think"]);
	assert.equal(concreteMode("hint", 7), "hint");
	assert.equal(concreteMode("think", 0), "think");
	assert.equal(concreteMode("answer", 2), "answer");
	assert.equal(
		concreteMode("shuffle", -1),
		"answer",
		"a bad position starts over",
	);
	assert.equal(
		concreteMode("shuffle", 1.5),
		"answer",
		"a bad position starts over",
	);
});
