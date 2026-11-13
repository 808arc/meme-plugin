/** Reuse of earlier memes for the same concept, and the single rating store for
 * generated memes. Everything stays in plugin data (`data/generated-memes.json`):
 * finished memes are kept under their normalized concept key, and a repeat question
 * may get one of them back instead of a paid generation. Reuse is capped at a share
 * of each concept's picks so a learner does not see the same meme again and again.
 *
 * Rating API (stable; used by the rating button, #8, and the library, #19):
 *   rateGenerated(dataDirectory, id, rating): boolean
 *     Set (`"up"` / `"down"`) or clear (`null`) the rating of the generated meme whose
 *     `GeneratedMeme.generatedId` is `id`. Returns false when the id is unknown
 *     (never stored, or evicted).
 *   readRating(dataDirectory, id): Rating | null | undefined
 *     The rating, null when unrated, undefined when the id is unknown. */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REUSE } from "./config.ts";
import type { GeneratedMeme } from "./types.ts";

export const GENERATED_FILE = "generated-memes.json";
const VERSION = 1;

export type Rating = "up" | "down";

/** A finished meme without the question it answered (the key stands for it). */
export type StoredMeme = Omit<
	GeneratedMeme,
	"concept" | "generatedId" | "reused"
>;

export interface CachedMeme {
	/** Returned to the page as `GeneratedMeme.generatedId`; the handle for ratings. */
	id: string;
	createdAt: number;
	/** Null until a learner rates the meme. */
	rating: Rating | null;
	meme: StoredMeme;
}

export interface ConceptRecord {
	/** Picks for this concept that were generated new. */
	fresh: number;
	/** Picks for this concept that reused an earlier generation. */
	reused: number;
	memes: CachedMeme[];
}

export interface GeneratedStore {
	version: number;
	concepts: Record<string, ConceptRecord>;
}

/** Normalized concept key: case, accents, punctuation and spacing are ignored, so
 * "Who backed CUDA?" and "who  backed cuda" share one key. Words are kept as they are. */
export function conceptKey(prompt: string): string {
	const text = prompt
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
	return createHash("sha256").update(text).digest("hex");
}

const count = (value: unknown) =>
	Number.isInteger(value) && (value as number) >= 0 ? (value as number) : 0;

