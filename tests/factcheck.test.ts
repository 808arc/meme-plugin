import assert from "node:assert/strict";
import { test } from "node:test";
import {
	agreementRequest,
	parseAgreement,
	parseAnswer,
	quickAgreement,
} from "../src/factcheck.ts";

const answer = {
	correct: ["Jensen Huang"],
	others: ["Lisa Su", "Ada Lovelace"],
};

test("the shortcut agrees only when the fact names the correct option and no other", () => {
	assert.equal(quickAgreement("Jensen Huang backed CUDA.", answer), true);
	assert.equal(quickAgreement("jensen  huang backed it", answer), true);
	// Naming a wrong option is left to the model, even if the correct one is also named.
	assert.equal(
		quickAgreement("Not Lisa Su but Jensen Huang backed CUDA.", answer),
		undefined,
	);
	assert.equal(quickAgreement("Lisa Su backed CUDA.", answer), undefined);
	// Whole words only: "Jensen Huangs" is not the option.
	assert.equal(quickAgreement("Jensen Huangs backed CUDA.", answer), undefined);
	assert.equal(quickAgreement("Nobody is named.", answer), undefined);
});

test("the self-check request asks for the correct answer when it is known", () => {
	const withKey = agreementRequest({
		concept: { prompt: "Who backed CUDA?", answer },
		fact: "Jensen Huang backed CUDA.",
	});
	assert.match(withKey.systemPrompt, /The correct answer is: Jensen Huang/);
	assert.match(withKey.user, /Fact:\nJensen Huang backed CUDA\./);
	const bare = agreementRequest({
		concept: { prompt: "What is CUDA?" },
		fact: "CUDA is a GPU platform.",
	});
	assert.match(bare.systemPrompt, /must be true and must directly answer/);
	assert.match(bare.systemPrompt, /"agrees": boolean/);
});

test("the reply must carry a boolean verdict", () => {
	assert.equal(parseAgreement({ agrees: true }), true);
	assert.equal(parseAgreement({ agrees: false }), false);
	assert.throws(
		() => parseAgreement({ agrees: "yes" }),
		/must be true or false/,
	);
	assert.throws(() => parseAgreement([true]), /must be true or false/);
	assert.throws(() => parseAgreement(null), /must be true or false/);
});

test("the answer key from the frontend is validated and malformed keys are dropped", () => {
	assert.deepEqual(parseAnswer(answer), answer);
	assert.equal(parseAnswer(undefined), undefined);
	assert.equal(parseAnswer({ correct: [], others: ["x"] }), undefined);
	assert.equal(parseAnswer({ correct: ["a"], others: "b" }), undefined);
	assert.equal(parseAnswer({ correct: ["a", ""], others: [] }), undefined);
	assert.equal(parseAnswer(["a"]), undefined);
});
