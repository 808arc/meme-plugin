/** Tunable values, one self-contained section per issue. */

// #21 own memes
export const OWN_MEMES = Object.freeze({
	/** Default of the "Own memes first" setting: chance (%) that a pick comes from
	 * your own memes while at least one of them is out of cooldown. 100 follows the
	 * source order strictly: own memes first, the catalogue once every own meme is
	 * cooling down. Lower values mix the catalogue in. */
	sharePercent: 100,
	/** Default of "Minimum cooldown after rejecting" (days). Applies even when the
	 * normal cooldown is 0, so a rejected meme never comes straight back. */
	rejectCooldownDays: 1,
	/** Default custom memes folder. Empty: the plugin's own data/ folder. */
	folder: "",
	/** Exports are written here, inside data/: the plugin writes nowhere else. */
	exportsFolder: "exports",
});
