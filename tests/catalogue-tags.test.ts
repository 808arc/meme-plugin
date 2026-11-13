import assert from "node:assert/strict";
import { test } from "node:test";
import catalogue from "../src/data/memegen-templates.json" with {
	type: "json",
};
import {
	hiddenByDefault,
	isDated,
	isTemplateTags,
	type TemplateTags,
} from "../src/catalogue-tags.ts";
import { memegenMemes } from "../src/library.ts";

test("every bundled template has valid tags from the vocabulary", () => {
	for (const template of catalogue.templates)
		assert.ok(
			isTemplateTags(template.tags),
			`${template.id} has no valid tags`,
		);
});

test("the default pool leaves out weak templates and keeps dated ones", () => {
	const all = memegenMemes("", { includeHidden: true });
	const pool = memegenMemes("");
	const ids = new Set(pool.map((meme) => meme.id.slice("memegen:".length)));
	assert.equal(all.length, catalogue.templates.length);
	for (const template of catalogue.templates)
		assert.equal(ids.has(template.id), !template.tags.weak, template.id);
	assert.ok(catalogue.templates.some((t) => t.tags.dated && ids.has(t.id)));
});

test("hiddenByDefault hides weak templates only, unless the rules say otherwise", () => {
	const base: TemplateTags = {
		structure: "catchphrase",
		tone: "playful",
		dated: false,
		weak: false,
		source: "manual-rule",
	};
	assert.equal(hiddenByDefault(base), false);
	assert.equal(hiddenByDefault({ ...base, dated: true }), false);
	assert.equal(hiddenByDefault({ ...base, weak: true }), true);
	assert.equal(hiddenByDefault(undefined), false);
	assert.equal(
		hiddenByDefault(
			{ ...base, dated: true },
			{ hideWeak: true, hideDated: true },
		),
		true,
	);
	assert.equal(isDated({ ...base, dated: true }), true);
	assert.equal(isDated(base), false);
	assert.equal(isDated(undefined), false);
});

test("isTemplateTags rejects values outside the vocabulary", () => {
	const valid = {
		structure: "reaction",
		tone: "deadpan",
		dated: true,
		weak: false,
		source: "manual-rule",
	};
	assert.equal(isTemplateTags(valid), true);
	assert.equal(isTemplateTags({ ...valid, structure: "meme-ish" }), false);
	assert.equal(isTemplateTags({ ...valid, tone: "angry" }), false);
	assert.equal(isTemplateTags({ ...valid, dated: "yes" }), false);
	assert.equal(isTemplateTags({ ...valid, source: "llm" }), false);
	assert.equal(isTemplateTags(null), false);
});
