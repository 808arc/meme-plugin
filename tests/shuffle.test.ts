import assert from "node:assert/strict";
import { test } from "node:test";
import {
	concreteAutomatic,
	concreteTeacher,
	concreteTone,
	SHUFFLED_AUTOMATIC,
	SHUFFLED_TONES,
} from "../src/shuffle.ts";

test("tone Shuffle draws a real tone, never none; other tones pass through", () => {
	assert.equal(
		concreteTone("shuffle", () => 0),
		"deadpan",
	);
	assert.equal(
		concreteTone("shuffle", () => 0.9999),
		"playful",
	);
	assert.equal(
		concreteTone("shuffle", () => 1),
		"playful",
		"clamped",
	);
	assert.ok(!SHUFFLED_TONES.includes("none" as never));
	assert.equal(
		concreteTone("absurd", () => 0),
		"absurd",
	);
	assert.equal(
		concreteTone("none", () => 0),
		"none",
	);
});

test("teacher Shuffle draws teacher or wrong per turn", () => {
	assert.equal(
		concreteTeacher("shuffle", () => 0),
		"teacher",
	);
	assert.equal(
		concreteTeacher("shuffle", () => 0.7),
		"wrong",
	);
	assert.equal(
		concreteTeacher("wrong", () => 0),
		"wrong",
	);
});

test("automatic Shuffle gives each question one stable trigger, and uses all five", () => {
	const seen = new Set<string>();
	for (let index = 0; index < 200; index++) {
		const key = `session:q${index}`;
		const trigger = concreteAutomatic("shuffle", key);
		assert.equal(concreteAutomatic("shuffle", key), trigger, "stable per key");
		seen.add(trigger);
	}
	assert.deepEqual([...seen].sort(), [...SHUFFLED_AUTOMATIC].sort());
	assert.equal(concreteAutomatic("off", "k"), "off");
	assert.equal(concreteAutomatic("nth", "k"), "nth");
});
