/** Reuse of earlier memes for the same concept. Everything stays in plugin data:
 * finished memes are kept under their normalized concept key, and a repeat question
 * may get one of them back instead of a paid generation. Reuse is capped at a share of
 * all picks so a learner does not see the same meme again and again. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GeneratedMeme } from "./types.ts";

export const GENERATED_FILE = "generated-memes.json";
const VERSION = 1;
/** Largest share of meme picks that may reuse an earlier generation. */
export const REUSE_SHARE = 0.2;
/** Earlier generations kept for one concept; the oldest are dropped first. */
export const MAX_PER_CONCEPT = 5;

/** A finished meme without the question it answered (the key stands for it). */
export type StoredMeme = Omit<GeneratedMeme, "concept">;

export interface CachedMeme {
	key: string;
	createdAt: number;
	/** Written by the rating feature (#19). Null until a learner rates the meme. */
	rating: "up" | "down" | null;
	meme: StoredMeme;
}

export interface GeneratedStore {
	version: number;
	/** Picks that were generated new. */
	fresh: number;
	/** Picks that reused an earlier generation. */
	reused: number;
	entries: Record<string, CachedMeme[]>;
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

function emptyStore(): GeneratedStore {
	return { version: VERSION, fresh: 0, reused: 0, entries: {} };
}

/** Missing file: empty. Unknown format: throws, so a newer build's data is never overwritten. */
export function readGenerated(dataDirectory: string): GeneratedStore {
	let raw: unknown;
	try {
		raw = JSON.parse(
			fs.readFileSync(path.join(dataDirectory, GENERATED_FILE), "utf8"),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
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
	const entries: Record<string, CachedMeme[]> = {};
	for (const [key, list] of Object.entries(stored.entries ?? {})) {
		if (!Array.isArray(list)) continue;
		entries[key] = list.flatMap((item): CachedMeme[] => {
			const entry = item as Partial<CachedMeme> | null;
			if (!entry || typeof entry.key !== "string" || !entry.meme) return [];
			return [
				{
					key,
					createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt! : 0,
					rating:
						entry.rating === "up" || entry.rating === "down"
							? entry.rating
							: null,
					meme: entry.meme,
				},
			];
		});
	}
	return {
		version: VERSION,
		fresh: Number.isInteger(stored.fresh) ? stored.fresh! : 0,
		reused: Number.isInteger(stored.reused) ? stored.reused! : 0,
		entries,
	};
}

export function writeGenerated(dataDirectory: string, store: GeneratedStore) {
	fs.mkdirSync(dataDirectory, { recursive: true });
	const file = path.join(dataDirectory, GENERATED_FILE);
	const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(store, null, "\t") + "\n", {
			flag: "wx",
			mode: 0o600,
		});
		fs.renameSync(temporary, file);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

/** True when one more reuse keeps reuses within `share` of all picks, counting this one. */
export function mayReuse(
	store: Pick<GeneratedStore, "fresh" | "reused">,
	share = REUSE_SHARE,
): boolean {
	return store.reused + 1 <= share * (store.fresh + store.reused + 1);
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

/** A fresh generation: counted, and kept for later reuse under its concept. */
export function recordFresh(
	store: GeneratedStore,
	key: string,
	meme: StoredMeme,
	now: number,
): GeneratedStore {
	const entry: CachedMeme = { key, createdAt: now, rating: null, meme };
	const list = [entry, ...(store.entries[key] ?? [])].slice(0, MAX_PER_CONCEPT);
	return {
		...store,
		fresh: store.fresh + 1,
		entries: { ...store.entries, [key]: list },
	};
}

export function recordReuse(store: GeneratedStore): GeneratedStore {
	return { ...store, reused: store.reused + 1 };
}
