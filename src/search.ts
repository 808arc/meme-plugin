/** Web search for an existing meme, through a search agent the learner configures.
 * The agent is an interface: this module never names a provider. Only the concept
 * text goes to the agent; what comes back is filtered here before anything is shown. */
import { createHash } from "node:crypto";
import { WEB_SEARCH } from "./config.ts";
import type { ModelRequest } from "./prompts.ts";
import type { Concept, Meme } from "./types.ts";

/** One candidate from the search agent. Fields are untrusted until filtered. */
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
	/** Licence identifier, e.g. "CC-BY-4.0". Required, and must be on the allow-list. */
	license?: string;
	/** Title of the source page, if the agent has it. */
	title?: string;
	/** Text on or around the meme, if the agent has it. */
	text?: string;
}

export interface SearchRequest {
	concept: Concept;
	/** Always true: the agent must ask its providers for safe results. */
	safeSearch: true;
	signal: AbortSignal;
}

export interface SearchAgent {
	find(request: SearchRequest): Promise<SearchHit[]>;
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
const MAX_JUDGED_TEXT = 1000;

/** Lowercase words of four letters or more, minus common filler. */
export function conceptTerms(concept: Concept): Set<string> {
	const words = `${concept.prompt} ${concept.context ?? ""}`
		.toLowerCase()
		.match(/[a-z][a-z-]{3,}/g);
	return new Set((words ?? []).filter((word) => !STOP_WORDS.has(word)));
}

/** "CC BY-SA 4.0" -> "CC-BY-SA"; "Public domain" -> "PUBLIC-DOMAIN". */
export function normalizeLicence(licence: string): string {
	return licence
		.trim()
		.toUpperCase()
		.replace(/[\s_]+/g, "-")
		.replace(/-\d+(\.\d+)*$/, "")
		.replace(/-+$/, "");
}

export function licenceAllowed(licence: string | undefined): boolean {
	return (
		typeof licence === "string" &&
		WEB_SEARCH.licences.includes(normalizeLicence(licence))
	);
}

/** Cheap prefilter before any model call: allowed licence, credit, http(s) links,
 * and at least one of the hit's terms equal to a concept term. */
export function acceptable(hit: SearchHit, terms: Set<string>): boolean {
	if (typeof hit?.image !== "string" || !HTTP.test(hit.image)) return false;
	if (typeof hit.source !== "string" || !HTTP.test(hit.source)) return false;
	if (typeof hit.credit !== "string" || !hit.credit.trim()) return false;
	if (typeof hit.name !== "string" || !Array.isArray(hit.terms)) return false;
	if (!licenceAllowed(hit.license)) return false;
	return hit.terms.some(
		(term) => typeof term === "string" && terms.has(term.trim().toLowerCase()),
	);
}

/** Prefiltered hits in the agent's order, at most `WEB_SEARCH.maxJudged`. A failing
 * agent means no web meme: the caller then generates. Aborts propagate. */
export async function searchCandidates(
	agent: SearchAgent,
	concept: Concept,
	signal: AbortSignal,
): Promise<SearchHit[]> {
	const terms = conceptTerms(concept);
	if (!terms.size) return [];
	let hits: unknown;
	try {
		hits = await agent.find({ concept, safeSearch: true, signal });
	} catch (error) {
		if (signal.aborted) throw error;
		return [];
	}
	if (!Array.isArray(hits)) return [];
	return (hits as SearchHit[])
		.filter((hit) => acceptable(hit, terms))
		.slice(0, WEB_SEARCH.maxJudged);
}

/** True when the hit carries source text the judge can check for accuracy. */
export const hasText = (hit: SearchHit) =>
	!!(hit.title?.trim() || hit.text?.trim());

/** One cheap model call: is the meme safe, relevant and (with text) accurate? */
export function judgeRequest(hit: SearchHit, concept: Concept): ModelRequest {
	const clip = (value: string | undefined) =>
		(value ?? "").trim().slice(0, MAX_JUDGED_TEXT) || "(none)";
	return {
		systemPrompt: [
			"You judge whether a meme found on the web may be shown to a learner.",
			"- safe: false if the meme, its title or its text is sexual, hateful, harassing, violent or otherwise not safe for a classroom. When unsure, false.",
			"- relevant: true only if the meme is about the learner's concept.",
			"- accurate: when a title or text is given, true only if it is correct about the concept; null when there is no title or text.",
			'Reply with one JSON object and nothing else: {"safe": boolean, "relevant": boolean, "accurate": boolean | null}',
		].join("\n"),
		user: [
			`Concept: ${clip(concept.prompt)}`,
			...(concept.context ? [`Context: ${clip(concept.context)}`] : []),
			`Web meme: ${clip(hit.name)}`,
			`Source title: ${clip(hit.title)}`,
			`Source text: ${clip(hit.text)}`,
		].join("\n"),
	};
}

export interface Judgement {
	safe: boolean;
	relevant: boolean;
	accurate: boolean | null;
}

export function parseJudgement(raw: unknown): Judgement {
	const value = raw as Partial<Judgement> | null;
	if (
		!value ||
		typeof value !== "object" ||
		typeof value.safe !== "boolean" ||
		typeof value.relevant !== "boolean" ||
		!(typeof value.accurate === "boolean" || value.accurate === null)
	)
		throw new Error(
			'expected {"safe": boolean, "relevant": boolean, "accurate": boolean | null}',
		);
	return {
		safe: value.safe,
		relevant: value.relevant,
		accurate: value.accurate,
	};
}

/** How a judged hit may be shown: as the answer, as a related meme, or not at all. */
export function verdict(
	hit: SearchHit,
	judgement: Judgement,
): "answer" | "related" | null {
	if (!judgement.safe || !judgement.relevant) return null;
	if (!hasText(hit)) return "related";
	return judgement.accurate === true ? "answer" : null;
}

export function webMeme(hit: SearchHit): Meme {
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