/** Missing file: empty. Unknown format: throws, so a newer build's data is never overwritten. */
export function readGenerated(dataDirectory: string): GeneratedStore {
	let raw: unknown;
	try {
		raw = JSON.parse(
			fs.readFileSync(path.join(dataDirectory, GENERATED_FILE), "utf8"),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return { version: VERSION, concepts: {} };
		throw new Error(
			`Meme plugin could not read ${GENERATED_FILE}: ${(error as Error).message}`,
		);
	}
	const stored = (
		raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
	) as Partial<GeneratedStore>;
	if (stored.version !== VERSION)
		throw new Error(
			`Meme plugin generated memes have format ${String(stored.version)}; this version reads format ${VERSION}.`,
		);
	const concepts: Record<string, ConceptRecord> = {};
	for (const [key, value] of Object.entries(stored.concepts ?? {})) {
		const record = (value ?? {}) as Partial<ConceptRecord>;
		const memes = (Array.isArray(record.memes) ? record.memes : []).flatMap(
			(item): CachedMeme[] => {
				const entry = item as Partial<CachedMeme> | null;
				if (!entry || typeof entry.id !== "string" || !entry.meme?.meme)
					return [];
				return [
					{
						id: entry.id,
						createdAt: Number.isFinite(entry.createdAt)
							? (entry.createdAt as number)
							: 0,
						rating:
							entry.rating === "up" || entry.rating === "down"
								? entry.rating
								: null,
						meme: entry.meme,
					},
				];
			},
		);
		concepts[key] = {
			fresh: count(record.fresh),
			reused: count(record.reused),
			memes,
		};
	}
	return { version: VERSION, concepts };
}

export function writeGenerated(dataDirectory: string, store: GeneratedStore) {
	fs.mkdirSync(dataDirectory, { recursive: true });
	const file = path.join(dataDirectory, GENERATED_FILE);
	const temporary = path.join(dataDirectory, `.generated-${randomUUID()}.tmp`);
	try {
		fs.writeFileSync(temporary, `${JSON.stringify(store, null, "\t")}\n`, {
			flag: "wx",
			mode: 0o600,
		});
		fs.renameSync(temporary, file);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

/** True when the concept has had its first fresh picks and one more reuse keeps its
 * reuses within the share of its picks, counting this one. */
export function mayReuse(
	record: Pick<ConceptRecord, "fresh" | "reused"> | undefined,
	config: Pick<typeof REUSE, "share" | "freshFirst"> = REUSE,
): boolean {
	if (!record || record.fresh < config.freshFirst) return false;
	return record.reused + 1 <= config.share * (record.fresh + record.reused + 1);
}

/** Choose an earlier meme for the concept: never a down-rated one, never the meme the
 * learner asked to replace, never one that has left the pool. Up-rated memes win over
 * unrated ones. */
export function chooseReuse(
	entries: readonly CachedMeme[],
	pool: ReadonlySet<string>,
	exclude: string | undefined,
	random: () => number = Math.random,
): CachedMeme | undefined {
	const usable = entries.filter(
		(entry) =>
			entry.rating !== "down" &&
			entry.meme.meme.id !== exclude &&
			pool.has(entry.meme.meme.id),
	);
	const liked = usable.filter((entry) => entry.rating === "up");
	const list = liked.length ? liked : usable;
	if (!list.length) return undefined;
	return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

const rank = (rating: Rating | null) =>
	rating === "down" ? 0 : rating === null ? 1 : 2;

/** A fresh generation: counted, and kept for later reuse under its concept. Over the
 * cap, the lowest-rated, then oldest, earlier memes are dropped; never the new one. */
export function recordFresh(
	store: GeneratedStore,
	key: string,
	entry: CachedMeme,
	maxPerConcept: number = REUSE.maxPerConcept,
): GeneratedStore {
	const record = store.concepts[key] ?? { fresh: 0, reused: 0, memes: [] };
	const kept = [...record.memes]
		.sort(
			(a, b) => rank(b.rating) - rank(a.rating) || b.createdAt - a.createdAt,
		)
		.slice(0, Math.max(0, maxPerConcept - 1));
	return {
		...store,
		concepts: {
			...store.concepts,
			[key]: { ...record, fresh: record.fresh + 1, memes: [entry, ...kept] },
		},
	};
}

export function recordReuse(
	store: GeneratedStore,
	key: string,
): GeneratedStore {
	const record = store.concepts[key] ?? { fresh: 0, reused: 0, memes: [] };
	return {
		...store,
		concepts: {
			...store.concepts,
			[key]: { ...record, reused: record.reused + 1 },
		},
	};
}

/** A new store entry for a finished meme. */
export function newEntry(meme: StoredMeme, now: number): CachedMeme {
	return { id: randomUUID(), createdAt: now, rating: null, meme };
}

/** Rating API, see the file header. */
export function rateGenerated(
	dataDirectory: string,
	id: string,
	rating: Rating | null,
): boolean {
	if (rating !== null && rating !== "up" && rating !== "down")
		throw new Error('A rating is "up", "down" or null.');
	const store = readGenerated(dataDirectory);
	for (const record of Object.values(store.concepts)) {
		const entry = record.memes.find((candidate) => candidate.id === id);
		if (!entry) continue;
		entry.rating = rating;
		writeGenerated(dataDirectory, store);
		return true;
	}
	return false;
}

/** Rating API, see the file header. */
export function readRating(
	dataDirectory: string,
	id: string,
): Rating | null | undefined {
	for (const record of Object.values(readGenerated(dataDirectory).concepts)) {
		const entry = record.memes.find((candidate) => candidate.id === id);
		if (entry) return entry.rating;
	}
	return undefined;
}
