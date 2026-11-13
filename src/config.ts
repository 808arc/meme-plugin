/** Tunable constants, one self-contained section per feature. */

// #7 fact check
export const FACT_CHECK = Object.freeze({
	/** Fill-and-check rounds per meme; after the last disagreeing fact no meme is shown. */
	MAX_FACT_ATTEMPTS: 3,
	/** Shown to the learner when no caption agreed with the question. */
	UNRELIABLE_MESSAGE: "Couldn't make a reliable meme for this question.",
});
