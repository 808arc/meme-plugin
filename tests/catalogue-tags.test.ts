import assert from "node:assert/strict";
import { test } from "node:test";
import catalogue from "../src/data/memegen-templates.json" with {
	type: "json",
};
import {
	hiddenByDefault,
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

test("the default pool leaves out dated and weak templates", () => {
	const all = memegenMemes("", { includeHidden: true });
	const pool = memegenMemes("");
	const expected = catalogue.templates.filter(
		(template) => !template.tags.dated && !template.tags.weak,
	);
	assert.equal(all.length, catalogue.templates.length);
	assert.equal(pool.length, expected.length);
	assert.ok(pool.length > 0 && pool.length < all.length);
	for (const meme of pool) {
		const template = catalogue.templates.find(
			(item) => `memegen:${item.id}` === meme.id,
		);
		assert.ok(template && !template.tags.dated && !template.tags.weak);
	}
});

test("hiddenByDefault hides dated or weak templates and keeps untagged ones", () => {
	const base: TemplateTags = {
		structure: "catchphrase",
		tone: "playful",
		dated: false,
		weak: false,
		source: "manual-rule",
	};
	assert.equal(hiddenByDefault(base), false);
	assert.equal(hiddenByDefault({ ...base, dated: true }), true);
	assert.equal(hiddenByDefault({ ...base, weak: true }), true);
	assert.equal(hiddenByDefault(undefined), false);
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
