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
