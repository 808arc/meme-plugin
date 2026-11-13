import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import type {
	PluginBackendContext,
	PluginInferenceRequest,
} from "learnharness-plugin-api";
import { activate, type BackendOptions } from "../src/backend.ts";
import { FACT_CHECK, TEACHER_TOOL } from "../src/config.ts";
import { defaultBoxes, loadCustomMemes, memegenMemes } from "../src/library.ts";
import { fillRequest } from "../src/prompts.ts";
import { readRating } from "../src/reuse.ts";
import { parseTemplate } from "../src/template.ts";
import type {
	GeneratedMeme,
	MemeExport,
	MemeImage,
	PluginState,
} from "../src/types.ts";

const cheap = { provider: "fixture", id: "cheap-model" };
const other = { provider: "fixture", id: "other-model" };
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

const custom = [
	{
		id: "proud-speech",
		name: "Proud speech",
		image: "proud.png",
		caption: [
			"She fixed the printer is what she did. And on this floor, Dana is a legend!",
		],
	},
	{
		id: "two-panel",
		name: "Two panel",
		caption: ["manual backups", "automatic backups"],
	},
];
const templates: Record<string, unknown> = {
	"Proud speech": {
		lines: [
			"She {achievement} is what she did. And on this floor, {name} is a legend!",
		],
		slots: [
			{ name: "achievement", hint: "deed", original: "fixed the printer" },
			{ name: "name", hint: "who", original: "Dana" },
		],
		voice: "proud",
	},
	"Two panel": {
		lines: ["{rejected}", "{preferred}"],
		slots: [
			{ name: "rejected", hint: "worse", original: "manual backups" },
			{ name: "preferred", hint: "better", original: "automatic backups" },
		],
		voice: "",
	},
};
const fillings: Record<string, unknown> = {
	"Proud speech": {
		values: { achievement: "backed CUDA", name: "Jensen Huang" },
		emphasis: { after: 1, text: "CUDA!!" },
		fact: "Jensen Huang backed CUDA.",
	},
	"Two panel": {
		values: { rejected: "CPU-only math", preferred: "CUDA" },
		emphasis: null,
		fact: "CUDA moved math to GPUs.",
	},
};

type Reply = { text?: string; stopReason?: string; errorMessage?: string };
function fixture(
	t: TestContext,
	options: {
		memes?: unknown;
		cheapSlot?: boolean;
		reply?: (
			request: PluginInferenceRequest,
			call: number,
		) => Reply | Promise<Reply>;
	} = {},
) {
	const dataDirectory = fs.mkdtempSync(
		path.join(os.tmpdir(), "meme-plugin-test-"),
	);
	t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
	if (options.memes !== null) {
		fs.writeFileSync(
			path.join(dataDirectory, "custom-memes.json"),
			JSON.stringify(options.memes ?? custom),
		);
		fs.mkdirSync(path.join(dataDirectory, "custom-images"));
		fs.writeFileSync(
			path.join(dataDirectory, "custom-images", "proud.png"),
			PNG,
		);
	}
	const requests: PluginInferenceRequest[] = [];
	const emitted: { topic: string; data: unknown }[] = [];
	const memeOf = (request: PluginInferenceRequest) =>
		/^Meme: (.+)$/m.exec(String(request.context.messages[0]!.content))![1]!;
	const start = (backend: BackendOptions = {}) => {
		const controller = new AbortController();
		const handlers = new Map<string, (input: unknown) => unknown>();
		const registered: { create(context: unknown): unknown[] }[] = [];
		const ctx = {
			manifest: {
				apiVersion: 1,
				id: "meme-plugin",
				name: "Meme plugin",
				version: "0.1.0",
				minAppVersion: "0.6.0",
			},
			directory: dataDirectory,
			dataDirectory,
			signal: controller.signal,
			cleanup() {},
			events: {
				on: () => () => {},
				emit(topic: string, data?: unknown) {
					emitted.push({ topic, data });
				},
			},
			registerInstructions() {
				return () => {};
			},
			registerTools(contribution: { create(context: unknown): unknown[] }) {
				registered.push(contribution);
				return () => {
					registered.splice(registered.indexOf(contribution), 1);
				};
			},
			handle(name: string, handler: (input: unknown) => unknown) {
				handlers.set(name, handler);
				return () => {
					handlers.delete(name);
				};
			},
			inference: {
				async catalog() {
					return {
						models: [cheap, other].map((model) => ({
							...model,
							name: model.id,
							supportedLevels: ["off"],
						})),
						slots: {
							strong: null,
							cheap: options.cheapSlot === false ? null : { model: cheap },
							vision: null,
						},
						defaults: null,
						rolePins: {},
						providers: [],
					};
				},
				async complete(request: PluginInferenceRequest) {
					requests.push(request);
					const scripted = options.reply
						? await options.reply(request, requests.length)
						: {};
					const system = request.context.systemPrompt!;
					const text =
						scripted.text ??
						JSON.stringify(
							system.startsWith("You choose which meme")
								? { choice: 1 }
								: system.startsWith("You turn the caption")
									? templates[memeOf(request)]
									: system.startsWith("You check one study fact")
										? { agrees: true }
										: fillings[memeOf(request)],
						);
					return {
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "..." },
							{ type: "text", text },
						],
						stopReason: scripted.stopReason ?? "stop",
						...(scripted.errorMessage
							? { errorMessage: scripted.errorMessage }
							: {}),
					};
				},
			},
		} as unknown as PluginBackendContext;
		const dispose = activate(ctx, backend);
		const call = async <T>(name: string, input?: unknown): Promise<T> => {
			const handler = handlers.get(name);
			if (!handler) throw new Error(`No handler: ${name}`);
			return (await handler(input)) as T;
		};
		return { call, dispose, controller, registered };
	};
	return {
		dataDirectory,
		requests,
		emitted,
		start,
		memeOf,
		stored: () =>
			JSON.parse(
				fs.readFileSync(path.join(dataDirectory, "state.json"), "utf8"),
			),
	};
}
const offline = { useMemegen: false };

