/** Tunable values, one section per feature. Each section stays self-contained. */

// #4 pick step
export const PICK_STEP = Object.freeze({
	/** How many memes not cooling down the model sees when picking one. */
	candidates: 20,
});

// #6 catalogue tags
/** Which catalogue tags (src/catalogue-tags.ts) take a template out of the default pool.
 * `dated` is kept as data for ranking in the pick step, not for hiding. */
export const CATALOGUE_TAGS = Object.freeze({
	hideWeak: true,
	hideDated: false,
});

// #7 fact check
export const FACT_CHECK = Object.freeze({
	/** Fill-and-check rounds per meme; after the last disagreeing fact no meme is shown. */
	MAX_FACT_ATTEMPTS: 3,
	/** Shown to the learner when no caption agreed with the question. */
	UNRELIABLE_MESSAGE: "Couldn't make a reliable meme for this question.",
});

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
