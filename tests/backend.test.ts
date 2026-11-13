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
import { activate } from "../src/backend.ts";
import { FACT_CHECK } from "../src/config.ts";
import { defaultBoxes, loadCustomMemes, memegenMemes } from "../src/library.ts";
import type { GeneratedMeme, MemeImage, PluginState } from "../src/types.ts";

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
	const memeOf = (request: PluginInferenceRequest) =>
		/^Meme: (.+)$/m.exec(String(request.context.messages[0]!.content))![1]!;
	const start = () => {
		const controller = new AbortController();
		const handlers = new Map<string, (input: unknown) => unknown>();
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
					const text =
						scripted.text ??
						JSON.stringify(
							request.context.systemPrompt!.startsWith("You turn the caption")
								? templates[memeOf(request)]
								: request.context.systemPrompt!.startsWith(
											"You check one study fact",
										)
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
		const dispose = activate(ctx);
		const call = async <T>(name: string, input?: unknown): Promise<T> => {
			const handler = handlers.get(name);
			if (!handler) throw new Error(`No handler: ${name}`);
			return (await handler(input)) as T;
		};
		return { call, dispose, controller };
	};
	return {
		dataDirectory,
		requests,
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
	await assert.rejects(a.call("generate", { prompt: "x" }), /not available/);
	assert.equal(
		none.requests.length,
		3,
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
	});
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

test("the bundled catalogue is well formed", () => {
	const memes = memegenMemes("https://api.memegen.link");
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
