/** Fixed limits, one section per feature. Not user settings. */

// #10 teacher tool
/** Limits for memes the learner did not ask for. `automaticMemesPerDay` is the one
 * shared budget for all automatic memes: this tool now, buttonless mode (#18) later. */
export const TEACHER_TOOL = Object.freeze({
	/** At most one teacher meme per this many teacher turns in a chat. A turn is one
	 * host tool-loadout request (`registerTools` create), the only turn signal the API gives. */
	turnsPerMeme: 5,
	/** Shared daily budget for automatic memes, counted by local calendar day. */
	automaticMemesPerDay: 10,
});

// #18 buttonless mode
/** Automatic memes after a question's answer is shown. Each one spends the shared
 * `TEACHER_TOOL.automaticMemesPerDay` budget; there is no second budget. */
export const BUTTONLESS = Object.freeze({
	/** "Every Nth revealed question": N. */
	everyNth: 3,
	/** An automatic meme opens folded to one line; the learner expands it. */
	collapsed: true,
	/** Questions already handled, kept so none gets a second automatic meme. Oldest drop first. */
	rememberedQuestions: 500,
});
