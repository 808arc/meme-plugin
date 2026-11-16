import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { REUSE } from "../src/config.ts";
import {
	type CachedMeme,
	chooseReuse,
	conceptKey,
	type GeneratedStore,
	mayReuse,
	newEntry,
	type Rating,
	rateGenerated,
	readGenerated,
	readRating,
	recordFresh,
	recordReuse,
	type StoredMeme,
	writeGenerated,
} from "../src/reuse.ts";

const meme = (id: string): StoredMeme => ({
	meme: { id, origin: "custom", name: id, boxes: [], hasImage: false },
	originalCaption: [],
	lines: [id],
	fact: "",
});
const entry = (
	id: string,
	rating: Rating | null = null,
	createdAt = 0,
): CachedMeme => ({ id: `g-${id}`, createdAt, rating, meme: meme(id) });
const empty: GeneratedStore = { version: 1, concepts: {} };

test("the reuse settings are named, frozen constants", () => {
	assert.equal(REUSE.share, 0.2);
	assert.equal(REUSE.maxPerConcept, 5);
	assert.equal(REUSE.freshFirst, 4);
	assert.ok(Object.isFrozen(REUSE));
});

test("reuse never exceeds the share of one concept's picks", () => {
	let store = empty;
	for (let picks = 1; picks <= 1000; picks++) {
		if (mayReuse(store.concepts.k)) store = recordReuse(store, "k");
		else store = recordFresh(store, "k", entry(`m${picks}`, null, picks));
		const record = store.concepts.k!;
		assert.ok(record.reused <= REUSE.share * picks + 1e-9);
		if (picks <= REUSE.freshFirst) assert.equal(record.reused, 0);
	}
	assert.equal(store.concepts.k!.reused, Math.floor(REUSE.share * 1000));
	assert.equal(mayReuse(undefined), false, "a new concept is always fresh");
});

test("the share is counted per concept, not across concepts", () => {
	let store = empty;
	for (let index = 0; index < 20; index++)
		store = recordFresh(store, "a", entry(`a${index}`, null, index));
	assert.equal(mayReuse(store.concepts.a), true);
	assert.equal(mayReuse(store.concepts.b), false);
	store = recordFresh(store, "b", entry("b0"));
	assert.equal(mayReuse(store.concepts.b), false);
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
	assert.equal(chooseReuse(entries, pool, undefined, () => 0)?.id, "g-c");
	assert.equal(chooseReuse([entry("a", "down")], pool, undefined), undefined);
	assert.equal(chooseReuse([entry("b")], pool, "b"), undefined);
	assert.equal(chooseReuse([entry("z")], pool, undefined), undefined);
	assert.equal(chooseReuse([entry("b")], pool, undefined)?.id, "g-b");
});

test("over the cap, the lowest-rated then oldest memes go first, never the new one", () => {
	let store: GeneratedStore = {
		version: 1,
		concepts: {
			k: {
				fresh: 5,
				reused: 0,
				memes: [
					entry("up-old", "up", 1),
					entry("plain-new", null, 5),
					entry("plain-old", null, 2),
					entry("down-new", "down", 6),
					entry("up-new", "up", 4),
				],
			},
		},
	};
	store = recordFresh(store, "k", entry("fresh", null, 9));
	assert.deepEqual(
		store.concepts.k!.memes.map((item) => item.meme.meme.id),
		["fresh", "up-new", "up-old", "plain-new", "plain-old"],
	);
	store = recordFresh(store, "k", entry("fresh2", "down", 10));
	assert.deepEqual(
		store.concepts.k!.memes.map((item) => item.meme.meme.id),
		["fresh2", "up-new", "up-old", "fresh", "plain-new"],
	);
	assert.equal(store.concepts.k!.fresh, 7);
});

test("ratings are written and read by generated id, and survive a reload", (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meme-reuse-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const stored = newEntry(meme("a"), 1);
	writeGenerated(dir, recordFresh(readGenerated(dir), "k", stored));
	assert.equal(readRating(dir, stored.id), null, "unrated at first");
	assert.equal(rateGenerated(dir, stored.id, "up"), true);
	assert.equal(readRating(dir, stored.id), "up");
	assert.equal(rateGenerated(dir, stored.id, null), true);
	assert.equal(readRating(dir, stored.id), null);
	assert.equal(rateGenerated(dir, "unknown", "down"), false);
	assert.equal(readRating(dir, "unknown"), undefined);
	assert.throws(() =>
		rateGenerated(dir, stored.id, "meh" as unknown as Rating),
	);
});
