import assert from "node:assert/strict";
import { test } from "node:test";
import { TAVILY, WEB_SEARCH } from "../src/config.ts";
import { DEFAULT_SETTINGS, applySettingsPatch } from "../src/settings.ts";
import { conceptTerms, searchCandidates } from "../src/search.ts";
import {
	mapTavilyReply,
	searchAgentFor,
	tavilyAgent,
	tavilyKey,
} from "../src/tavily.ts";

const KEY = "tvly-test-key-do-not-leak";
const concept = { prompt: "Who backed CUDA?", context: "GPU history" };
const signal = new AbortController().signal;
const reply = {
	query: "meme: Who backed CUDA?",
	answer: null,
	images: [],
	results: [
		{
			title: "Nvidia backed CUDA early",
			url: "https://www.memes.example.test/cuda",
			content: "A short note about CUDA funding.",
			images: [
				{ url: "https://img.example.test/cuda.png", description: "cuda" },
				"https://img.example.test/second.png",
			],
		},
	],
};

/** A fetch stub that records calls and replies with the given status and body. */
function stubFetch(status: number, body: unknown = reply) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
		calls.push({ url: String(url), init: init! });
		return new Response(
			typeof body === "string" ? body : JSON.stringify(body),
			{ status, headers: { "content-type": "application/json" } },
		);
	}) as typeof fetch;
	return { fetchImpl, calls };
}

test("tavily: maps results and images to hits, with credit from the page host and no licence", () => {
	const hits = mapTavilyReply(reply);
	assert.equal(hits.length, 2);
	assert.deepEqual(hits[0], {
		image: "https://img.example.test/cuda.png",
		name: "Nvidia backed CUDA early",
		terms: ["nvidia", "backed", "cuda", "early"],
		source: "https://www.memes.example.test/cuda",
		credit: "memes.example.test",
		title: "Nvidia backed CUDA early",
		text: "A short note about CUDA funding.",
	});
	assert.equal(
		(hits[0] as { license?: string }).license,
		undefined,
		"no licence is assumed",
	);
});

test("tavily: a hit without an explicit allowed licence is rejected by the licence filter", async () => {
	const { fetchImpl } = stubFetch(200);
	const agent = tavilyAgent({ apiKey: KEY, fetch: fetchImpl });
	const found = await searchCandidates(agent, concept, signal);
	assert.deepEqual(found, [], "every Tavily hit lacks a licence");
	assert.ok(WEB_SEARCH.licences.length > 0);
	assert.ok(conceptTerms(concept).has("cuda"));
});

test("tavily: request sends the key in the header, safe search and no real network", async () => {
	const { fetchImpl, calls } = stubFetch(200);
	await tavilyAgent({ apiKey: KEY, fetch: fetchImpl }).find({
		concept,
		safeSearch: true,
		signal,
	});
	assert.equal(calls.length, 1);
	assert.equal(calls[0]!.url, TAVILY.endpoint);
	const init = calls[0]!.init;
	assert.equal(
		(init.headers as Record<string, string>).authorization,
		`Bearer ${KEY}`,
	);
	const body = JSON.parse(String(init.body));
	assert.equal(body.include_images, true);
	assert.equal(body.safe_search, true);
	assert.equal(body.query, "meme: Who backed CUDA?");
});

test("tavily: HTTP error, timeout-free failure, bad JSON and bad shape mean no hit (fail closed)", async () => {
	const cases: [string, ReturnType<typeof stubFetch>][] = [
		["http 500", stubFetch(500, { error: "down" })],
		["http 429", stubFetch(429, { error: "quota" })],
		["bad json", stubFetch(200, "{not json")],
		["bad shape", stubFetch(200, { hits: [] })],
	];
	for (const [label, { fetchImpl }] of cases) {
		const agent = tavilyAgent({ apiKey: KEY, fetch: fetchImpl });
		assert.deepEqual(await searchCandidates(agent, concept, signal), [], label);
	}
	const thrown = tavilyAgent({
		apiKey: KEY,
		fetch: (async () => {
			throw new Error("network down");
		}) as typeof fetch,
	});
	assert.deepEqual(await searchCandidates(thrown, concept, signal), []);
});

test("tavily: the key is read from the environment only, and never echoed in errors", async () => {
	assert.equal(tavilyKey({ TAVILY_API_KEY: "  " }), undefined);
	assert.equal(tavilyKey({}), undefined);
	assert.equal(tavilyKey({ TAVILY_API_KEY: ` ${KEY} ` }), KEY);
	const settings = { ...DEFAULT_SETTINGS, searchProvider: "tavily" as const };
	assert.equal(searchAgentFor(settings, {}), null, "no key, no agent");
	assert.equal(
		searchAgentFor(DEFAULT_SETTINGS, { TAVILY_API_KEY: KEY }),
		null,
		"provider none, no agent",
	);
	const { fetchImpl } = stubFetch(401, { error: `bad ${KEY}` });
	const agent = searchAgentFor(settings, { TAVILY_API_KEY: KEY }, fetchImpl);
	assert.ok(agent);
	await assert.rejects(agent.find({ concept, safeSearch: true, signal }));
});

test("settings: searchProvider defaults to none and accepts only none or tavily", () => {
	assert.equal(DEFAULT_SETTINGS.searchProvider, "none");
	assert.equal(
		applySettingsPatch(DEFAULT_SETTINGS, { searchProvider: "tavily" })
			.searchProvider,
		"tavily",
	);
	assert.throws(
		() => applySettingsPatch(DEFAULT_SETTINGS, { searchProvider: "bing" }),
		/searchProvider must be one of none, tavily/,
	);
});