test("generate picks a meme, templates it once, fills it and starts its cooldown", async (t) => {
	const f = fixture(t, { memes: [custom[0]] });
	const { call } = f.start();
	await call("save-settings", offline);
	const before = Date.now();
	const first = await call<GeneratedMeme>("generate", {
		prompt: "Who backed CUDA?",
		context: "GPU history",
	});
	assert.deepEqual(first.lines, [
		"She backed CUDA is what she did. CUDA!! And on this floor, Jensen Huang is a legend!",
	]);
	assert.deepEqual(first.templateLines, [
		"She {achievement} is what she did. And on this floor, {name} is a legend!",
	]);
	assert.deepEqual(first.originalCaption, custom[0]!.caption);
	assert.equal(first.fact, "Jensen Huang backed CUDA.");
	assert.deepEqual(first.concept, {
		prompt: "Who backed CUDA?",
		context: "GPU history",
	});
	assert.deepEqual(
		{ ...first.meme, boxes: undefined },
		{
			id: "custom:proud-speech",
			origin: "custom",
			name: "Proud speech",
			hasImage: true,
			boxes: undefined,
		},
	);
	assert.deepEqual(first.meme.boxes, defaultBoxes(1));

	assert.equal(
		f.requests.length,
		3,
		"one template request, one fill request, one fact check",
	);
	for (const request of f.requests) {
		assert.deepEqual(
			request.model,
			cheap,
			"no explicit model: the configured cheap slot",
		);
		assert.equal(request.purpose, "user");
		assert.ok(request.signal);
	}
	assert.match(
		String(f.requests[1]!.context.messages[0]!.content),
		/Who backed CUDA\?[\s\S]*GPU history/,
	);

	const usage = f.stored().usage["custom:proud-speech"];
	assert.equal(usage.uses, 1);
	assert.ok(usage.dueAt >= before + 14 * 86_400_000);
	// The template is cached: the next meme from the same image costs one request.
	await call<GeneratedMeme>("generate", { prompt: "Who backed CUDA?" });
	assert.equal(f.requests.length, 5);
	assert.equal(f.stored().usage["custom:proud-speech"].uses, 2);
	assert.equal((await call<PluginState>("get-state")).pool.coolingDown, 1);
});

test("memes rotate: a used meme is skipped while another is eligible", async (t) => {
	const f = fixture(t);
	const { call } = f.start();
	await call("save-settings", offline);
	const first = await call<GeneratedMeme>("generate", {
		prompt: "What is CUDA?",
	});
	const second = await call<GeneratedMeme>("generate", {
		prompt: "What is CUDA?",
	});
	assert.notEqual(first.meme.id, second.meme.id);
	assert.deepEqual(
		new Set([first.meme.id, second.meme.id]),
		new Set(["custom:proud-speech", "custom:two-panel"]),
	);
	// Both cooling down: the one due soonest (the first used) comes back, unless excluded.
	assert.equal(
		(
			await call<GeneratedMeme>("generate", {
				prompt: "What is CUDA?",
				excludeMemeId: first.meme.id,
			})
		).meme.id,
		second.meme.id,
	);
	await call("reset-usage");
	assert.deepEqual(f.stored().usage, {});
	assert.equal((await call<PluginState>("get-state")).pool.coolingDown, 0);
});

test("the model picks a fitting meme among those not cooling down, and the joke is asked for", async (t) => {
	const f = fixture(t, {
		reply: (request) => {
			if (!request.context.systemPrompt!.startsWith("You choose which meme"))
				return {};
			const listed = String(request.context.messages[0]!.content)
				.split("\n")
				.filter((line) => /^\d+\. /.test(line));
			const choice = listed.findIndex((line) => line.includes("Two panel")) + 1;
			return { text: JSON.stringify({ choice }) };
		},
	});
	const { call } = f.start();
	await call("save-settings", offline);
	const first = await call<GeneratedMeme>("generate", {
		prompt: "What is CUDA?",
	});
	assert.equal(first.meme.id, "custom:two-panel", "the model's choice is used");
	const pick = f.requests[0]!;
	assert.match(pick.context.systemPrompt!, /"choice"/);
	assert.match(
		String(pick.context.messages[0]!.content),
		/Proud speech: She fixed the printer/,
	);
	assert.match(f.requests[2]!.context.systemPrompt!, /funny/);

	// The meme cooling down is filtered out before the model sees the list: nothing to pick.
	const second = await call<GeneratedMeme>("generate", {
		prompt: "What is CUDA?",
	});
	assert.equal(second.meme.id, "custom:proud-speech");
	assert.equal(
		f.requests.filter((r) => r.context.systemPrompt!.startsWith("You choose"))
			.length,
		1,
	);
});

test("an unusable pick falls back to a random meme that is not cooling down", async (t) => {
	const f = fixture(t, {
		reply: (request) =>
			request.context.systemPrompt!.startsWith("You choose")
				? { text: '{"choice": 9}' }
				: {},
	});
	const { call } = f.start();
	await call("save-settings", offline);
	const meme = await call<GeneratedMeme>("generate", {
		prompt: "What is CUDA?",
	});
	assert.ok(["custom:proud-speech", "custom:two-panel"].includes(meme.meme.id));
	assert.equal(
		f.requests.filter((r) => r.context.systemPrompt!.startsWith("You choose"))
			.length,
		2,
		"one correction, then the fallback",
	);
});

test("an emphasis is dropped when the setting is off", async (t) => {
	const f = fixture(t, { memes: [custom[0]] });
	const { call } = f.start();
	await call("save-settings", { ...offline, emphasis: false });
	const meme = await call<GeneratedMeme>("generate", {
		prompt: "Who backed CUDA?",
	});
	assert.equal(meme.emphasis, null);
	assert.deepEqual(meme.lines, [
		"She backed CUDA is what she did. And on this floor, Jensen Huang is a legend!",
	]);
	assert.match(f.requests[1]!.context.systemPrompt!, /Set "emphasis" to null/);
});

