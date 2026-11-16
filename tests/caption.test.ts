import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_LINE_WORDS, parseCaption } from "../src/caption.ts";
import catalogue from "../src/data/memegen-templates.json" with {
	type: "json",
};
import {
	BEST_FOR,
	captionRequest,
	extractJson,
	pickRequest,
} from "../src/prompts.ts";
import { applySettingsPatch, DEFAULT_SETTINGS } from "../src/settings.ts";

const drake = {
	id: "memegen:drake",
	name: "Drakeposting",
	caption: ["left on unread", "left on read"],
};
const custom = {
	id: "custom:proud",
	name: "Proud speech",
	caption: ["She fixed the printer is what she did."],
};

test("a caption needs exactly one short line per box and a fact", () => {
	assert.deepEqual(
		parseCaption(
			{
				lines: ["  CPU-only   math ", "CUDA on the GPU"],
				fact: "CUDA runs math on GPUs.",
			},
			2,
		),
		{
			lines: ["CPU-only math", "CUDA on the GPU"],
			fact: "CUDA runs math on GPUs.",
		},
	);
	// A box the original leaves empty may stay empty, but not every box.
	assert.deepEqual(
		parseCaption({ lines: ["", "this is fine"], fact: "f" }, 2).lines,
		["", "this is fine"],
	);
	assert.throws(
		() => parseCaption({ lines: ["", " "], fact: "f" }, 2),
		/all empty/,
	);
	assert.throws(
		() => parseCaption({ lines: ["only one"], fact: "f" }, 2),
		/exactly 2 entries/,
	);
	assert.throws(
		() =>
			parseCaption(
				{
					lines: [
						Array.from({ length: MAX_LINE_WORDS + 1 }, () => "word").join(" "),
					],
					fact: "f",
				},
				1,
			),
		/line 1 is too long/,
	);
	assert.throws(
		() => parseCaption({ lines: ["x".repeat(71)], fact: "f" }, 1),
		/too long/,
	);
	assert.throws(() => parseCaption({ lines: ["ok"] }, 1), /"fact" is missing/);
	assert.throws(() => parseCaption(["ok"], 1), /JSON object/);
	// Braces and line breaks never reach the meme.
	assert.deepEqual(parseCaption({ lines: ["a{b}\nc"], fact: "f" }, 1).lines, [
		"a b c",
	]);
});

test("JSON is found inside fences and prose", () => {
	assert.deepEqual(
		extractJson('Sure!\n```json\n{"a": {"b": "}"}}\n```\nDone.'),
		{ a: { b: "}" } },
	);
	assert.deepEqual(extractJson('{broken} then {"ok": true}'), { ok: true });
	assert.throws(() => extractJson("no object here"), /JSON object/);
});

test("every best-for note names a template in the bundled catalogue", () => {
	const ids = new Set(catalogue.templates.map((template) => template.id));
	assert.equal(Object.keys(BEST_FOR).length, 22);
	for (const id of Object.keys(BEST_FOR)) assert.ok(ids.has(id), id);
});

test("the pick request matches joke structure to format and shows best-for notes", () => {
	const { systemPrompt, user } = pickRequest(
		{ prompt: "Which is faster for matrix math?", context: "GPU history" },
		[drake, custom],
	);
	assert.match(systemPrompt, /Start with the take/);
	assert.match(systemPrompt, /Comparison or preference: Drake, Pooh/);
	assert.match(systemPrompt, /Dilemma: Daily Struggle, Left Exit/);
	assert.match(
		user,
		/1\. Drakeposting: left on unread \/ left on read \(best for: "This not that" comparisons\)/,
	);
	// A meme outside the skill's table has no note.
	assert.match(
		user,
		/2\. Proud speech: She fixed the printer is what she did\.$/m,
	);
	assert.match(user, /GPU history/);
});

test("the caption request asks for tight copy, one line per box, with the facts rules", () => {
	const { systemPrompt, user } = captionRequest({
		meme: drake,
		concept: {
			prompt: "Which is faster for matrix math?",
			context: "Options: A | B",
			answer: { correct: ["GPU"], others: ["CPU"] },
		},
		avoid: "CPUs are faster.",
	});
	assert.match(systemPrompt, /Start with the take/);
	assert.match(systemPrompt, /exaggeration and absurdity, not puns/);
	assert.match(systemPrompt, /punchline in the last line that has text/);
	assert.match(systemPrompt, /Write exactly 2 lines, one per text box/);
	assert.match(systemPrompt, /at most 8 words and 70 characters per line/);
	assert.match(
		systemPrompt,
		/- The lines must state true facts that answer the learner's question\. Never invent names, dates or numbers\./,
	);
	assert.match(
		systemPrompt,
		/- A joke must never need a claim that is false or unsupported by the fact; when it would, state the plain fact instead\./,
	);
	assert.match(systemPrompt, /\{"lines": string\[\], "fact": string\}/);
	assert.match(user, /Which is faster for matrix math\?/);
	assert.match(user, /Options: A \| B/);
	assert.match(user, /The correct answer is: GPU\. The fact must say so\./);
	assert.match(user, /"CPUs are faster\."/);
	assert.match(user, /Best for: "This not that" comparisons/);
	assert.match(user, /1\. left on unread\n2\. left on read/);
	assert.match(
		captionRequest({ meme: custom, concept: { prompt: "q" } }).systemPrompt,
		/Write exactly 1 line, one per text box/,
	);
});

// #36 comic effect
test("tone none adds nothing; each other tone adds one tone line and keeps the rules", () => {
	const concept = { prompt: "Who backed CUDA?" };
	const base = captionRequest({ meme: drake, concept });
	assert.deepEqual(
		captionRequest({ meme: drake, concept, tone: "none" }),
		base,
	);
	for (const tone of [
		"deadpan",
		"absurd",
		"sarcastic",
		"self-deprecating",
		"playful",
	] as const) {
		const toned = captionRequest({ meme: drake, concept, tone });
		const lines = toned.systemPrompt.split("\n");
		assert.equal(lines.length, base.systemPrompt.split("\n").length + 1, tone);
		assert.equal(
			lines.filter((line) => line.startsWith("- Tone: ")).length,
			1,
			tone,
		);
		assert.match(toned.systemPrompt, /never copy them or their facts/);
		assert.match(
			toned.systemPrompt,
			/A joke must never need a claim that is false or unsupported by the fact/,
		);
		assert.equal(toned.user, base.user, tone);
	}
});

test("tone is validated like the other settings", () => {
	assert.equal(DEFAULT_SETTINGS.tone, "none");
	assert.equal(
		applySettingsPatch(DEFAULT_SETTINGS, { tone: "absurd" }).tone,
		"absurd",
	);
	assert.throws(
		() => applySettingsPatch(DEFAULT_SETTINGS, { tone: "loud" }),
		/tone must be one of none, deadpan/,
	);
});

test("the emphasis setting is gone; a stored value is ignored", () => {
	assert.equal("emphasis" in DEFAULT_SETTINGS, false);
	assert.throws(
		() => applySettingsPatch(DEFAULT_SETTINGS, { emphasis: true }),
		/Unknown setting: emphasis/,
	);
});
