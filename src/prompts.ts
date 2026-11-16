/** Model-facing wording for the pick and caption steps of the README. Product text:
 * edit freely. The process follows the Vellum meme-generator skill (MIT,
 * github.com/vellum-ai/vellum-assistant, skills/meme-generator): start with the take,
 * pick the template whose joke structure fits, write tight copy, one line per box.
 * Bump PROMPT_VERSION when the caption instructions change; eval reports record it. */
import { MAX_LINE_LENGTH, MAX_LINE_WORDS } from "./caption.ts";
import type { Tone } from "./config.ts";
import type { Concept, Meme } from "./types.ts";

export const PROMPT_VERSION = 5;

export interface ModelRequest {
	systemPrompt: string;
	user: string;
}

export const numbered = (lines: readonly string[]) =>
	lines.map((line, index) => `${index + 1}. ${line || "(empty)"}`).join("\n");

/** What each popular template is best for, from the skill's table (memegen ids). */
export const BEST_FOR: Readonly<Record<string, string>> = {
	drake: '"This not that" comparisons',
	db: "Three-way tension: the tempting new thing, the one distracted, the one neglected",
	fine: "Denial of obvious problems",
	cmm: "Hot takes, controversial opinions",
	astronaut: '"Wait, it was X?" / "Always has been"',
	pigeon: "Misidentifying something obvious",
	exit: "Choosing the wrong or chaotic option",
	gru: "A plan that backfires in step 3 or 4",
	pooh: "Basic versus sophisticated version",
	rollsafe: 'Galaxy-brain "logic"',
	chair: "Multi-panel heated debate",
	ds: "Two-button dilemma",
	same: "Two things that are identical",
	midwit: "Beginner and expert agree, the midwit overthinks",
	gb: 'Escalating "big brain" ideas',
	right: '"Right...?": dawning realization',
	harold: "Suffering in silence",
	vince: "Escalating excitement",
	home: "Wanting X, getting budget X",
	"panik-kalm-panik": "Emotional rollercoaster",
	"woman-cat": "Accusation versus unbothered response",
	spiderman: "Two identical things",
};

/** The skill's mapping from joke structure to template. */
const STRUCTURES = [
	"Comparison or preference: Drake, Pooh",
	"Hot take: Change My Mind",
	"Misidentification: Pigeon",
	"Denial: This is Fine",
	"Realization: Always Has Been, Anakin and Padme",
	"Escalation: Galaxy Brain, Vince McMahon",
	"Dilemma: Daily Struggle, Left Exit",
];

const bestFor = (meme: Pick<Meme, "id">) =>
	meme.id?.startsWith("memegen:")
		? BEST_FOR[meme.id.slice("memegen:".length)]
		: undefined;