test("a rejected reply gets one correction, then the meme is abandoned for another", async (t) => {
	const reworded = JSON.stringify({
		lines: ["She {achievement}! {name} rules!"],
		slots: [
			{ name: "achievement", hint: "", original: "fixed the printer" },
			{ name: "name", hint: "", original: "Dana" },
		],
		voice: "",
	});
	const corrected = fixture(t, {
		memes: [custom[0]],
		reply: (request, call) => (call === 1 ? { text: reworded } : {}),
	});
	const first = corrected.start();
	await first.call("save-settings", offline);
	await first.call<GeneratedMeme>("generate", { prompt: "Who backed CUDA?" });
	assert.equal(corrected.requests.length, 4);
	const retry = corrected.requests[1]!.context.messages;
	assert.equal(retry.length, 3, "the correction continues the same exchange");
	assert.match(
		String(retry[2]!.content),
		/does not reproduce the original caption/,
	);

	// "Proud speech" never yields a valid template: the plugin moves on to the other meme.
	const stubborn = fixture(t, {
		reply: (request) =>
			request.context.systemPrompt!.startsWith("You turn the caption") &&
			stubborn.memeOf(request) === "Proud speech"
				? { text: "I cannot do that." }
				: {},
	});
	const second = stubborn.start();
	await second.call("save-settings", offline);
	for (let round = 0; round < 3; round++)
		assert.equal(
			(
				await second.call<GeneratedMeme>("generate", {
					prompt: "What is CUDA?",
				})
			).meme.id,
			"custom:two-panel",
		);
	assert.equal(
		stubborn.stored().usage["custom:proud-speech"],
		undefined,
		"a meme that was never shown does not cool down",
	);
	assert.equal(
		stubborn.requests.filter(
			(request) =>
				request.context.systemPrompt!.startsWith("You turn the caption") &&
				stubborn.memeOf(request) === "Proud speech",
		).length,
		2,
		"an untemplatable meme is not paid for again",
	);

	const hopeless = fixture(t, {
		memes: [custom[0]],
		reply: () => ({ text: "no json" }),
	});
	const third = hopeless.start();
	await third.call("save-settings", offline);
	await assert.rejects(
		third.call("generate", { prompt: "What is CUDA?" }),
		/did not produce a usable meme caption/,
	);
	assert.equal(hopeless.requests.length, 2);
});

test("a fact that disagrees with the question is regenerated, then shown", async (t) => {
	let checks = 0;
	const f = fixture(t, {
		memes: [custom[0]],
		reply: (request) => {
			if (!request.context.systemPrompt!.startsWith("You check one study fact"))
				return {};
			checks++;
			return { text: JSON.stringify({ agrees: checks > 1 }) };
		},
	});
	const { call } = f.start();
	await call("save-settings", offline);
	const meme = await call<GeneratedMeme>("generate", {
		prompt: "Who backed CUDA?",
	});
	assert.equal(meme.fact, "Jensen Huang backed CUDA.");
	const fills = f.requests.filter((request) =>
		request.context.systemPrompt!.startsWith("You write the caption"),
	);
	assert.equal(fills.length, 2);
	assert.match(
		String(fills[1]!.context.messages[0]!.content),
		/does not agree/,
	);
});

test("when no caption agrees, no meme is shown and nothing is used up", async (t) => {
	const f = fixture(t, {
		memes: [custom[0]],
		reply: (request) =>
			request.context.systemPrompt!.startsWith("You check one study fact")
				? { text: '{"agrees": false}' }
				: {},
	});
	const { call } = f.start();
	await call("save-settings", offline);
	await assert.rejects(call("generate", { prompt: "Who backed CUDA?" }), {
		message: FACT_CHECK.UNRELIABLE_MESSAGE,
	});
	const fills = f.requests.filter((request) =>
		request.context.systemPrompt!.startsWith("You write the caption"),
	);
	assert.equal(fills.length, FACT_CHECK.MAX_FACT_ATTEMPTS);
	assert.deepEqual(f.stored().usage, {});
});

test("a question whose answer key is known is checked without a model call when the fact names it", async (t) => {
	const f = fixture(t, { memes: [custom[0]] });
	const { call } = f.start();
	await call("save-settings", offline);
	const meme = await call<GeneratedMeme>("generate", {
		prompt: "Who backed CUDA?",
		answer: { correct: ["Jensen Huang"], others: ["Lisa Su"] },
	});
	assert.equal(meme.concept.answer?.correct[0], "Jensen Huang");
	assert.equal(
		f.requests.filter((request) =>
			request.context.systemPrompt!.startsWith("You check one study fact"),
		).length,
		0,
	);
});

test("model selection is explicit and failures are reported, not hidden", async (t) => {
	const none = fixture(t, { cheapSlot: false });
	const a = none.start();
	await a.call("save-settings", offline);
	await assert.rejects(a.call("generate", { prompt: "x" }), /Choose a model/);
	await a.call("save-settings", { model: other });
	await a.call<GeneratedMeme>("generate", { prompt: "x" });
	assert.deepEqual(none.requests[0]!.model, other);
	await a.call("save-settings", { model: { provider: "fixture", id: "gone" } });
	const sent = none.requests.length;
	await assert.rejects(a.call("generate", { prompt: "x" }), /not available/);
	assert.equal(
		none.requests.length,
		sent,
		"no request is sent to an unavailable model",
	);

	const failing = fixture(t, {
		reply: () => ({ stopReason: "error", errorMessage: "quota exceeded" }),
	});
	const b = failing.start();
	await b.call("save-settings", offline);
	await assert.rejects(b.call("generate", { prompt: "x" }), /quota exceeded/);
	assert.deepEqual(failing.stored().usage, {});

	const empty = fixture(t, { memes: null });
	const c = empty.start();
	await c.call("save-settings", offline);
	await assert.rejects(c.call("generate", { prompt: "x" }), /pool is empty/);
	await assert.rejects(c.call("generate", { prompt: "  " }), /no question/);
	await assert.rejects(
		c.call("generate", { prompt: "x".repeat(5000) }),
		/too long/,
	);
	await assert.rejects(c.call("generate", "x"), /operation input object/);
});

test("only one generation runs at a time", async (t) => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const f = fixture(t, {
		memes: [custom[0]],
		reply: async () => {
			await gate;
			return {};
		},
	});
	const { call } = f.start();
	await call("save-settings", offline);
	const running = call<GeneratedMeme>("generate", { prompt: "x" });
	await assert.rejects(call("generate", { prompt: "y" }), /already being made/);
	release();
	assert.equal((await running).meme.id, "custom:proud-speech");
	await call<GeneratedMeme>("generate", { prompt: "y" });
});

