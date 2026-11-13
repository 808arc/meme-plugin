import assert from "node:assert/strict";
import { test } from "node:test";
import {
	acceptable,
	conceptTerms,
	findWebMeme,
	type SearchHit,
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

test("acceptable requires licence, credit, http links and an exact term match", () => {
	const terms = conceptTerms(concept);
	assert.equal(acceptable(hit, terms), true);
	assert.equal(acceptable({ ...hit, license: undefined }, terms), false);
	assert.equal(acceptable({ ...hit, credit: " " }, terms), false);
	assert.equal(
		acceptable({ ...hit, image: "file:///etc/x.jpg" }, terms),
		false,
	);
	assert.equal(
		acceptable({ ...hit, source: "javascript:alert(1)" }, terms),
		false,
	);
	assert.equal(
		acceptable({ ...hit, terms: ["cud"] }, terms),
		false,
		"no fuzzy match",
	);
});

test("findWebMeme returns the first acceptable hit as a web meme", async () => {
	const meme = await findWebMeme(
		{ find: async () => [{ ...hit, terms: ["weather"] }, hit] },
		concept,
		signal,
	);
	assert.equal(meme?.origin, "web");
	assert.equal(meme?.credit, "Example Archive");
	assert.match(meme!.id, /^web:[0-9a-f]{32}$/);
});

test("findWebMeme returns null on no hits, on agent failure, and on empty concepts", async () => {
	assert.equal(
		await findWebMeme({ find: async () => [] }, concept, signal),
		null,
	);
	assert.equal(
		await findWebMeme(
			{
				find: async () => {
					throw new Error("quota");
				},
			},
			concept,
			signal,
		),
		null,
	);
	assert.equal(
		await findWebMeme(
			{ find: async () => [hit] },
			{ prompt: "the and with" },
			signal,
		),
		null,
	);
});
