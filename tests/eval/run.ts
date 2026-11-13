/** Run the meme eval against live models. Not part of `npm test`.
 *
 *   EVAL_MODEL=/abs/path/to/adapter.ts npm run eval -- [--limit 5] [--out tests/eval/reports] [--data <plugin data dir>]
 *
 * The pool is the bundled memegen catalogue plus custom memes from --data (the plugin's
 * data directory, which holds custom-memes.json), so the run uses what the learner sees.
 *
 * The adapter is a module with a default export:
 *   export default {
 *     generatorLabel: "provider/model",   // the model that writes memes (the plugin's cheap model)
 *     judgeLabel: "provider/model",       // the stronger model that scores them
 *     generate: async (request: { systemPrompt: string; user: string }) => string,
 *     judge: async (request: { systemPrompt: string; user: string }) => string,
 *   };
 * Each function sends the system prompt and user text to its model and returns the
 * reply text. Keep API keys in the adapter's environment, never in this repo.
 *
 * Writes <out>/<timestamp>.md (report) and <out>/<timestamp>.json (raw run, for diffing). */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadCustomMemes, memegenMemes } from "../../src/library.ts";
import { EVAL_CONCEPTS } from "./concepts.ts";
import {
	type Complete,
	eligibleMemes,
	formatReport,
	runEval,
} from "./harness.ts";

interface Adapter {
	generatorLabel: string;
	judgeLabel: string;
	generate: Complete;
	judge: Complete;
}

function option(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
	const adapterPath = process.env.EVAL_MODEL;
	if (!adapterPath) {
		console.error(
			"Set EVAL_MODEL to the absolute path of a model adapter module (see the header of tests/eval/run.ts).",
		);
		process.exitCode = 1;
		return;
	}
	const adapter = (await import(pathToFileURL(path.resolve(adapterPath)).href))
		.default as Adapter;
	const dataDir = option("--data");
	const limit = Number(option("--limit") ?? EVAL_CONCEPTS.length);
	const outDir = path.resolve(option("--out") ?? "tests/eval/reports");
	const concepts = EVAL_CONCEPTS.slice(
		0,
		Number.isInteger(limit) ? limit : undefined,
	);
	const run = await runEval({
		concepts,
		memes: eligibleMemes([
			...(dataDir ? loadCustomMemes(path.resolve(dataDir)).memes : []),
			...memegenMemes(""),
		]),
		generate: adapter.generate,
		judge: adapter.judge,
		generatorLabel: adapter.generatorLabel,
		judgeLabel: adapter.judgeLabel,
	});
	fs.mkdirSync(outDir, { recursive: true });
	const stamp = run.startedAt.replace(/[:.]/g, "-");
	const markdown = path.join(outDir, `${stamp}.md`);
	const json = path.join(outDir, `${stamp}.json`);
	fs.writeFileSync(markdown, formatReport(run));
	fs.writeFileSync(json, `${JSON.stringify(run, null, "\t")}\n`);
	console.log(
		`Scored ${run.rows.length - run.errors}/${run.rows.length} concepts. Means: fit ${run.means.fit ?? "n/a"}, humor ${run.means.humor ?? "n/a"}, accuracy ${run.means.accuracy ?? "n/a"}.`,
	);
	console.log(`Report: ${markdown}\nRaw: ${json}`);
}

await main();