test("settings are validated, persisted and survive a restart", async (t) => {
	const f = fixture(t);
	const first = f.start();
	const initial = await first.call<PluginState>("get-state");
	assert.deepEqual(initial.settings, {
		model: null,
		emphasis: true,
		cooldownDays: 14,
		cooldownGrowth: 2,
		useMemegen: true,
		imageBaseUrl: "https://api.memegen.link",
		ownMemesShare: 100,
		rejectCooldownDays: 1,
		customFolder: "",
		webSearch: true,
		searchAgent: null,
		mode: "answer",
		teacherMemes: "off",
	});
	assert.equal(initial.customFolder, f.dataDirectory);
	for (const [patch, error] of [
		[{ ownMemesShare: 101 }, /ownMemesShare/],
		[{ rejectCooldownDays: -1 }, /rejectCooldownDays/],
		[{ customFolder: "relative/memes" }, /absolute path/],
		[{ customFolder: 3 }, /customFolder must be text/],
	] as const)
		await assert.rejects(first.call("save-settings", patch), error);
	assert.equal(initial.pool.memegen, memegenMemes("").length);
	assert.equal(initial.pool.custom, 2);
	await assert.rejects(
		first.call("save-settings", { cooldownDays: -1 }),
		/cooldownDays/,
	);
	await assert.rejects(
		first.call("save-settings", { cooldownGrowth: 0.5 }),
		/cooldownGrowth/,
	);
	await assert.rejects(
		first.call("save-settings", { imageBaseUrl: "ftp://x" }),
		/http/,
	);
	await assert.rejects(
		first.call("save-settings", { mode: "reflect" }),
		/mode must be one of answer, hint, think/,
	);
	await assert.rejects(
		first.call("save-settings", { surprise: true }),
		/Unknown setting/,
	);
	await assert.rejects(
		first.call("save-settings", { emphasis: false, model: "x" }),
		/model/,
	);
	assert.equal(
		(await first.call<PluginState>("get-state")).settings.emphasis,
		true,
		"a rejected patch changes nothing",
	);
	const saved = await first.call<PluginState>("save-settings", {
		cooldownDays: 3,
		imageBaseUrl: " http://localhost:5000/ ",
		useMemegen: false,
	});
	assert.equal(saved.settings.imageBaseUrl, "http://localhost:5000");
	assert.equal(saved.pool.memegen, 0);
	first.dispose();
	await assert.rejects(first.call("get-state"), /No handler/);

	const second = f.start();
	assert.deepEqual(
		(await second.call<PluginState>("get-state")).settings,
		saved.settings,
	);
	second.controller.abort();
	await assert.rejects(second.call("get-state"), /disabled/);

	// A newer data format is refused rather than rewritten.
	fs.writeFileSync(
		path.join(f.dataDirectory, "state.json"),
		JSON.stringify({ version: 2, settings: {} }),
	);
	assert.throws(() => f.start(), /format 2/);
	assert.equal(f.stored().version, 2);
});

test("images are served from plugin data and checked by content", async (t) => {
	const f = fixture(t, {
		memes: [
			...custom,
			{ id: "fake", name: "Fake", image: "fake.png", caption: ["x"] },
		],
	});
	fs.writeFileSync(
		path.join(f.dataDirectory, "custom-images", "fake.png"),
		"<svg onload=alert(1)>",
	);
	const { call } = f.start();
	assert.deepEqual(
		await call<MemeImage>("get-image", { id: "custom:proud-speech" }),
		{ mimeType: "image/png", data: PNG.toString("base64") },
	);
	assert.equal(
		await call("get-image", { id: "custom:two-panel" }),
		null,
		"a meme without an image is text only",
	);
	await assert.rejects(
		call("get-image", { id: "custom:fake" }),
		/not a PNG, JPEG, GIF or WebP/,
	);
	await assert.rejects(
		call("get-image", { id: "custom:../state" }),
		/Unknown meme/,
	);
	await call("save-settings", { imageBaseUrl: "" });
	assert.equal(
		await call("get-image", { id: "memegen:drake" }),
		null,
		"no image server: nothing is fetched",
	);
});

