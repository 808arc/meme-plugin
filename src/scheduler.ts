/** Reverse spaced repetition: a used meme is kept away, and the more often it has
 * been used the longer it stays away. Pure functions; the backend owns storage. */
import type { Settings, Usage } from "./types.ts";

const DAY = 24 * 60 * 60 * 1000;
export const MAX_COOLDOWN_DAYS = 365;

/** Cooldown after the nth use: base, base x growth, base x growth^2, ... capped at a year. */
export function cooldownMs(
	uses: number,
	settings: Pick<Settings, "cooldownDays" | "cooldownGrowth">,
): number {
	if (settings.cooldownDays <= 0 || uses <= 0) return 0;
	const days =
		settings.cooldownDays * Math.max(1, settings.cooldownGrowth) ** (uses - 1);
	return Math.min(MAX_COOLDOWN_DAYS, days) * DAY;
}

export function recordUse(
	previous: Usage | undefined,
	now: number,
	settings: Pick<Settings, "cooldownDays" | "cooldownGrowth">,
): Usage {
	const uses = (previous?.uses ?? 0) + 1;
	return { uses, lastUsedAt: now, dueAt: now + cooldownMs(uses, settings) };
}

export function coolingDown(
	usage: Readonly<Record<string, Usage>>,
	id: string,
	now: number,
): boolean {
	const entry = usage[id];
	return !!entry && entry.dueAt > now;
}

/** Up to `limit` memes for the model to choose from: the ones not cooling down, in
 * random order. When the whole pool is cooling down, the ones due soonest (as pickMeme). */
export function shortlist(
	ids: readonly string[],
	usage: Readonly<Record<string, Usage>>,
	now: number,
	limit: number,
	random: () => number = Math.random,
): string[] {
	if (!ids.length) return [];
	let pool = ids.filter((id) => !coolingDown(usage, id, now));
	if (!pool.length) {
		const soonest = Math.min(...ids.map((id) => usage[id]!.dueAt));
		pool = ids.filter((id) => usage[id]!.dueAt === soonest);
	}
	const chosen = [...pool];
	for (let i = 0; i < chosen.length - 1 && i < limit; i++) {
		const j = i + Math.floor(random() * (chosen.length - i));
		[chosen[i], chosen[j]] = [chosen[j]!, chosen[i]!];
	}
	return chosen.slice(0, limit);
}

/** A uniformly random meme that is not cooling down. When the whole pool is cooling
 * down, the one that becomes eligible soonest: the pool never runs dry. */
export function pickMeme(
	ids: readonly string[],
	usage: Readonly<Record<string, Usage>>,
	now: number,
	random: () => number = Math.random,
): string | undefined {
	if (!ids.length) return undefined;
	const at = (list: readonly string[]) =>
		list[Math.min(list.length - 1, Math.floor(random() * list.length))];
	const eligible = ids.filter((id) => !coolingDown(usage, id, now));
	if (eligible.length) return at(eligible);
	const soonest = Math.min(...ids.map((id) => usage[id]!.dueAt));
	return at(ids.filter((id) => usage[id]!.dueAt === soonest));
}
