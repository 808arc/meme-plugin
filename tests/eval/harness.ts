/** Meme eval harness (issue #5): generate one meme per concept with the plugin's own
 * prompts and parsers, have a judge score it, and render a report.
 *
 * Model access is injected as `Complete`, a function from a prompt pair to the reply
 * text. The real run supplies live models (see run.ts); the unit tests supply stubs.
 * Replies are parsed exactly as the backend parses them, with no retry: a reply that
 * fails to parse is recorded as an error, so the eval measures first-try reliability. */
import {
	PROMPT_VERSION,
	extractJson,
	fillRequest,
	type ModelRequest,
	templateRequest,
} from "../../src/prompts.ts";
import {
	assemble,
	MAX_SLOTS,
	parseFilling,
	parseTemplate,
} from "../../src/template.ts";
import type { Meme } from "../../src/types.ts";
import type { EvalConcept } from "./concepts.ts";

export type Complete = (request: ModelRequest) => Promise<string>;

export const DIMENSIONS = ["fit", "humor", "accuracy"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface Score {
	/** Integer 1 (poor) to 5 (excellent). */
	score: number;
	reason: string;
}
export type Verdict = Record<Dimension, Score>;

const clip = (text: string, limit: number) =>
	text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;

/** Only memes the plugin's templating can handle: non-empty captions within the slot budget. */
export function eligibleMemes(memes: readonly Meme[]): Meme[] {
	return memes.filter(
		(meme) =>
			meme.caption.some((line) => line.trim() !== "") &&
			meme.caption.filter((line) => line.trim() !== "").length <= MAX_SLOTS,
	);
}

/** Deterministic assignment: concept i gets meme i (wrapping), so runs before and after a
 * prompt change compare the same meme for the same concept. */
export function pickMeme(memes: readonly Meme[], index: number): Meme {
	if (!memes.length) throw new Error("The eval meme pool is empty.");
	return memes[index % memes.length]!;
}

export function judgeRequest(input: {
	concept: EvalConcept;
	memeName: string;
	lines: readonly string[];
	fact: string;
}): ModelRequest {
	return {
		systemPrompt: [
			"You grade one study meme that teaches a learner a fact. You will see the question, a reference answer, the meme's final text and the fact it states.",
			"Score three dimensions from 1 (poor) to 5 (excellent), each with a one-sentence reason:",
			"- fit: does the meme address this question and state an answer to it, rather than something unrelated or a different question?",
			"- humor: would a learner find it funny or memorable as a meme? Judge the joke, not the accuracy.",
			"- accuracy: is the fact the meme states true and consistent with the reference answer? Penalise wrong, invented or contradictory facts heavily.",
			'Reply with one JSON object and nothing else: {"fit": {"score": 1-5, "reason": string}, "humor": {"score": 1-5, "reason": string}, "accuracy": {"score": 1-5, "reason": string}}',
		].join("\n"),
		user: [
			`Question: ${input.concept.prompt}`,
			input.concept.context
				? `Context shown with the question: ${input.concept.context}`
				: "",
			`Reference answer: ${input.concept.answer}`,
			`Meme: ${input.memeName}`,
			`Meme text: ${input.lines.map((line) => (line ? `"${line}"` : "(empty line)")).join(" / ")}`,
			`Fact stated by the meme: ${input.fact}`,
		]
			.filter(Boolean)
			.join("\n"),
	};
}

function record(raw: unknown, label: string): Record<string, unknown> {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		throw new Error(`${label} must be a JSON object`);
	return raw as Record<string, unknown>;
}

/** Accept a judge reply only if every dimension has an integer score 1 to 5 and a reason. */
export function parseVerdict(raw: unknown): Verdict {
	const item = record(raw, "The verdict");
	const verdict = {} as Verdict;
	for (const dimension of DIMENSIONS) {
		const entry = record(item[dimension], `"${dimension}"`);
		const score = entry.score;
		if (
			!Number.isInteger(score) ||
			(score as number) < 1 ||
			(score as number) > 5
		)
			throw new Error(`"${dimension}.score" must be an integer from 1 to 5`);
		const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
		if (!reason) throw new Error(`"${dimension}.reason" is missing`);
		verdict[dimension] = { score: score as number, reason: clip(reason, 400) };
	}
	return verdict;
}

export interface MadeMeme {
	templateLines: string[];
	values: Record<string, string>;
	fact: string;
	lines: string[];
}

/** Steps 3 to 5 of the plugin, without the cache, the emphasis and the retry. */
export async function makeMeme(
	concept: EvalConcept,
	meme: Meme,
	generate: Complete,
): Promise<MadeMeme> {
	const template = parseTemplate(
		extractJson(await generate(templateRequest(meme))),
		meme.caption,
	);
	const filling = parseFilling(
		extractJson(
			await generate(
				fillRequest({
					meme,
					template,
					concept: {
						prompt: concept.prompt,
						...(concept.context ? { context: concept.context } : {}),
					},
					emphasis: false,
				}),
			),
		),
		template,
	);
	return {
		templateLines: template.lines,
		values: filling.values,
		fact: filling.fact,
		lines: assemble(template, filling.values, null),
	};
}

export interface EvalRow {
	id: string;
	subject: string;
	prompt: string;
	memeId: string;
	memeName: string;
	lines?: string[];
	fact?: string;
	verdict?: Verdict;
	/** Set when the meme or the verdict could not be produced. */
	error?: string;
}

export interface EvalRun {
	startedAt: string;
	promptVersion: number;
	generator: string;
	judge: string;
	rows: EvalRow[];
	/** Mean score per dimension over scored rows; null when no row was scored. */
	means: Record<Dimension, number | null>;
	errors: number;
}

export interface RunOptions {
	concepts: readonly EvalConcept[];
	memes: readonly Meme[];
	generate: Complete;
	judge: Complete;
	generatorLabel: string;
	judgeLabel: string;
	now?: Date;
}

export async function runEval(options: RunOptions): Promise<EvalRun> {
	const rows: EvalRow[] = [];
	for (const [index, concept] of options.concepts.entries()) {
		const meme = pickMeme(options.memes, index);
		const row: EvalRow = {
			id: concept.id,
			subject: concept.subject,
			prompt: concept.prompt,
			memeId: meme.id,
			memeName: meme.name,
		};
		rows.push(row);
		try {
			const made = await makeMeme(concept, meme, options.generate);
			row.lines = made.lines;
			row.fact = made.fact;
		} catch (error) {
			row.error = `generation: ${(error as Error).message}`;
			continue;
		}
		try {
			row.verdict = parseVerdict(
				extractJson(
					await options.judge(
						judgeRequest({
							concept,
							memeName: meme.name,
							lines: row.lines!,
							fact: row.fact!,
						}),
					),
				),
			);
		} catch (error) {
			row.error = `judge: ${(error as Error).message}`;
		}
	}
	const scored = rows.flatMap((row) => (row.verdict ? [row.verdict] : []));
	const means = {} as Record<Dimension, number | null>;
	for (const dimension of DIMENSIONS) {
		const values = scored.map((verdict) => verdict[dimension].score);
		means[dimension] = values.length
			? Math.round(
					(values.reduce((sum, value) => sum + value, 0) / values.length) * 100,
				) / 100
			: null;
	}
	return {
		startedAt: (options.now ?? new Date()).toISOString(),
		promptVersion: PROMPT_VERSION,
		generator: options.generatorLabel,
		judge: options.judgeLabel,
		rows,
		means,
		errors: rows.filter((row) => row.error).length,
	};
}

const cell = (text: string | undefined) =>
	(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Markdown report: summary, one table row per concept, then the judge's reasons. */
export function formatReport(run: EvalRun): string {
	const mean = (value: number | null) =>
		value === null ? "n/a" : value.toFixed(2);
	const lines = [
		"# Meme eval report",
		"",
		`- Run at: ${run.startedAt}`,
		`- Prompt version: ${run.promptVersion}`,
		`- Generator: ${run.generator}`,
		`- Judge: ${run.judge}`,
		`- Concepts: ${run.rows.length}, errors: ${run.errors}`,
		"",
		"## Means",
		"",
		"| fit | humor | accuracy |",
		"| --- | --- | --- |",
		`| ${DIMENSIONS.map((dimension) => mean(run.means[dimension])).join(" | ")} |`,
		"",
		"## Concepts",
		"",
		"| concept | subject | meme | text | fit | humor | accuracy | note |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
	];
	for (const row of run.rows) {
		const scores = DIMENSIONS.map((dimension) =>
			row.verdict ? String(row.verdict[dimension].score) : "-",
		);
		lines.push(
			`| ${cell(row.prompt)} | ${cell(row.subject)} | ${cell(row.memeName)} | ${cell(row.lines?.join(" / "))} | ${scores.join(" | ")} | ${cell(row.error)} |`,
		);
	}
	const scored = run.rows.filter((row) => row.verdict);
	if (scored.length) {
		lines.push("", "## Reasons", "");
		for (const row of scored) {
			lines.push(`### ${row.prompt}`, "");
			for (const dimension of DIMENSIONS)
				lines.push(
					`- ${dimension} ${row.verdict![dimension].score}: ${row.verdict![dimension].reason}`,
				);
			lines.push("");
		}
	}
	return `${lines.join("\n")}\n`;
}
