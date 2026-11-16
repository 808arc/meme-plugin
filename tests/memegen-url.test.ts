import assert from "node:assert/strict";
import { test } from "node:test";
import {
	encodeLine,
	renderedImageUrl,
	templateId,
} from "../src/memegen-url.ts";

// Expected values were checked by rendering them on api.memegen.link.
test("caption lines are encoded with memegen's escapes", () => {
	assert.equal(encodeLine("hello world"), "hello_world");
	assert.equal(encodeLine("snake_case x-y"), "snake__case_x--y");
	assert.equal(
		encodeLine('50% off? a/b & #1 <3> \\ "hi"'),
		"50~p_off~q_a~sb_~a_~h1_~l3~g_~b_''hi''",
	);
	// memegen has no "~e": "!" stays as is.
	assert.equal(encodeLine("wow!"), "wow!");
	// A tilde would start an escape ("~q" is "?"): it becomes a dash.
	assert.equal(encodeLine("~quiet"), "-quiet");
	assert.equal(encodeLine("Café 🚀"), "Caf%C3%A9_%F0%9F%9A%80");
	assert.equal(encodeLine(""), "_");
	assert.equal(encodeLine("   "), "_");
	assert.equal(encodeLine("a: b"), "a%3A_b");
});

test("only catalogue memes with the right line count get a rendered address", () => {
	assert.equal(templateId("memegen:panik-kalm-panik"), "panik-kalm-panik");
	assert.equal(templateId("custom:drake"), undefined);
	assert.equal(templateId("memegen:../x"), undefined);
	assert.equal(
		renderedImageUrl(
			"https://api.memegen.link/",
			"memegen:drake",
			["CPU math", ""],
			2,
		),
		"https://api.memegen.link/images/drake/CPU_math/_.png",
	);
	assert.equal(renderedImageUrl("", "memegen:drake", ["a", "b"], 2), undefined);
	assert.equal(
		renderedImageUrl("https://x", "memegen:drake", ["a"], 2),
		undefined,
	);
	assert.equal(
		renderedImageUrl("https://x", "memegen:drake", ["", ""], 2),
		undefined,
	);
	assert.equal(
		renderedImageUrl("https://x", "custom:proud", ["a"], 1),
		undefined,
	);
});
