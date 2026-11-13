/** Tunables, one section per feature. Product decisions: edit freely. */

// #11 web search
export const WEB_SEARCH = Object.freeze({
	/** Licences a web meme may carry, normalized (uppercase, dashes, no version).
	 * Web memes are shown unmodified, so no-derivatives (ND) is fine. Non-commercial
	 * (NC) and unknown licences are excluded by not being listed. */
	licences: Object.freeze([
		"CC0",
		"PUBLIC-DOMAIN",
		"PDM",
		"CC-BY",
		"CC-BY-SA",
		"CC-BY-ND",
	]),
	/** At most this many prefiltered hits are judged by the model per meme. */
	maxJudged: 3,
});
