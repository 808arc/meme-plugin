/** Tunables, one self-contained section per feature. */

// #17 meme modes
/** Design: docs/meme-modes.md. */
export const MEME_MODES = Object.freeze({
	/** Order shown in settings. Answer must stay first and default. */
	modes: Object.freeze(["answer", "hint", "think"] as const),
	defaultMode: "answer" as const,
	/** Modes allowed to read a question the learner has not revealed yet. */
	preReveal: Object.freeze(["hint", "think"] as const),
	/** Longest "answer" the model may name for the no-answer check. */
	maxAnswerLength: 80,
	/** Most option labels taken from the question for the no-answer check. */
	maxOptions: 12,
	maxOptionLength: 200,
	labels: Object.freeze({
		answer: "Answer",
		hint: "Hint",
		think: "Think",
	}),
});
export type MemeMode = (typeof MEME_MODES.modes)[number];
