/** Web search for an existing meme, through a search agent the learner configures.
 * The agent is an interface: this module never names a provider. Only the concept
 * text goes to the agent; what comes back is filtered here before anything is shown. */
import { createHash } from "node:crypto";
import type { Concept, Meme } from "./types.ts";

/** One candidate from the search agent. Fields are untrusted until `acceptable`. */
export interface SearchHit {
	/** Image address (http or https). */
	image: string;
	name: string;
	/** Words the meme is about (tags, title keywords). Matched exactly against the concept. */
	terms: string[];
	/** Page the meme came from, shown as "about this meme". */
	source: string;
	/** Author or host credit, shown with the meme. */
	credit: string;
	/** Licence identifier, e.g. "CC-BY-4.0". Required. */
	license?: string;
}

export interface SearchAgent {
	find(concept: Concept, signal: AbortSignal): Promise<SearchHit[]>;
}

const STOP_WORDS = new Set([
	"about",
	"after",
	"also",
	"because",
	"before",
	"being",
	"between",
	"could",
	"does",
	"from",
	"have",
	"into",
	"more",
	"other",
	"should",
	"some",
	"than",
	"that",
	"their",
	"them",
	"then",
	"there",
	"these",
	"they",
	"this",
	"those",
	"through",
	"what",
	"when",
	"where",
	"which",
	"while",
	"with",
	"would",
	"your",
]);

const HTTP = /^https?:\/\/[^\s]+$/;

/** Lowercase words of four letters or more, minus common filler. */
export function conceptTerms(concept: Concept): Set<string> {
	const words = `${concept.prompt} ${concept.context ?? ""}`
		.toLowerCase()
		.match(/[a-z][a-z-]{3,}/g);
	return new Set((words ?? []).filter((word) => !STOP_WORDS.has(word)));
}

/** Conservative default: a licence and credit must be present, the links must be
 * http(s), and at least one of the hit's terms must equal a concept term exactly. */
export function acceptable(hit: SearchHit, terms: Set<string>): boolean {
	if (!HTTP.test(hit.image) || !HTTP.test(hit.source)) return false;
	if (!hit.license?.trim() || !hit.credit?.trim()) return false;
	return hit.terms.some((term) => terms.has(term.trim().toLowerCase()));
}

/** The first acceptable hit as a meme, or null. A failing agent means no web meme:
 * the caller then generates. Aborts propagate. */
export async function findWebMeme(
	agent: SearchAgent,
	concept: Concept,
	signal: AbortSignal,
): Promise<Meme | null> {
	const terms = conceptTerms(concept);
	if (!terms.size) return null;
	let hits: SearchHit[];
	try {
		hits = await agent.find(concept, signal);
	} catch (error) {
		if (signal.aborted) throw error;
		return null;
	}
	const hit = Array.isArray(hits)
		? hits.find((candidate) => acceptable(candidate, terms))
		: undefined;
	if (!hit) return null;
	return {
		id: `web:${createHash("sha256").update(hit.image).digest("hex").slice(0, 32)}`,
		origin: "web",
		name: hit.name.trim() || "Web meme",
		source: hit.source,
		credit: hit.credit.trim(),
		image: hit.image,
		caption: [],
		boxes: [],
	};
}
