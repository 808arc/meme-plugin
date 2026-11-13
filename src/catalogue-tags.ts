/** Tags for the bundled memegen catalogue (`data/memegen-templates.json`, field `tags`).
 *
 * Assigned by hand from each template's name and example caption only. They are not
 * validated against real use or a learner panel: every entry says `source: "manual-rule"`
 * so a person can review and change it. `scripts/sync-memegen.mjs` keeps these tags
 * when it regenerates the file.
 *
 * Default hiding follows CATALOGUE_TAGS in src/config.ts: today only `weak` templates
 * leave the pool. `dated` is data for ranking (see isDated). Untagged templates stay in. */

import { CATALOGUE_TAGS } from "./config.ts";

/** How the joke is built, from the template's name and caption. */
export const STRUCTURES = [
	/** A face or pose reacts to a situation named in the caption. */
	"reaction",
	/** Two or more things are set side by side and one is judged against the other. */
	"contrast",
	/** Steps or stages that escalate, or a ranked list. */
	"escalation",
	/** A setup line followed by a twist or punchline. */
	"setup-punchline",
	/** A quotable line or image that carries the joke on its own. */
	"catchphrase",
	/** The joke depends on spelling, a pun, or a sound-alike. */
	"wordplay",
] as const;

/** The mood the caption is written in. */
export const TONES = [
	"playful",
	"sarcastic",
	"absurd",
	"deadpan",
	"self-deprecating",
	"sincere",
] as const;

export type Structure = (typeof STRUCTURES)[number];
export type Tone = (typeof TONES)[number];

export interface TemplateTags {
	structure: Structure;
	tone: Tone;
	/** Recognition has faded: tied to a past event, person or meme wave that most people
	 * no longer place. Not about age: old classics still widely recognised (Drake,
	 * Distracted Boyfriend, This is Fine) are not dated. */
	dated: boolean;
	/** The frame is too thin to reuse for a learning joke. */
	weak: boolean;
	/** How this entry was made. Only "manual-rule" exists so far. */
	source: "manual-rule";
}

export function isTemplateTags(value: unknown): value is TemplateTags {
	if (!value || typeof value !== "object") return false;
	const tags = value as Record<string, unknown>;
	return (
		(STRUCTURES as readonly unknown[]).includes(tags.structure) &&
		(TONES as readonly unknown[]).includes(tags.tone) &&
		typeof tags.dated === "boolean" &&
		typeof tags.weak === "boolean" &&
		tags.source === "manual-rule"
	);
}

/** True when recognition of the template has faded. A ranking signal, not a filter. */
export function isDated(tags: TemplateTags | undefined): boolean {
	return Boolean(tags?.dated);
}

/** True when the default pool should leave this template out. */
export function hiddenByDefault(
	tags: TemplateTags | undefined,
	rules: { hideWeak: boolean; hideDated: boolean } = CATALOGUE_TAGS,
): boolean {
	if (!tags) return false;
	return (rules.hideWeak && tags.weak) || (rules.hideDated && tags.dated);
}
