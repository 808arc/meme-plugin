/** Tunable values, one self-contained section per issue. */

// #21 own memes
export const OWN_MEMES = Object.freeze({
	/** Chance that a pick comes from your own memes while at least one of them is
	 * out of cooldown. 1 follows the source order strictly: own memes first, the
	 * catalogue once every own meme is cooling down. Lower values mix the catalogue in. */
	share: 1,
});