/** Step 2: choose, from candidate memes, the one whose joke structure fits the take. */
export function pickRequest(
	concept: Concept,
	candidates: readonly (Pick<Meme, "name" | "caption"> &
		Partial<Pick<Meme, "id">>)[],
): ModelRequest {
	return {
		systemPrompt: [
			"You choose which meme to use for a study question. Start with the take: the one fact or contrast the learner should remember. Then pick the meme whose joke structure fits that take.",
			`Match the joke structure to the meme format:\n${STRUCTURES.map((line) => `- ${line}`).join("\n")}`,
			'Judge each meme by its original caption, which shows the shape of its joke, and by its "best for" note when it has one.',
			'Reply with one JSON object and nothing else: {"choice": number}, where the number is the meme\'s number in the list.',
		].join("\n"),
		user: [
			`The learner is being asked:\n${concept.prompt}`,
			concept.context ? `Shown with the question:\n${concept.context}` : "",
			`Memes:\n${numbered(
				candidates.map((meme) => {
					const note = meme.id ? bestFor(meme as Pick<Meme, "id">) : undefined;
					return `${meme.name}: ${meme.caption.join(" / ")}${note ? ` (best for: ${note})` : ""}`;
				}),
			)}`,
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}

/** The meme block shared by every caption prompt: its boxes in order, with the
 * original text of each, so the model sees which box is which. */
export function memeBlock(
	meme: Pick<Meme, "name" | "caption"> & Partial<Pick<Meme, "id">>,
): string {
	const note = meme.id ? bestFor(meme as Pick<Meme, "id">) : undefined;
	return [
		`Meme: ${meme.name}${note ? `\nBest for: ${note}` : ""}`,
		`Text boxes, in order, with the original meme's text:\n${numbered(meme.caption)}`,
	].join("\n");
}

/** The copy rules every caption prompt shares (the skill's "write tight copy"). */
export function copyRules(boxes: number): string[] {
	return [
		`- Write exactly ${boxes} ${boxes === 1 ? "line" : "lines"}, one per text box, in the boxes' order. Each line goes where the original line was and plays the same role in the joke.`,
		`- Tight copy: at most ${MAX_LINE_WORDS} words and ${MAX_LINE_LENGTH} characters per line; 3 to 8 words is best. If you need a sentence, the joke is not tight enough.`,
		'- A box the original leaves empty may stay empty (""). Plain text only, no emoji.',
	];
}

/** #36: one instruction line per tone, with style-only examples (no real facts). */
const TONE_STYLE: Record<
	Exclude<Tone, "none">,
	{ instruction: string; examples: readonly string[] }
> = {
	deadpan: {
		instruction:
			"Write deadpan: flat and unbothered, stating absurd things as if they were ordinary.",
		examples: [
			"The meeting could have been an email. It was a meeting.",
			"Everyone agreed to the plan. Nobody read the plan.",
			"The goose was informed. The goose was not impressed.",
		],
	},
	absurd: {
		instruction:
			"Write absurd: push the fact into a ridiculous, vivid image the character takes seriously.",
		examples: [
			"The sandwich demanded a seat at the table, a lawyer and a moat.",
			"The spoon has unionised. The forks are next.",
			"The bicycle has filed a formal complaint with the moon.",
		],
	},
	sarcastic: {
		instruction:
			"Write sarcastic: mock the situation with exaggerated politeness that means the opposite.",
		examples: [
			"Oh sure, reading one chapter is totally reasonable.",
			"Wow, what a shock, the printer broke again.",
			"Yes, because asking nicely has always worked before.",
		],
	},
	"self-deprecating": {
		instruction:
			"Write self-deprecating: the character makes fun of its own confusion or failure.",
		examples: [
			"I studied by staring at the textbook. Very effective. Very, very effective.",
			"My plan was flawless, which is why I am still in the car.",
			"I am the expert here, and the expert is confused.",
		],
	},
	playful: {
		instruction:
			"Write playful: light, bouncy and cheerful, like talking to a small friend.",
		examples: [
			"Hop on, little blob, we are going to the snack drawer!",
			"Wheee, the answer is over here, follow the sparkles!",
			"Tiny hat, big idea, let's go!",
		],
	},
};

/** The tone line for the fill prompt; none for "none", so that prompt is unchanged. */
export function toneRule(tone: Tone): string[] {
	if (tone === "none") return [];
	const { instruction, examples } = TONE_STYLE[tone];
	return [
		`- Tone: ${instruction} The tone changes only the wording; the facts and the rules above still apply. Style examples only, never copy them or their facts: ${examples.map((example) => `"${example}"`).join(" ")}`,
	];
}

/** Step 3: write the meme's lines about the concept, stating the correct answer. */
export function captionRequest(input: {
	meme: Pick<Meme, "name" | "caption"> & Partial<Pick<Meme, "id">>;
	concept: Concept;
	/** #36: comic tone; omitted or "none" leaves the prompt as before. */
	tone?: Tone;
	/** A fact from an earlier attempt that did not agree with the question. */
	avoid?: string;
}): ModelRequest {
	const answer = input.concept.answer
		? `The correct answer is: ${input.concept.answer.correct.join(" | ")}. The fact must say so.`
		: "";
	return {
		systemPrompt: [
			"You write the text of a study meme. A learner is being asked about a concept; the meme must state the correct answer so that it sticks.",
			"Start with the take: the single most important fact. Then write the meme's lines so the meme's joke structure carries that fact.",
			"Rules:",
			"- The lines must state true facts that answer the learner's question. Never invent names, dates or numbers.",
			"- Make it funny with exaggeration and absurdity, not puns or wordplay: push the true fact to a vivid, absurd extreme. Use one surprise, and put the punchline in the last line that has text.",
			"- A joke must never need a claim that is false or unsupported by the fact; when it would, state the plain fact instead.",
			...toneRule(input.tone ?? "none"),
			...copyRules(input.meme.caption.length),
			'- "fact" is the same fact as one plain sentence, without the meme.',
			'Reply with one JSON object and nothing else: {"lines": string[], "fact": string}',
		].join("\n"),
		user: [
			`The learner is being asked:\n${input.concept.prompt}`,
			input.concept.context
				? `Shown with the question:\n${input.concept.context}`
				: "",
			answer,
			input.avoid
				? `An earlier attempt wrote this fact, which does not agree with the question: "${input.avoid}". Write a fact that does.`
				: "",
			memeBlock(input.meme),
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}

/** The first complete JSON object in a model reply, tolerating fences and prose around it. */
export function extractJson(text: string): unknown {
	for (
		let start = text.indexOf("{");
		start !== -1;
		start = text.indexOf("{", start + 1)
	) {
		let depth = 0,
			quoted = false,
			escaped = false;
		for (let index = start; index < text.length; index++) {
			const character = text[index]!;
			if (quoted) {
				if (escaped) escaped = false;
				else if (character === "\\") escaped = true;
				else if (character === '"') quoted = false;
			} else if (character === '"') quoted = true;
			else if (character === "{") depth++;
			else if (character === "}" && --depth === 0) {
				try {
					return JSON.parse(text.slice(start, index + 1));
				} catch {
					break;
				}
			}
		}
	}
	throw new Error("The reply did not contain a JSON object");
}
