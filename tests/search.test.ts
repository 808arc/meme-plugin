import assert from "node:assert/strict";
import { test } from "node:test";
import { WEB_SEARCH } from "../src/config.ts";
import {
	acceptable,
	conceptTerms,
	licenceAllowed,
	parseJudgement,
	type SearchHit,
	type SearchRequest,
	searchCandidates,
	verdict,
	webMeme,
} from "../src/search.ts";

const hit: SearchHit = {
	image: "https://images.example.test/drake.jpg",
	name: "Drake approving",
	terms: ["cuda", "gpu"],
	source: "https://memes.example.test/drake",
	credit: "Example Archive",
	license: "CC-BY-4.0",
};
const concept = { prompt: "Who backed CUDA?", context: "GPU history" };
const signal = new AbortController().signal;

test("concept terms are lowercase words of four letters or more, minus filler", () => {
	assert.deepEqual([...conceptTerms(concept)].sort(), [
		"backed",
		"cuda",
		"history",
	]);
});

test("licence allow-list: CC0, public domain, CC-BY, SA and ND; never NC or unknown", () => {
	for (const ok of [
		"CC0",
		"CC0 1.0",
		"Public domain",
		"CC BY 4.0",
		"cc-by-sa-3.0",
		"CC BY-ND 4.0",
	])
		assert.equal(licenceAllowed(ok), true, ok);
	for (const bad of [
		"CC BY-NC 4.0",
		"CC-BY-NC-SA",
		"CC-BY-NC-ND",
		"All rights reserved",
		"",
		undefined,
	])
		assert.equal(licenceAllowed(bad), false, String(bad));
});

test("acceptable requires an allowed licence, credit, http links and an exact term match", () => {
	const terms = conceptTerms(concept);
	assert.equal(acceptable(hit, terms), true);
	assert.equal(acceptable({ ...hit, license: undefined }, terms), false);
	assert.equal(acceptable({ ...hit, license: "CC-BY-NC" }, terms), false);
	assert.equal(acceptable({ ...hit, credit: " " }, terms), false);
	assert.equal(
		acceptable({ ...hit, image: "file:///etc/x.jpg" }, terms),
		false,
	);
	assert.equal(
		acceptable({ ...hit, source: "javascript:alert(1)" }, terms),
		false,
	);
	assert.equal(acceptable({ ...hit, terms: ["cud"] }, terms), false);
});

test("searchCandidates asks for safe search, prefilters and caps the judged hits", async () => {
	let request: SearchRequest | undefined;
	const many = Array.from({ length: 6 }, (_, index) => ({
		...hit,
		image: `https://images.example.test/${index}.jpg`,
	}));
	const found = await searchCandidates(
		{
			find: async (input) => {
				request = input;
				return [{ ...hit, terms: ["weather"] }, ...many];
			},
		},
		concept,
		signal,
	);
	assert.equal(request?.safeSearch, true);
	assert.deepEqual(request?.concept, concept);
	assert.equal(found.length, WEB_SEARCH.maxJudged);
	assert.equal(found[0]!.image, many[0]!.image);
});

test("searchCandidates is empty on agent failure and on empty concepts", async () => {
	const failing = {
		find: async () => {
			throw new Error("quota");
		},
	};
	assert.deepEqual(await searchCandidates(failing, concept, signal), []);
	assert.deepEqual(
		await searchCandidates(
			{ find: async () => [hit] },
			{ prompt: "the and with" },
			signal,
		),
		[],
	);
});

test("verdict: unsafe or irrelevant is rejected; without text the meme is only related", () => {
	const yes = { safe: true, relevant: true, accurate: true };
	assert.equal(verdict(hit, yes), "related");
	assert.equal(verdict({ ...hit, title: "CUDA" }, yes), "answer");
	assert.equal(
		verdict({ ...hit, text: "CUDA" }, { ...yes, accurate: false }),
		null,
	);
	assert.equal(verdict(hit, { ...yes, safe: false }), null);
	assert.equal(verdict(hit, { ...yes, relevant: false }), null);
	assert.throws(() => parseJudgement({ safe: "yes" }), /expected/);
	assert.match(webMeme(hit).id, /^web:[0-9a-f]{32}$/);
});
