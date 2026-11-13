/** Shapes shared by the backend, the frontend and the tests. JSON-compatible only. */

/** Where one caption line is drawn, as fractions of the image (memegen's model). */
export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
	/** Degrees, counter-clockwise. */
	angle: number;
	color: string;
	style: "upper" | "lower" | "none" | "default";
	font: "thick" | "thin" | "comic";
	align: "left" | "center" | "right";
}

export interface Meme {
	/** Unique across origins: `memegen:<id>` or `custom:<id>`. */
	id: string;
	origin: "memegen" | "custom";
	name: string;
	/** Background link (e.g. Know Your Meme), shown as attribution. */
	source?: string;
	/** Absolute http(s) URL, or a file name inside `data/custom-images/`. Empty: text only. */
	image: string;
	/** The meme's original text, one entry per box. */
	caption: string[];
	boxes: Box[];
}

export interface Slot {
	name: string;
	/** What kind of thing belongs here. */
	hint: string;
	/** The words this slot stood for in the original caption. */
	original: string;
}

/** Step 3 of the README: fixed memetic phrasing plus fillable slots. */
export interface Template {
	/** Template lines aligned with the caption lines; slots are written `{name}`. */
	lines: string[];
	slots: Slot[];
	/** How the meme's character talks, used for the optional emphasis. */
	voice: string;
}

export interface Emphasis {
	/** 1-based template sentence the interjection follows. */
	after: number;
	text: string;
}

export interface Filling {
	values: Record<string, string>;
	emphasis: Emphasis | null;
	/** The fact the meme teaches, in one plain sentence. */
	fact: string;
}

export interface Concept {
	/** The question or statement LearnHarness is asking about. */
	prompt: string;
	/** Supporting material shown with the question, if any. */
	context?: string;
	/** The question's answer options, when the host marks which ones are correct. */
	answer?: ConceptAnswer;
}

export interface ConceptAnswer {
	/** Labels of the correct option(s). */
	correct: string[];
	/** Labels of the options that are wrong. */
	others: string[];
}

/** What the backend returns for one generated meme. */
export interface GeneratedMeme {
	meme: Pick<Meme, "id" | "origin" | "name" | "source" | "boxes"> & {
		hasImage: boolean;
	};
	concept: Concept;
	originalCaption: string[];
	templateLines: string[];
	/** Final text, one entry per box. */
	lines: string[];
	values: Record<string, string>;
	emphasis: Emphasis | null;
	fact: string;
	/** Handle for rating this meme (see rateGenerated in src/reuse.ts). */
	generatedId?: string;
	/** Set when an earlier meme for the same concept was reused instead of generated. */
	reused?: true;
	/** The learner's stored rating of this generated meme, sent with generate results. */
	rating?: "up" | "down" | null;
}

export interface Settings {
	/** Explicit model; null uses the host's configured cheap slot. */
	model: { provider: string; id: string } | null;
	/** Step 5 of the README. */
	emphasis: boolean;
	/** Days a meme stays out of rotation after its first use. 0 disables the cooldown. */
	cooldownDays: number;
	/** Each further use multiplies the cooldown by this factor. */
	cooldownGrowth: number;
	/** Include the bundled memegen catalogue in the pool. */
	useMemegen: boolean;
	/** Where blank memegen images come from. Empty: never fetch, show text only. */
	imageBaseUrl: string;
	/** #21: chance (%) that a pick comes from your own memes while one is eligible. */
	ownMemesShare: number;
	/** #21: a rejected meme stays out at least this many days, even with cooldown 0. */
	rejectCooldownDays: number;
	/** #21: absolute folder holding custom-memes.json and custom-images/. Empty: data/.
	 * Only ever read. */
	customFolder: string;
}

export interface Usage {
	uses: number;
	lastUsedAt: number;
	/** The meme is eligible again from this time. */
	dueAt: number;
}

export interface PluginState {
	settings: Settings;
	pool: { memegen: number; custom: number; coolingDown: number };
	/** #21: absolute folder custom memes are read from. */
	customFolder: string;
	/** Custom-library entries that were skipped, with the reason. */
	problems: string[];
}

/** #21: result of "Export my memes". */
export interface MemeExport {
	/** Absolute folder the copy was written to, inside the plugin's data/. */
	path: string;
	images: number;
}

export interface MemeImage {
	mimeType: string;
	/** Base64 without a data: prefix. */
	data: string;
}
