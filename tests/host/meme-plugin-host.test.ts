/** Host check, run from a LearnHarness checkout (not by `npm test`): the BUILT meme-plugin package is
 * installed with the portable installer and loaded by the real LearnHarness plugin
 * host and inference adapter, against a scripted off-network model.
 *
 *   cp tests/host/meme-plugin-host.test.ts "<learnharness-checkout>/tests/"
 *   cd "<learnharness-checkout>" && MEME_PLUGIN_PROJECT="<this-project>" npx tsx --test tests/meme-plugin-host.test.ts
 *
 * Build this project first. Written against LearnHarness v0.6.0. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { AssistantMessage, TranscriptContext } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { createPluginHost } from "../src/server/plugin-host.ts";
import { createPluginInference, type PluginInferenceDeps } from "../src/server/plugin-inference.ts";
import type { ModelCatalogResponse } from "../src/core/contracts/models.ts";
import type { PluginLearningData } from "../src/core/plugins.ts";
import type { PluginAgentService } from "../src/core/plugin-agents.ts";
import type { PluginWorkerService } from "../src/core/plugin-workers.ts";

const PROJECT = process.env.MEME_PLUGIN_PROJECT!;
const model = { provider: "fixture", id: "cheap-model" };
const catalog: ModelCatalogResponse = {
	models: [{ ...model, name: "Fixture", reasoning: false, input: ["text"], supportedLevels: ["off"], cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 4096 }],
	providers: [{ id: "fixture", envVar: "FIXTURE_KEY", keyPresent: true }], defaults: { model },
	rolePins: { researcher: null, demoBuilder: null, visualMaker: null, extractor: null, auditor: null, sideQuestion: null }, slots: { strong: { model }, cheap: { model }, vision: null },
} as ModelCatalogResponse;
const template = { lines: ["She {achievement} is what she did. And on this floor, {name} is a legend!"], slots: [{ name: "achievement", hint: "deed", original: "fixed the printer" }, { name: "name", hint: "who", original: "Dana" }], voice: "proud" };
const filling = { values: { achievement: "backed CUDA", name: "Jensen Huang" }, emphasis: { after: 1, text: "CUDA!!" }, fact: "Jensen Huang backed CUDA." };

for (const appVersion of ["0.6.0", "0.5.0"]) test(`built meme-plugin in the real plugin host (app ${appVersion})`, async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "meme-host-"));
	const plugins = path.join(root, "plugins");
	fs.mkdirSync(plugins);
	// The documented outside-workspace install path: build output -> <plugins>/<id>/dist.
	const installed = execFileSync(process.execPath, [path.join(PROJECT, "scripts", "install-plugin-local.mjs"), plugins], { cwd: PROJECT, encoding: "utf8" });
	assert.match(installed, /Installed: .*meme-plugin[\\/]dist/);
	const data = path.join(plugins, "meme-plugin", "data");
	fs.mkdirSync(data);
	fs.writeFileSync(path.join(data, "custom-memes.json"), JSON.stringify([{ id: "proud-speech", name: "Proud speech", caption: ["She fixed the printer is what she did. And on this floor, Dana is a legend!"] }]));

	const calls: { background: boolean; context: TranscriptContext; maxTokens?: number }[] = [];
	const deps: PluginInferenceDeps = {
		catalog: () => structuredClone(catalog), providerKeyPresent: () => true,
		engineForSpec: (pin, background) => ({ model: { api: "fixture", provider: pin.provider, id: pin.id } as never, level: "off", streamFn: (_model, context, options) => {
			calls.push({ background, context: structuredClone(context), maxTokens: options?.maxTokens });
			const system = context.messages.find(message => message.role === "system");
			const text = JSON.stringify(String((system as { content: unknown }).content).startsWith("You turn the caption") ? template : filling);
			const message = { role: "assistant", api: "fixture", provider: pin.provider, model: pin.id, timestamp: 1, stopReason: "stop", content: [{ type: "text", text }],
				usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 } } } as unknown as AssistantMessage;
			const stream = new AssistantMessageEventStream();
			stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "stop", message }); stream.end();
			return stream;
		} }),
	};
	const host = createPluginHost({
		directory: plugins, appVersion,
		createServices({ dataDirectory, signal }) {
			const adapter = createPluginInference({ signal, dataDirectory }, deps);
			return { learning: {} as PluginLearningData, inference: adapter.inference, agents: {} as PluginAgentService, workers: { dispose: async () => {} } as unknown as PluginWorkerService,
				createBackgroundTool() { throw new Error("unused"); } };
		},
	});
	t.after(async () => { await host.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
	const call = (operation: string, input?: unknown) => host.call("meme-plugin", operation, input);

	await host.initialize();
	const listed = host.list().find(info => info.id === "meme-plugin");
	if (appVersion === "0.5.0") {
		// minAppVersion 0.6.0: an older app reports the package without evaluating it.
		assert.equal(listed?.status, "error");
		assert.match(listed?.error ?? "", /0\.6\.0|version|requires/i);
		return;
	}
	assert.equal(listed?.status, "disabled", listed?.error);
	assert.equal(listed?.origin, "community");
	assert.deepEqual([listed?.manifest?.main, listed?.manifest?.backend, listed?.manifest?.styles], ["main.js", "backend.cjs", "styles.css"]);
	assert.equal(fs.existsSync(path.join(data, "state.json")), false, "disabled discovery evaluates nothing");
	await assert.rejects(call("get-state"));

	await host.setEnabled("meme-plugin", true);
	assert.equal(host.list().find(info => info.id === "meme-plugin")?.status, "active", host.list()[0]?.error);
	const state = await call("save-settings", { useMemegen: false }) as { pool: { custom: number; memegen: number } };
	assert.deepEqual(state.pool, { custom: 1, memegen: 0, coolingDown: 0 });

	const meme = await call("generate", { prompt: "Who backed CUDA?" }) as { lines: string[]; meme: { id: string; hasImage: boolean }; fact: string };
	assert.deepEqual(meme.lines, ["She backed CUDA is what she did. CUDA!! And on this floor, Jensen Huang is a legend!"]);
	assert.deepEqual(meme.meme.id, "custom:proud-speech");
	assert.equal(await call("get-image", { id: meme.meme.id }), null);
	assert.equal(calls.length, 2);
	assert.deepEqual(calls.map(entry => entry.background), [false, false], 'purpose "user" reaches the host as foreground work');
	assert.deepEqual(calls.map(entry => entry.maxTokens), [2048, 2048]);
	assert.match(JSON.stringify(calls[1]!.context.messages), /Who backed CUDA\?/);

	// Host usage accounting and plugin state both live in the sibling data directory.
	assert.equal(fs.readFileSync(path.join(data, "usage.jsonl"), "utf8").trim().split("\n").length, 2);
	const stored = JSON.parse(fs.readFileSync(path.join(data, "state.json"), "utf8"));
	assert.equal(stored.usage["custom:proud-speech"].uses, 1);
	assert.deepEqual(fs.readdirSync(path.join(plugins, "meme-plugin", "dist")).sort(), ["LICENSE", "README.md", "THIRD-PARTY.md", "backend.cjs", "main.js", "manifest.json", "styles.css"]);

	await host.setEnabled("meme-plugin", false);
	await assert.rejects(call("generate", { prompt: "x" }));
	// Re-enable: settings, cooldowns and the cached template survive; one request per meme now.
	await host.setEnabled("meme-plugin", true);
	assert.equal(((await call("get-state")) as { pool: { coolingDown: number } }).pool.coolingDown, 1);
	await call("generate", { prompt: "Who backed CUDA?" });
	assert.equal(calls.length, 3);

	// Updating code replaces dist/ only.
	execFileSync(process.execPath, [path.join(PROJECT, "scripts", "install-plugin-local.mjs"), plugins], { cwd: PROJECT, encoding: "utf8" });
	assert.equal(JSON.parse(fs.readFileSync(path.join(data, "state.json"), "utf8")).usage["custom:proud-speech"].uses, 2);
});