test("remote images are downloaded once, then served from the cache", async (t) => {
	const paths: string[] = [];
	const server = http.createServer((request, response) => {
		paths.push(request.url!);
		if (request.url === "/images/ok.png") {
			response.writeHead(200, { "content-type": "image/png" });
			response.end(PNG);
		} else if (request.url === "/images/page.png") {
			response.writeHead(200, { "content-type": "image/png" });
			response.end("<html>not an image</html>");
		} else {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/images`;
	const f = fixture(t, {
		memes: ["ok", "page", "missing"].map((id) => ({
			id,
			name: id,
			image: `${base}/${id}.png`,
			caption: ["x"],
		})),
	});
	const { call } = f.start();
	const expected = { mimeType: "image/png", data: PNG.toString("base64") };
	assert.deepEqual(
		await call<MemeImage>("get-image", { id: "custom:ok" }),
		expected,
	);
	assert.deepEqual(
		await call<MemeImage>("get-image", { id: "custom:ok" }),
		expected,
	);
	assert.deepEqual(
		paths,
		["/images/ok.png"],
		"the second read never touches the network",
	);
	assert.equal(
		fs.readdirSync(path.join(f.dataDirectory, "image-cache")).length,
		1,
	);
	// A response that only claims to be an image is neither returned nor cached.
	await assert.rejects(
		call("get-image", { id: "custom:page" }),
		/not a PNG, JPEG, GIF or WebP/,
	);
	await assert.rejects(
		call("get-image", { id: "custom:missing" }),
		/Image request failed \(404\)/,
	);
	assert.equal(
		fs.readdirSync(path.join(f.dataDirectory, "image-cache")).length,
		1,
	);
});

test("the custom library skips bad entries and says why", (t) => {
	const f = fixture(t, {
		memes: [
			custom[0],
			{ id: "Bad Id", name: "x", caption: ["x"] },
			{ id: "escape", name: "x", image: "../state.json", caption: ["x"] },
			{ id: "proud-speech", name: "again", caption: ["x"] },
			{ id: "empty", name: "x", caption: [""] },
			{ id: "boxes", name: "x", caption: ["a", "b"], boxes: [{}] },
			{
				id: "placed",
				name: "Placed",
				image: "https://example.com/a.png",
				source: "https://example.com/about",
				caption: ["a", ""],
				boxes: [
					{
						x: 0.1,
						y: 0.2,
						w: 0.5,
						h: 0.3,
						color: "red; background: url(x)",
						font: "comic",
					},
					{},
				],
			},
		],
	});
	const { memes, problems } = loadCustomMemes(f.dataDirectory);
	assert.deepEqual(
		memes.map((meme) => meme.id),
		["custom:proud-speech", "custom:placed"],
	);
	assert.equal(problems.length, 5);
	assert.match(
		problems.join("\n"),
		/entry 2: "id"[\s\S]*entry 3: "image"[\s\S]*entry 4: duplicate id[\s\S]*entry 5: "caption"[\s\S]*entry 6: "boxes"/,
	);
	const placed = memes[1]!;
	assert.deepEqual(
		{
			x: placed.boxes[0]!.x,
			y: placed.boxes[0]!.y,
			w: placed.boxes[0]!.w,
			h: placed.boxes[0]!.h,
			font: placed.boxes[0]!.font,
			color: placed.boxes[0]!.color,
		},
		{ x: 0.1, y: 0.2, w: 0.5, h: 0.3, font: "comic", color: "white" },
	);

	fs.writeFileSync(
		path.join(f.dataDirectory, "custom-memes.json"),
		"{not json",
	);
	assert.match(loadCustomMemes(f.dataDirectory).problems[0]!, /not valid JSON/);
});

// README "Your own memes", step by step: the documented file, an image beside it.
test("own memes: the README steps work end to end and come before the catalogue", async (t) => {
	const readme = fs.readFileSync(
		new URL("../README.md", import.meta.url),
		"utf8",
	);
	const documented = JSON.parse(
		/### Your own memes[\s\S]*?```json\n([\s\S]*?)```/.exec(readme)![1]!,
	) as Record<string, unknown>[];
	assert.equal(documented.length, 1);
	const entry: Record<string, unknown> = {
		...documented[0],
		caption: [
			"He discovered America is what he did. He was a brave Italian explorer. And in this house, Christopher Columbus is a hero!",
		],
	};
	const name = entry.name as string;
	const f = fixture(t, {
		memes: [entry, { id: "Not OK", name: "x", caption: ["x"] }],
		reply: (request) => {
			// Pick (#4) and fact check (#7) requests name no single meme: fixture defaults.
			if (
				/^You (choose which meme|check one study fact)/.test(
					request.context.systemPrompt!,
				)
			)
				return {};
			const meme = f.memeOf(request);
			if (meme in templates) return {};
			if (meme !== name)
				return { stopReason: "error", errorMessage: `asked about ${meme}` };
			return {
				text: JSON.stringify(
					request.context.systemPrompt!.startsWith("You turn the caption")
						? {
								lines: [
									"He {achievement} is what he did. He was a brave {descriptor}. And in this house, {name} is a hero!",
								],
								slots: [
									{
										name: "achievement",
										hint: "deed",
										original: "discovered America",
									},
									{
										name: "descriptor",
										hint: "who",
										original: "Italian explorer",
									},
									{
										name: "name",
										hint: "name",
										original: "Christopher Columbus",
									},
								],
								voice: "emotional",
							}
						: {
								values: {
									achievement: "backed CUDA",
									descriptor: "Taiwanese-American industrialist",
									name: "Jensen Huang",
								},
								emphasis: { after: 1, text: "CUDA!!" },
								fact: "Jensen Huang backed CUDA.",
							},
				),
			};
		},
	});
	const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
	fs.writeFileSync(
		path.join(f.dataDirectory, "custom-images", entry.image as string),
		jpeg,
	);
	const { call } = f.start();
	// Settings: the bundled catalogue is on, the bad entry is skipped and listed.
	const state = await call<PluginState>("get-state");
	assert.equal(state.settings.useMemegen, true);
	assert.equal(state.pool.custom, 1);
	assert.ok(state.pool.memegen > 150);
	assert.deepEqual(state.problems.length, 1);
	assert.match(state.problems[0]!, /entry 2: "id"/);

	// About 200 catalogue memes, yet the own meme is picked first.
	const meme = await call<GeneratedMeme>("generate", {
		prompt: "Who backed CUDA?",
	});
	assert.equal(meme.meme.id, "custom:brave-explorer");
	assert.deepEqual(meme.lines, [
		"He backed CUDA is what he did. CUDA!! He was a brave Taiwanese-American industrialist. And in this house, Jensen Huang is a hero!",
	]);
	assert.deepEqual(await call<MemeImage>("get-image", { id: meme.meme.id }), {
		mimeType: "image/jpeg",
		data: jpeg.toString("base64"),
	});

	// A preference, not a filter: while it cools down, the catalogue takes over.
	await assert.rejects(
		call("generate", { prompt: "Who backed CUDA?" }),
		/asked about/,
	);
	assert.notEqual(f.memeOf(f.requests.at(-1)!), name);

	// Edits apply to the next meme, without a restart; a new own meme goes first again.
	fs.writeFileSync(
		path.join(f.dataDirectory, "custom-memes.json"),
		JSON.stringify([entry, custom[1]]),
	);
	const fixed = await call<PluginState>("get-state");
	assert.deepEqual([fixed.pool.custom, fixed.problems], [2, []]);
	assert.equal(
		(await call<GeneratedMeme>("generate", { prompt: "What is CUDA?" })).meme
			.id,
		"custom:two-panel",
	);
});

test("not this one: the rejected meme cools down one step longer and another is shown", async (t) => {
	const f = fixture(t);
	const { call } = f.start();
	await call("save-settings", offline);
	const first = await call<GeneratedMeme>("generate", { prompt: "x" });
	const shown = f.stored().usage[first.meme.id];
	const before = Date.now();
	const next = await call<GeneratedMeme>("generate", {
		prompt: "x",
		rejectMemeId: first.meme.id,
	});
	assert.notEqual(next.meme.id, first.meme.id);
	const rejected = f.stored().usage[first.meme.id];
	assert.equal(rejected.uses, shown.uses + 1, "a rejection counts as a use");
	assert.ok(rejected.dueAt >= before + 28 * 86_400_000);
	assert.equal(f.stored().usage[next.meme.id].uses, 1);
	// Still in the pool: not deleted, back after its cooldown.
	assert.equal((await call<PluginState>("get-state")).pool.custom, 2);

	// Cooldown off: a rejected meme still sits out the minimum after rejecting.
	await call("save-settings", { cooldownDays: 0 });
	const now = Date.now();
	await call<GeneratedMeme>("generate", {
		prompt: "x",
		rejectMemeId: next.meme.id,
	});
	const minimum = f.stored().usage[next.meme.id];
	assert.ok(minimum.dueAt >= now + 86_400_000);
	assert.ok(minimum.dueAt < now + 2 * 86_400_000);

	// An id that is not in the pool records nothing.
	await call("reset-usage");
	await call<GeneratedMeme>("generate", {
		prompt: "x",
		rejectMemeId: "custom:gone",
	});
	assert.equal(f.stored().usage["custom:gone"], undefined);
});

test("own memes can live outside data/: only read, and exported into data/", async (t) => {
	const f = fixture(t, { memes: null });
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "meme-plugin-own-"));
	t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
	fs.writeFileSync(
		path.join(outside, "custom-memes.json"),
		JSON.stringify(custom),
	);
	fs.mkdirSync(path.join(outside, "custom-images"));
	fs.writeFileSync(path.join(outside, "custom-images", "proud.png"), PNG);
	fs.writeFileSync(path.join(outside, "custom-images", "notes.txt"), "x");
	const listing = () => fs.readdirSync(outside, { recursive: true }).sort();
	const before = listing();

	const { call } = f.start();
	await assert.rejects(call("export-memes"), /no custom memes to export/);
	const missing = await call<PluginState>("save-settings", {
		...offline,
		customFolder: path.join(outside, "nowhere"),
	});
	assert.match(missing.problems[0]!, /Custom memes folder not found/);
	const state = await call<PluginState>("save-settings", {
		customFolder: outside,
	});
	assert.deepEqual(
		[state.pool.custom, state.customFolder, state.problems],
		[2, outside, []],
	);
	assert.deepEqual(
		await call<MemeImage>("get-image", { id: "custom:proud-speech" }),
		{ mimeType: "image/png", data: PNG.toString("base64") },
	);
	await call<GeneratedMeme>("generate", { prompt: "x" });

	const result = await call<MemeExport>("export-memes");
	assert.equal(result.images, 1, "only image files are copied");
	assert.equal(
		path.dirname(result.path),
		path.join(f.dataDirectory, "exports"),
	);
	assert.equal(
		fs.readFileSync(path.join(result.path, "custom-memes.json"), "utf8"),
		JSON.stringify(custom),
	);
	assert.deepEqual(
		fs.readFileSync(path.join(result.path, "custom-images", "proud.png")),
		PNG,
	);
	assert.deepEqual(listing(), before, "the outside folder is never written");
});

test("the bundled catalogue is well formed", () => {
	const memes = memegenMemes("https://api.memegen.link", {
		includeHidden: true,
	});
	assert.ok(memes.length > 150);
	assert.equal(new Set(memes.map((meme) => meme.id)).size, memes.length);
	for (const meme of memes) {
		assert.match(meme.id, /^memegen:[a-z0-9]+(?:-[a-z0-9]+)*$/);
		assert.equal(
			meme.image,
			`https://api.memegen.link/images/${meme.id.slice(8)}.jpg`,
		);
		assert.equal(meme.boxes.length, meme.caption.length);
		assert.ok(meme.caption.some(Boolean));
		for (const box of meme.boxes)
			for (const value of [box.x, box.y, box.w, box.h])
				assert.ok(value >= 0 && value <= 1);
	}
	assert.ok(memegenMemes("").every((meme) => meme.image === ""));
});

test("a repeated concept reuses an earlier meme once the reuse share allows it", async (t) => {
	const f = fixture(t, { memes: [custom[0]] });
	const { call } = f.start();
	await call("save-settings", { ...offline, cooldownDays: 0 });
	const asked = { prompt: "Who   backed CUDA?!" };
	const fresh: GeneratedMeme[] = [];
	for (let index = 0; index < 4; index++)
		fresh.push(await call<GeneratedMeme>("generate", asked));
	assert.ok(fresh.every((meme) => meme.reused === undefined));
	assert.equal(new Set(fresh.map((meme) => meme.generatedId)).size, 4);
	const requestsBefore = f.requests.length;
	const usesBefore = f.stored().usage["custom:proud-speech"].uses;
	// Reuse needs no model: pin one the host does not offer.
	await call("save-settings", {
		model: { provider: "fixture", id: "missing-model" },
	});
	const reused = await call<GeneratedMeme>("generate", {
		prompt: "who backed cuda",
	});
	assert.equal(reused.reused, true);
	assert.equal(f.requests.length, requestsBefore, "no model call for a reuse");
	assert.ok(fresh.some((meme) => meme.generatedId === reused.generatedId));
	assert.deepEqual(reused.lines, fresh[0]!.lines);
	assert.deepEqual(reused.concept, { prompt: "who backed cuda" });
	assert.equal(
		f.stored().usage["custom:proud-speech"].uses,
		usesBefore + 1,
		"a reuse counts as a use",
	);
	// The share is per concept: another question has no history, so it needs the model.
	await assert.rejects(
		call("generate", { prompt: "What is OpenCL?" }),
		/not available/,
	);
	await call("save-settings", { model: null });
	// Asked to replace the meme on screen: a new generation, not the same one.
	const replaced = await call<GeneratedMeme>("generate", {
		...asked,
		excludeMemeId: reused.meme.id,
	});
	assert.equal(replaced.reused, undefined);
	assert.ok(f.requests.length > requestsBefore);
	const store = JSON.parse(
		fs.readFileSync(path.join(f.dataDirectory, "generated-memes.json"), "utf8"),
	);
	const records = Object.values(store.concepts) as {
		fresh: number;
		reused: number;
		memes: unknown[];
	}[];
	assert.equal(records.length, 1);
	assert.equal(records[0]!.reused, 1);
	assert.equal(records[0]!.fresh, 5);
	assert.equal(records[0]!.memes.length, 5);
});

test("generate reports its stages to the requesting window", async (t) => {
	const f = fixture(t, { memes: [custom[0]] });
	const { call } = f.start();
	await call("save-settings", offline);
	const meme = await call<GeneratedMeme>("generate", {
		prompt: "Who backed CUDA?",
		requestId: "r1",
	});
	assert.deepEqual(f.emitted, [
		{ topic: "meme-stage", data: { requestId: "r1", stage: "selecting" } },
		{ topic: "meme-stage", data: { requestId: "r1", stage: "writing" } },
	]);
	assert.equal(meme.rating, null, "a fresh meme is unrated");
	f.emitted.length = 0;
	await call<GeneratedMeme>("generate", { prompt: "Who backed CUDA?" });
	assert.deepEqual(f.emitted, [], "no request id, no stage events");
});

test("rate stores the rating on the generated meme and rejects unknown ids", async (t) => {
	const f = fixture(t, { memes: [custom[0]] });
	const { call } = f.start();
	await call("save-settings", offline);
	const meme = await call<GeneratedMeme>("generate", {
		prompt: "Who backed CUDA?",
	});
	await call("rate", { id: meme.generatedId, rating: "up" });
	assert.equal(readRating(f.dataDirectory, meme.generatedId!), "up");
	await call("rate", { id: meme.generatedId, rating: null });
	assert.equal(readRating(f.dataDirectory, meme.generatedId!), null);
	await assert.rejects(
		call("rate", { id: "nope", rating: "up" }),
		/Unknown meme/,
	);
	await assert.rejects(
		call("rate", { id: meme.generatedId, rating: "meh" }),
		/"up", "down" or null/,
	);
	assert.equal(f.stored().ratings, undefined, "ratings stay out of state.json");
});

type Judge = { safe?: boolean; relevant?: boolean; accurate?: boolean | null };
async function webFixture(
	t: TestContext,
	hits: Record<string, unknown>[],
	judge: (user: string) => Judge | "error" = () => ({}),
) {
	const server = http.createServer((request, response) => {
		if (request.url === "/ok.png") {
			response.writeHead(200, { "content-type": "image/png" });
			response.end(PNG);
		} else {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const searches: unknown[] = [];
	const f = fixture(t, {
		memes: [custom[0]],
		reply: (request) => {
			if (!request.context.systemPrompt!.startsWith("You judge")) return {};
			const answer = judge(String(request.context.messages[0]!.content));
			if (answer === "error")
				return { stopReason: "error", errorMessage: "judge down" };
			return {
				text: JSON.stringify({
					safe: true,
					relevant: true,
					accurate: null,
					...answer,
				}),
			};
		},
	});
	const web = f.start({
		createSearchAgent: () => ({
			find: async (request) => {
				searches.push(request);
				return hits.map((hit) => ({
					...hit,
					image: String(hit.image).replace("BASE", base),
				})) as never;
			},
		}),
	});
	await web.call("save-settings", { useMemegen: false, searchAgent: other });
	const judged = () =>
		f.requests.filter((request) =>
			request.context.systemPrompt!.startsWith("You judge"),
		).length;
	return { ...f, ...web, searches, judged };
}
const hit = {
	image: "BASE/ok.png",
	name: "Drake approving",
	terms: ["cuda"],
	source: "https://memes.example.test/drake",
	credit: "Example Archive",
	license: "CC BY-SA 4.0",
};
const ask = { prompt: "Who backed CUDA?" };

test("web search: a judged hit with source text is shown as the answer, with credit", async (t) => {
	const w = await webFixture(
		t,
		[{ ...hit, title: "NVIDIA backed CUDA" }],
		() => ({
			accurate: true,
		}),
	);
	const found = await w.call<GeneratedMeme>("generate", ask);
	assert.equal(found.meme.origin, "web");
	assert.equal(found.webMatch, "answer");
	assert.equal(found.meme.credit, "Example Archive");
	assert.equal(found.meme.source, "https://memes.example.test/drake");
	assert.deepEqual(found.lines, []);
	assert.equal((w.searches[0] as { safeSearch: boolean }).safeSearch, true);
	assert.equal(w.requests.length, 1, "one judge call, no caption generation");
	assert.deepEqual(
		await w.call<MemeImage>("get-image", { id: found.meme.id }),
		{
			mimeType: "image/png",
			data: PNG.toString("base64"),
		},
	);
});

test("web search: without source text the meme is labelled related", async (t) => {
	const w = await webFixture(t, [hit]);
	const found = await w.call<GeneratedMeme>("generate", ask);
	assert.equal(found.webMatch, "related");
});

test("web search: a broken image falls back to the next hit, then to generation", async (t) => {
	const broken = { ...hit, image: "BASE/missing.png", name: "Broken" };
	const next = await webFixture(t, [broken, hit]);
	assert.equal(
		(await next.call<GeneratedMeme>("generate", ask)).meme.name,
		"Drake approving",
	);
	const none = await webFixture(t, [broken]);
	assert.equal(
		(await none.call<GeneratedMeme>("generate", ask)).meme.origin,
		"custom",
	);
});

test("web search: unsafe, irrelevant, inaccurate or failed judgements reject the hit", async (t) => {
	for (const judge of [
		() => ({ safe: false }),
		() => ({ relevant: false }),
		() => ({ accurate: false }),
		() => "error" as const,
	]) {
		const w = await webFixture(t, [{ ...hit, text: "CUDA" }], judge);
		const result = await w.call<GeneratedMeme>("generate", ask);
		assert.equal(result.meme.origin, "custom");
		assert.ok(w.judged() >= 1);
	}
});

test("web search: off, unconfigured, NC licence or no term match skip the judge", async (t) => {
	const off = await webFixture(t, [hit]);
	await off.call("save-settings", { webSearch: false });
	assert.equal(
		(await off.call<GeneratedMeme>("generate", ask)).meme.origin,
		"custom",
	);
	assert.equal(off.searches.length, 0);

	const unset = await webFixture(t, [hit]);
	await unset.call("save-settings", { searchAgent: null });
	assert.equal(
		(await unset.call<GeneratedMeme>("generate", ask)).meme.origin,
		"custom",
	);
	assert.equal(unset.searches.length, 0);

	const filtered = await webFixture(t, [
		{ ...hit, license: "CC BY-NC 4.0" },
		{ ...hit, terms: ["weather"] },
	]);
	assert.equal(
		(await filtered.call<GeneratedMeme>("generate", ask)).meme.origin,
		"custom",
	);
	assert.equal(filtered.judged(), 0);
});

test("web search settings: the agent is configured by the learner, not hardcoded", async (t) => {
	const f = fixture(t, { memes: [custom[0]] });
	const { call } = f.start();
	const state = await call<PluginState>("save-settings", {
		searchAgent: other,
	});
	assert.deepEqual(state.settings.searchAgent, other);
	assert.equal(state.settings.webSearch, true, "on by default");
	await assert.rejects(
		call("save-settings", { searchAgent: { provider: "", id: "x" } }),
		/searchAgent must be/,
	);
});

// #17 meme modes

test("Answer mode is unchanged: same fill request, same result shape, early reads refused", async (t) => {
	const f = fixture(t, { memes: [custom[0]] });
	const { call } = f.start();
	await call("save-settings", offline);
	assert.equal((await call<PluginState>("get-state")).settings.mode, "answer");
	const concept = { prompt: "Who backed CUDA?", context: "GPU history" };
	// Options are ignored in Answer mode.
	const meme = await call<GeneratedMeme>("generate", {
		...concept,
		options: ["Jensen Huang", "Lisa Su"],
	});
	const expected = fillRequest({
		meme: { name: "Proud speech" },
		template: parseTemplate(templates["Proud speech"], custom[0]!.caption),
		concept,
		emphasis: true,
	});
	assert.equal(f.requests[1]!.context.systemPrompt, expected.systemPrompt);
	assert.equal(f.requests[1]!.context.messages[0]!.content, expected.user);
	assert.equal("mode" in meme, false);
	assert.equal(meme.fact, "Jensen Huang backed CUDA.");
	assert.deepEqual(meme.emphasis, { after: 1, text: "CUDA!!" });

	// Template, fill, and the #7 fact check.
	assert.equal(f.requests.length, 3);
	await assert.rejects(
		call("generate", { ...concept, early: true }),
		/Reveal the question first/,
	);
	assert.equal(f.requests.length, 3, "no model call for a refused early read");
});

const hintReply = (request: PluginInferenceRequest): Reply =>
	request.context.systemPrompt!.startsWith("You turn the caption")
		? {}
		: {
				text: JSON.stringify({
					values: {
						achievement: "launched a GPU platform",
						name: "the GeForce maker's boss",
					},
					emphasis: { after: 1, text: "CUDA!!" },
					answer: "Jensen Huang",
					fact: "Think of who runs the company behind GeForce.",
				}),
			};

test("Hint mode reads early questions, hides its answer and drops emphasis", async (t) => {
	const f = fixture(t, { memes: [custom[0]], reply: hintReply });
	const { call } = f.start();
	await call("save-settings", { ...offline, mode: "hint" });
	const meme = await call<GeneratedMeme>("generate", {
		prompt: "Who backed CUDA?",
		options: ["Jensen Huang", "Lisa Su"],
		early: true,
	});
	assert.equal(meme.mode, "hint");
	assert.equal(meme.emphasis, null);
	assert.deepEqual(meme.lines, [
		"She launched a GPU platform is what she did. And on this floor, the GeForce maker's boss is a legend!",
	]);
	assert.equal(meme.fact, "Think of who runs the company behind GeForce.");
	assert.ok(
		!JSON.stringify(meme).includes("Jensen"),
		"the model's answer is never returned",
	);
	assert.ok(!JSON.stringify(f.stored()).includes("Jensen"), "nor stored");
	assert.match(f.requests[1]!.context.systemPrompt!, /gives a hint/);
	assert.match(
		String(f.requests[1]!.context.messages[0]!.content),
		/have not seen it yet/,
	);
	await assert.rejects(
		call("generate", { prompt: "x", options: "Jensen Huang | Lisa Su" }),
		/answer options could not be read/,
	);
});

test("a Think caption that gives the answer away is corrected once, then another meme is tried", async (t) => {
	const leaking: Record<string, unknown> = {
		"Proud speech": { achievement: "beat Lisa Su", name: "Jensen Huang" },
		"Two panel": { rejected: "Lisa Su", preferred: "Jensen Huang" },
	};
	const f = fixture(t, {
		reply: (request) =>
			/^You (turn the caption|choose which meme)/.test(
				request.context.systemPrompt!,
			)
				? {}
				: {
						text: JSON.stringify({
							values: leaking[f.memeOf(request)],
							emphasis: null,
							answer: "Jensen Huang",
							fact: "Which one backed CUDA?",
						}),
					},
	});
	const { call } = f.start();
	await call("save-settings", { ...offline, mode: "think" });
	await assert.rejects(
		call("generate", {
			prompt: "Who backed CUDA?",
			options: ["Jensen Huang", "Lisa Su"],
		}),
		(error: Error) =>
			/gives the answer away/.test(error.message) &&
			!error.message.includes("Jensen"),
	);
	// The #4 pick step runs once (two candidates); fills exclude it.
	const fills = f.requests.filter(
		(request) =>
			!/^You (turn the caption|choose which meme)/.test(
				request.context.systemPrompt!,
			),
	);
	assert.equal(fills.length, 4, "two memes, one correction each");
	assert.match(fills[0]!.context.systemPrompt!, /only one is true/);
	assert.deepEqual(f.stored().usage, {}, "no cooldown for a rejected meme");
});

type Tool = {
	name: string;
	parameters: {
		properties: Record<string, unknown>;
		additionalProperties: boolean;
	};
	execute(
		id: string,
		input: unknown,
	): Promise<{ content: { text: string }[]; details: GeneratedMeme }>;
};

test("the teacher meme tool exists only while a mode is on", async (t) => {
	const f = fixture(t, { memes: [custom[0]] });
	const { call, registered } = f.start();
	assert.equal(registered.length, 0, "off by default");
	await assert.rejects(call("save-settings", { teacherMemes: "always" }));
	for (const mode of ["teacher", "wrong"]) {
		await call("save-settings", { teacherMemes: mode });
		assert.equal(registered.length, 1);
	}
	const [tool] = registered[0]!.create({
		chatId: "c",
		agent: "teacher",
	}) as Tool[];
	assert.equal(tool!.name, "meme_teach");
	// No answer field: the tool only ever receives a concept.
	assert.deepEqual(Object.keys(tool!.parameters.properties).sort(), [
		"context",
		"prompt",
	]);
	assert.equal(tool!.parameters.additionalProperties, false);
	await call("save-settings", { teacherMemes: "off" });
	assert.equal(registered.length, 0, "turning it off removes the tool");
});

test("teacher memes are background work, capped per turns and by the daily budget", async (t) => {
	const f = fixture(t, { memes: [custom[0]] });
	const first = f.start();
	await first.call("save-settings", { ...offline, teacherMemes: "teacher" });
	const create = (chatId = "c") =>
		first.registered[0]!.create({ chatId, agent: "teacher" }) as Tool[];
	const [tool] = create();
	const result = await tool!.execute("call-1", { prompt: "Who backed CUDA?" });
	assert.equal(result.details.fact, "Jensen Huang backed CUDA.");
	assert.match(result.content[0]!.text, /Jensen Huang backed CUDA/);
	assert.ok(f.requests.every((request) => request.purpose === "background"));
	await assert.rejects(
		tool!.execute("call-2", { prompt: "Again?" }),
		/limit/,
		"a second meme in the same turn is refused",
	);
	// Turns 2 to 5 after the meme: not offered. Turn 6: offered again.
	for (let turn = 2; turn <= 5; turn++) assert.equal(create().length, 0);
	assert.equal(create().length, 1);
	assert.equal(create("other").length, 1, "the cap is per chat");
	assert.equal(f.stored().automatic.count, 1);
	first.dispose();

	// The shared daily budget, once spent, hides the tool everywhere.
	const stored = f.stored();
	stored.automatic = {
		day: new Date().toLocaleDateString("en-CA"),
		count: TEACHER_TOOL.automaticMemesPerDay,
	};
	fs.writeFileSync(
		path.join(f.dataDirectory, "state.json"),
		JSON.stringify(stored),
	);
	const second = f.start();
	assert.equal(
		second.registered[0]!.create({ chatId: "new", agent: "teacher" }).length,
		0,
	);
});
