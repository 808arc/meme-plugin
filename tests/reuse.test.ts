import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type CachedMeme,
	chooseReuse,
	conceptKey,
	type GeneratedStore,
	MAX_PER_CONCEPT,
	mayReuse,
	REUSE_SHARE,
	recordFresh,
	recordReuse,
	type StoredMeme,
} from "../src/reuse.ts";

const meme = (id: string): StoredMeme => ({
	meme: { id, origin: "custom", name: id, boxes: [], hasImage: false },
	originalCaption: [],
	templateLines: [],
	lines: [id],
	values: {},
	emphasis: null,
	fact: "",
});
const entry = (
	id: string,
	rating: CachedMeme["rating"] = null,
): CachedMeme => ({ key: "k", createdAt: 0, rating, meme: meme(id) });
const empty: GeneratedStore = { version: 1, fresh: 0, reused: 0, entries: {} };

test("the reuse share is a named, modest constant", () => {
	assert.equal(REUSE_SHARE, 0.2);
});

test("reuse never exceeds the share of all picks", () => {
	let store = empty;
	let picks = 0;
	for (let index = 0; index < 1000; index++) {
		picks++;
		if (mayReuse(store)) store = recordReuse(store);
		else store = recordFresh(store, "k", meme(`m${index}`), index);
		assert.ok(store.reused <= REUSE_SHARE * picks + 1e-9);
	}
	assert.equal(store.reused, Math.floor(REUSE_SHARE * 1000));
	assert.equal(mayReuse(empty), false, "the first pick is always new");
});

test("concept keys ignore case, accents, punctuation and spacing", () => {
	assert.equal(
		conceptKey("Who backed CUDA?"),
		conceptKey("  who   backed cuda "),
	);
	assert.equal(conceptKey("Café"), conceptKey("Cafe"));
	assert.notEqual(
		conceptKey("Who backed CUDA?"),
		conceptKey("Who backed OpenCL?"),
	);
});

test("reuse skips down-rated, excluded and removed memes and prefers liked ones", () => {
	const pool = new Set(["a", "b", "c", "d"]);
	const entries = [entry("a", "down"), entry("b"), entry("c", "up")];
	assert.equal(
		chooseReuse(entries, pool, undefined, () => 0)?.meme.meme.id,
		"c",
	);
	assert.equal(chooseReuse([entry("a", "down")], pool, undefined), undefined);
	assert.equal(chooseReuse([entry("b")], pool, "b"), undefined);
	assert.equal(chooseReuse([entry("z")], pool, undefined), undefined);
	assert.equal(chooseReuse([entry("b")], pool, undefined)?.meme.meme.id, "b");
});

test("the store keeps a bounded number of earlier memes per concept", () => {
	let store = empty;
	for (let index = 0; index < MAX_PER_CONCEPT + 2; index++)
		store = recordFresh(store, "k", meme(`m${index}`), index);
	assert.equal(store.entries.k!.length, MAX_PER_CONCEPT);
	assert.equal(store.entries.k![0]!.meme.meme.id, `m${MAX_PER_CONCEPT + 1}`);
});
