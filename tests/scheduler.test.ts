import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_COOLDOWN_DAYS, cooldownMs, coolingDown, pickMeme, recordUse } from "../src/scheduler.ts";
import type { Usage } from "../src/types.ts";

const DAY = 86_400_000;
const settings = { cooldownDays: 14, cooldownGrowth: 2 };

test("the cooldown grows with every use and is capped", () => {
	assert.equal(cooldownMs(1, settings), 14 * DAY);
	assert.equal(cooldownMs(2, settings), 28 * DAY);
	assert.equal(cooldownMs(3, settings), 56 * DAY);
	assert.equal(cooldownMs(30, settings), MAX_COOLDOWN_DAYS * DAY);
	assert.equal(cooldownMs(1, { cooldownDays: 0, cooldownGrowth: 2 }), 0);
	assert.equal(cooldownMs(3, { cooldownDays: 7, cooldownGrowth: 1 }), 7 * DAY);
});

test("a used meme is not picked again until it is due", () => {
	const now = 1_000_000;
	const usage: Record<string, Usage> = { a: recordUse(undefined, now, settings) };
	assert.deepEqual(usage.a, { uses: 1, lastUsedAt: now, dueAt: now + 14 * DAY });
	assert.equal(coolingDown(usage, "a", now + DAY), true);
	for (const roll of [0, 0.3, 0.6, 0.999, 1]) assert.notEqual(pickMeme(["a", "b", "c"], usage, now + DAY, () => roll), "a");
	assert.equal(pickMeme(["a", "b", "c"], usage, now + DAY, () => 0), "b");
	assert.equal(pickMeme(["a", "b", "c"], usage, now + DAY, () => 0.999), "c");
	// Due again after the cooldown, and the second use doubles it.
	assert.equal(pickMeme(["a"], usage, now + 15 * DAY, () => 0), "a");
	assert.equal(recordUse(usage.a, now + 15 * DAY, settings).dueAt, now + 15 * DAY + 28 * DAY);
});

test("an exhausted pool falls back to the meme that is due soonest", () => {
	const usage: Record<string, Usage> = {
		a: { uses: 2, lastUsedAt: 0, dueAt: 900 },
		b: { uses: 1, lastUsedAt: 0, dueAt: 500 },
		c: { uses: 1, lastUsedAt: 0, dueAt: 700 },
	};
	assert.equal(pickMeme(["a", "b", "c"], usage, 100, () => 0.9), "b");
	assert.equal(pickMeme([], usage, 100), undefined);
});
