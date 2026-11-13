/** Unit tests for the eval harness itself, with stub models. The live eval is run.ts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Meme } from "../../src/types.ts";
import { EVAL_CONCEPTS } from "./concepts.ts";
import {
	type Complete,
	eligibleMemes,
	formatReport,
	parseVerdict,
	pickMeme,
	runEval,
} from "./harness.ts";

const meme: Meme = {
	id: "custom:two",
	origin: "custom",
	name: "Two panel",
	image: "",
	caption: ["manual backups", "automatic backups"],
	boxes: [],
};

const verdict = (score: number) => ({
	fit: { score, reason: "fits" },
	humor: { score, reason: "funny" },
	accuracy: { score, reason: "true" },
});

/** Stub generator: fills every slot from the request, so any template works. */
const stubGenerate: Complete = async (request) => {
	if (request.systemPrompt.startsWith("You turn the caption")) {
		const caption = request.user
			.split("\n")
			.slice(2)
			.map((line) => line.replace(/^\d+\. /, ""));
		const slots = caption.map((line, index) => ({
			name: `part${index}`,
			hint: "text",
			original: line,
		}));
		return JSON.stringify({
			lines: caption.map((_, index) => `{part${index}}`),
			slots,
			voice: "",
		});
	}
	const values = Object.fromEntries(
		[...request.user.matchAll(/^- (\w+): /gm)].map((match) => [
			match[1],
			"filled",
		]),
	);
	return JSON.stringify({ values, emphasis: null, fact: "A stub fact." });
};

test("the concept set has about thirty unique concepts across subjects", () => {
	assert.ok(EVAL_CONCEPTS.length >= 28 && EVAL_CONCEPTS.length <= 35);
	assert.equal(
		new Set(EVAL_CONCEPTS.map((concept) => concept.id)).size,
		EVAL_CONCEPTS.length,
	);
	assert.ok(new Set(EVAL_CONCEPTS.map((concept) => concept.subject)).size >= 6);
});

test("verdicts must score every dimension from 1 to 5 with a reason", () => {
	assert.equal(parseVerdict(verdict(4)).fit.score, 4);
	assert.throws(
		() => parseVerdict({ ...verdict(4), humor: { score: 6, reason: "x" } }),
		/humor\.score/,
	);
	assert.throws(
		() => parseVerdict({ ...verdict(4), fit: { score: 2.5, reason: "x" } }),
		/fit\.score/,
	);
	assert.throws(
		() => parseVerdict({ ...verdict(4), accuracy: { score: 3, reason: " " } }),
		/accuracy\.reason/,
	);
	assert.throws(() => parseVerdict(["nope"]), /JSON object/);
});

test("memes are picked deterministically and ineligible memes are dropped", () => {
	const pool = [meme, { ...meme, id: "custom:other", caption: ["", ""] }];
	assert.equal(pickMeme(eligibleMemes(pool), 0).id, "custom:two");
	assert.equal(eligibleMemes(pool).length, 1);
	assert.throws(() => pickMeme([], 0), /empty/);
});

test("a stub run scores every concept and reports the means", async () => {
	const judge: Complete = async () => JSON.stringify(verdict(3));
	const run = await runEval({
		concepts: EVAL_CONCEPTS.slice(0, 4),
		memes: [meme],
		generate: stubGenerate,
		judge,
		generatorLabel: "stub/generator",
		judgeLabel: "stub/judge",
		now: new Date("2026-01-02T03:04:05.000Z"),
	});
	assert.equal(run.rows.length, 4);
	assert.equal(run.errors, 0);
	assert.deepEqual(run.means, { fit: 3, humor: 3, accuracy: 3 });
	assert.equal(run.rows[0]!.lines?.join(" / "), "filled / filled");
	assert.equal(run.rows[0]!.fact, "A stub fact.");
	assert.equal(run.startedAt, "2026-01-02T03:04:05.000Z");
	const report = formatReport(run);
	assert.match(report, /Generator: stub\/generator/);
	assert.match(report, /Judge: stub\/judge/);
	assert.match(report, /\| 3 \| 3 \| 3 \|/);
});

test("a bad judge reply is recorded as an error without stopping the run", async () => {
	let calls = 0;
	const judge: Complete = async () => {
		calls++;
		return calls === 1 ? "not json at all" : JSON.stringify(verdict(5));
	};
	const run = await runEval({
		concepts: EVAL_CONCEPTS.slice(0, 2),
		memes: [meme],
		generate: stubGenerate,
		judge,
		generatorLabel: "g",
		judgeLabel: "j",
	});
	assert.equal(run.errors, 1);
	assert.match(run.rows[0]!.error!, /^judge: /);
	assert.equal(run.rows[1]!.verdict?.fit.score, 5);
	assert.equal(run.means.fit, 5);
});

test("a failing generator is recorded per concept and the means stay null when nothing scores", async () => {
	const run = await runEval({
		concepts: EVAL_CONCEPTS.slice(0, 2),
		memes: [meme],
		generate: async () => {
			throw new Error("quota exceeded");
		},
		judge: async () => JSON.stringify(verdict(1)),
		generatorLabel: "g",
		judgeLabel: "j",
	});
	assert.equal(run.errors, 2);
	assert.equal(run.rows[0]!.error, "generation: quota exceeded");
	assert.deepEqual(run.means, { fit: null, humor: null, accuracy: null });
	assert.match(formatReport(run), /n\/a/);
});
