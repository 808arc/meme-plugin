/** Tavily as a web search provider (#31). Implements the SearchAgent interface from
 * search.ts. Tavily returns no licence data, so no hit leaves this module with a
 * licence: the licence filter in search.ts rejects every one of them. Any failure
 * throws, and searchCandidates turns that into no hit (fail closed). */
import { TAVILY } from "./config.ts";
import type { Settings } from "./types.ts";
import type { SearchAgent, SearchHit, SearchRequest } from "./search.ts";

export type Fetch = typeof fetch;

interface TavilyImage {
	url: string;
	description?: string;
}

interface TavilyResult {
	title: string;
	url: string;
	content: string;
	images: TavilyImage[];
}

/** The key from the environment, or undefined when unset or blank. Never logged. */
export function tavilyKey(env: NodeJS.ProcessEnv): string | undefined {
	const value = env[TAVILY.keyEnv]?.trim();
	return value ? value : undefined;
}

/** The agent for the learner's settings, or null when no provider is chosen or the
 * key is missing. */
export function searchAgentFor(
	settings: Settings,
	env: NodeJS.ProcessEnv,
	fetchImpl?: Fetch,
): SearchAgent | null {
	if (settings.searchProvider !== "tavily") return null;
	const apiKey = tavilyKey(env);
	return apiKey ? tavilyAgent({ apiKey, fetch: fetchImpl }) : null;
}

const isHttp = (value: unknown): value is string =>
	typeof value === "string" && /^https?:\/\/[^\s]+$/.test(value);

function field(value: unknown, max: number): string {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hostOf(url: string): string {
	return new URL(url).hostname.replace(/^www\./, "");
}

/** Maps a Tavily reply to hits. Only images tied to a result page become hits, since
 * the page is the source and its host the credit. Throws on an unexpected shape. */
export function mapTavilyReply(reply: unknown): SearchHit[] {
	const data = reply as { results?: unknown } | null;
	if (!data || typeof data !== "object" || !Array.isArray(data.results))
		throw new Error("Tavily reply has no results list");
	const hits: SearchHit[] = [];
	for (const raw of data.results as unknown[]) {
		const result = raw as Partial<TavilyResult> | null;
		if (!result || typeof result !== "object" || !isHttp(result.url)) continue;
		const title = field(result.title, 200);
		const text = field(result.content, 1000);
		const terms = (title.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).slice(
			0,
			20,
		);
		const images = Array.isArray(result.images) ? result.images : [];
		for (const image of images as unknown[]) {
			if (hits.length >= TAVILY.maxImages) return hits;
			const url =
				typeof image === "string"
					? image
					: (image as Partial<TavilyImage> | null)?.url;
			if (!isHttp(url)) continue;
			hits.push({
				image: url,
				name: title || "Web meme",
				terms,
				source: result.url,
				credit: hostOf(result.url),
				// No licence: Tavily does not report one, and none is assumed.
				title: title || undefined,
				text: text || undefined,
			});
		}
	}
	return hits;
}

export function tavilyAgent(options: {
	apiKey: string;
	fetch?: Fetch;
}): SearchAgent {
	const doFetch: Fetch = options.fetch ?? fetch;
	return {
		async find(request: SearchRequest): Promise<SearchHit[]> {
			const query = request.concept.prompt
				.trim()
				.slice(0, TAVILY.maxQueryLength);
			const timeout = AbortSignal.timeout(TAVILY.timeoutMs);
			const response = await doFetch(TAVILY.endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${options.apiKey}`,
				},
				body: JSON.stringify({
					query: `meme: ${query}`,
					search_depth: "basic",
					topic: "general",
					max_results: TAVILY.maxResults,
					include_images: true,
					include_image_descriptions: true,
					include_answer: false,
					include_raw_content: false,
					// Tavily's safe search filter. Not a substitute for the model judge.
					safe_search: request.safeSearch,
				}),
				redirect: "error",
				signal: AbortSignal.any([request.signal, timeout]),
			});
			if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
			return mapTavilyReply(await response.json());
		},
	};
}
