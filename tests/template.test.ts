import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJson, fillRequest, templateRequest } from "../src/prompts.ts";
import {
	assemble,
	parseFilling,
	parseTemplate,
	sentences,
	slotNames,
} from "../src/template.ts";

// An invented caption with the README's shape: three sentences, one box.
const caption = [
	"She fixed the printer is what she did. She was a patient office hero. And on this floor, Dana is a legend!",
];
const proposal = {
	lines: [
		"She {achievement} is what she did. She was a {descriptor}. And on this floor, {name} is a legend!",
	],
	slots: [
		{
			name: "achievement",
			hint: "what the person did",
			original: "fixed the printer",
		},
		{
			name: "descriptor",
			hint: "what kind of person",
			original: "patient office hero",
		},
		{ name: "name", hint: "who", original: "Dana" },
	],
	voice: "proud, emotional, shouting at the table",
};

test("a template is accepted only when it reproduces the caption", () => {
	const template = parseTemplate(proposal, caption);
	assert.deepEqual(slotNames(template.lines), [
		"achievement",
		"descriptor",
		"name",
	]);
	assert.equal(sentences(template).length, 3);

	// The model reworded the fixed phrasing: rejected.
	assert.throws(
		() =>
			parseTemplate(
				{
					...proposal,
					lines: [
						"She {achievement}, that is what she did. She was a {descriptor}. And on this floor, {name} is a legend!",
					],
				},
				caption,
			),
		/does not reproduce/,
	);
	assert.throws(
		() =>
			parseTemplate(
				{ ...proposal, lines: [...proposal.lines, "extra"] },
				caption,
			),
		/exactly 1 entries/,
	);
	assert.throws(
		() =>
			parseTemplate(
				{ ...proposal, slots: proposal.slots.slice(0, 2) },
				caption,
			),
		/no slot entry/,
	);
	assert.throws(
		() =>
			parseTemplate(
				{
					...proposal,
					slots: [
						...proposal.slots,
						{ name: "unused", hint: "", original: "x" },
					],
				},
				caption,
			),
		/not used/,
	);
	assert.throws(
		() =>
			parseTemplate(
				{
					...proposal,
					slots: [
						{ ...proposal.slots[0], name: "Bad Name" },
						...proposal.slots.slice(1),
					],
				},
				caption,
			),
		/snake_case/,
	);
	assert.throws(
		() =>
			parseTemplate(
				{
					...proposal,
					lines: [
						"She {achievement} is what she did. She was a {descriptor}. And on this floor, {name} is a {legend!",
					],
				},
				caption,
			),
		/braces|reproduce/,
	);
	assert.throws(() => parseTemplate("nope", caption), /JSON object/);
});

test("case, spacing and empty boxes are tolerated", () => {
	const template = parseTemplate(
		{
			lines: ["(empty)", "  one does not simply   {task} "],
			slots: [{ name: "task", hint: "", original: "Walk into the office" }],
			voice: "",
		},
		["", "One does not simply walk into the office"],
	);
	assert.deepEqual(template.lines, ["", "one does not simply {task}"]);
	assert.equal(template.slots[0]!.hint, "task");
});

test("slot values are validated and the caption is assembled by the plugin", () => {
	const template = parseTemplate(proposal, caption);
	const filling = parseFilling(
		{
			values: {
				achievement: "backed CUDA",
				descriptor: "stubborn chip founder",
				name: "Jensen Huang",
			},
			emphasis: { after: 1, text: "CUDA!!" },
			fact: "Jensen Huang backed CUDA at Nvidia.",
		},
		template,
	);
	assert.deepEqual(assemble(template, filling.values, filling.emphasis), [
		"She backed CUDA is what she did. CUDA!! She was a stubborn chip founder. And on this floor, Jensen Huang is a legend!",
	]);
	assert.deepEqual(assemble(template, filling.values, null), [
		"She backed CUDA is what she did. She was a stubborn chip founder. And on this floor, Jensen Huang is a legend!",
	]);

	assert.throws(
		() =>
			parseFilling(
				{ values: { achievement: "x", descriptor: "y" }, fact: "f" },
				template,
			),
		/values\.name/,
	);
	assert.throws(
		() =>
			parseFilling(
				{
					values: { achievement: "x".repeat(200), descriptor: "y", name: "z" },
					fact: "f",
				},
				template,
			),
		/longer than/,
	);
	assert.throws(
		() =>
			parseFilling(
				{ values: { achievement: "x", descriptor: "y", name: "z" } },
				template,
			),
		/fact/,
	);
	// Markup-like or brace text cannot smuggle a new slot or line break into the caption.
	const hostile = parseFilling(
		{
			values: { achievement: "a {name}\nb", descriptor: "y", name: "z" },
			emphasis: { after: 99, text: "!" },
			fact: "f",
		},
		template,
	);
	assert.equal(hostile.values.achievement, "a name b");
	assert.equal(
		hostile.emphasis,
		null,
		"an out-of-range emphasis is dropped, not fatal",
	);
});

test("emphasis lands on the right line of a multi-box meme", () => {
	const template = parseTemplate(
		{
			lines: ["{rejected}", "{preferred}"],
			slots: [
				{ name: "rejected", hint: "", original: "left on unread" },
				{ name: "preferred", hint: "", original: "left on read" },
			],
			voice: "",
		},
		["left on unread", "left on read"],
	);
	assert.deepEqual(
		assemble(
			template,
			{ rejected: "CPU only", preferred: "CUDA" },
			{ after: 2, text: "Yes!" },
		),
		["CPU only", "CUDA Yes!"],
	);
});

test("JSON is found inside fences and prose", () => {
	assert.deepEqual(
		extractJson('Sure!\n```json\n{"a": {"b": "}"}}\n```\nDone.'),
		{ a: { b: "}" } },
	);
	assert.deepEqual(extractJson('{broken} then {"ok": true}'), { ok: true });
	assert.throws(() => extractJson("no object here"), /JSON object/);
});

test("requests carry the question, the template and the emphasis switch", () => {
	const template = parseTemplate(proposal, caption);
	const meme = { name: "Proud speech", caption };
	assert.match(templateRequest(meme).user, /1\. She fixed the printer/);
	const on = fillRequest({
		meme,
		template,
		concept: { prompt: "Who backed CUDA?", context: "Options: A | B" },
		emphasis: true,
	});
	assert.match(on.user, /Who backed CUDA\?/);
	assert.match(on.user, /Options: A \| B/);
	assert.match(on.user, /3\. And on this floor, \{name\} is a legend!/);
	assert.match(on.systemPrompt, /interjection/);
	const off = fillRequest({
		meme,
		template,
		concept: { prompt: "Who backed CUDA?" },
		emphasis: false,
	});
	assert.match(off.systemPrompt, /Set "emphasis" to null/);
});
