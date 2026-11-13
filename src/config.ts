/** Tunable product constants. Each issue keeps its own self-contained section. */

// #9 reuse
/** Reuse of earlier generated memes for the same concept (src/reuse.ts). */
export const REUSE = Object.freeze({
	/** Largest share of one concept's picks that may reuse an earlier meme. */
	share: 0.2,
	/** Earlier generations kept per concept; lowest-rated, then oldest, go first. */
	maxPerConcept: 5,
	/** Fresh generations a concept needs before any reuse is considered. */
	freshFirst: 4,
});

// #8 meme card
/** Notification topic for generate progress (backend events.emit -> frontend). */
export const STAGE_TOPIC = "meme-stage";
/** Progress stages of one generate call, in order, with the label the page shows.
 * Add a stage here, then emit it from the backend where that step starts; the
 * page shows any stage listed here and ignores unknown ones. */
export const STAGES = Object.freeze({
	selecting: "Finding a fitting meme…",
	writing: "Writing the caption…",
});
export type MemeStage = keyof typeof STAGES;
