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

// #8 meme card
/** Notification topic for generate progress (backend events.emit -> frontend). */
export const STAGE_TOPIC = "meme-stage";
/** Progress stages of one generate call, in order, with the label the page shows.
 * Add a stage here, then emit it from the backend where that step starts; the
 * page shows any stage listed here and ignores unknown ones. */
export const STAGES = Object.freeze({
	/** Looking for an earlier meme for the same question (#9). */
	reuse: "Looking for an earlier meme…",
	/** Searching the web for an existing meme (#11, Answer mode only). */
	search: "Searching the web for a meme…",
	/** Choosing a template from own memes, then the catalogue (#21, #4). */
	selecting: "Finding a fitting meme…",
	writing: "Writing the caption…",
	/** The fact check (#7) or the no-answer check (#17). */
	checking: "Checking the caption…",
});
export type MemeStage = keyof typeof STAGES;

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

// #17 meme modes
/** Design: docs/meme-modes.md. */
export const MEME_MODES = Object.freeze({
	/** Order shown in settings. Answer must stay first and default. Shuffle (#32) is last. */
	modes: Object.freeze(["answer", "hint", "think", "shuffle"] as const),
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
		shuffle: "Shuffle",
	}),
});
export type MemeMode = (typeof MEME_MODES.modes)[number];
/** A mode that actually makes one meme: Shuffle resolves to one of these per question. */
export type ConcreteMode = Exclude<MemeMode, "shuffle">;

// #32 shuffle mode
/** Shuffle runs these concrete modes in this order, one per question, then repeats.
 * The position is kept per chat in memory and reset when the mode setting is saved. */
export const SHUFFLE_SEQUENCE: readonly ConcreteMode[] = Object.freeze([
	"answer",
	"hint",
	"think",
]);

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

// #31 tavily search
/** Tavily search provider (src/tavily.ts). The key is read from the environment only. */
export const TAVILY = Object.freeze({
	/** Environment variable holding the API key. Never stored, logged or echoed. */
	keyEnv: "TAVILY_API_KEY",
	endpoint: "https://api.tavily.com/search",
	/** Whole request, including reading the reply. Slower replies count as no hit. */
	timeoutMs: 8000,
	/** Results asked from Tavily per query. */
	maxResults: 10,
	/** Longest query text sent to Tavily, in characters. */
	maxQueryLength: 300,
	/** Most images mapped to hits per reply. */
	maxImages: 10,
});

// #36 comic effect
/** Tone presets for the caption wording (wording in src/prompts.ts). "none" adds nothing. */
export const TONES = Object.freeze([
	"none",
	"deadpan",
	"absurd",
	"sarcastic",
	"self-deprecating",
	"playful",
] as const);
export type Tone = (typeof TONES)[number];
