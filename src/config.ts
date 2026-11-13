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
