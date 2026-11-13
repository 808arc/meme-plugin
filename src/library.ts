/** Step 2 of the README, first half: the pool of memes to pick from.
 * Bundled memegen metadata plus the learner's own memes in plugin data. */
import fs from "node:fs";
import path from "node:path";
import catalogue from "./data/memegen-templates.json" with { type: "json" };
import {
	hiddenByDefault,
	isDated,
	type TemplateTags,
} from "./catalogue-tags.ts";
import type { Box, Meme } from "./types.ts";

export const CUSTOM_FILE = "custom-memes.json";
export const CUSTOM_IMAGES = "custom-images";
export const IMAGE_FILE =
	/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:png|jpe?g|webp|gif)$/i;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_LINES = 8;
const MAX_LINE_LENGTH = 400;

const BOX: Box = {
	x: 0,
	y: 0,
	w: 1,
	h: 0.2,
	angle: 0,
	color: "white",
	style: "upper",
	font: "thick",
	align: "center",
};

/** Where caption lines go when a custom meme does not say: one line is a subtitle,
 * two are the classic top/bottom, more are stacked evenly. */
export function defaultBoxes(count: number): Box[] {
	if (count === 1)
		return [{ ...BOX, x: 0.04, y: 0.74, w: 0.92, h: 0.24, style: "none" }];
	if (count === 2) return [{ ...BOX }, { ...BOX, y: 0.8 }];
	const height = 1 / count;
	return Array.from({ length: count }, (_, index) => ({
		...BOX,
		y: index * height,
		h: height * 0.9,
	}));
}

/** Templates hidden by CATALOGUE_TAGS (today: weak ones) are left out unless `includeHidden` is set. */
export function memegenMemes(
	imageBaseUrl: string,
	{ includeHidden = false }: { includeHidden?: boolean } = {},
): Meme[] {
	return catalogue.templates
		.filter(
			(template) =>
				includeHidden ||
				!hiddenByDefault(template.tags as TemplateTags | undefined),
		)
		.map((template) => ({
			id: `memegen:${template.id}`,
			origin: "memegen" as const,
			name: template.name,
			...(template.source ? { source: template.source } : {}),
			image: imageBaseUrl ? `${imageBaseUrl}/images/${template.id}.jpg` : "",
			caption: template.caption,
			boxes: template.boxes as Box[],
			...(isDated(template.tags as TemplateTags | undefined)
				? { dated: true as const }
				: {}),
		}));
}

const fraction = (value: unknown, fallback: number) =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	value >= 0 &&
	value <= 1
		? value
		: fallback;
const choice = <T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);

function customBox(value: unknown, fallback: Box): Box {
	const box = (value && typeof value === "object" ? value : {}) as Record<
		string,
		unknown
	>;
	return {
		x: fraction(box.x, fallback.x),
		y: fraction(box.y, fallback.y),
		w: fraction(box.w, fallback.w),
		h: fraction(box.h, fallback.h),
		angle:
			typeof box.angle === "number" &&
			Number.isFinite(box.angle) &&
			Math.abs(box.angle) <= 180
				? box.angle
				: fallback.angle,
		// Rendered through the DOM style API, which ignores anything that is not a color.
		color:
			typeof box.color === "string" &&
			/^[#a-zA-Z0-9(),.%\s-]{1,40}$/.test(box.color)
				? box.color
				: fallback.color,
		style: choice(
			box.style,
			["upper", "lower", "none", "default"] as const,
			fallback.style,
		),
		font: choice(box.font, ["thick", "thin", "comic"] as const, fallback.font),
		align: choice(
			box.align,
			["left", "center", "right"] as const,
			fallback.align,
		),
	};
}

function customMeme(value: unknown): Meme {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("entry must be an object");
	const entry = value as Record<string, unknown>;
	if (typeof entry.id !== "string" || !ID.test(entry.id))
		throw new Error('"id" must be lowercase letters, digits and hyphens');
	if (typeof entry.name !== "string" || !entry.name.trim())
		throw new Error('"name" is required');
	if (
		!Array.isArray(entry.caption) ||
		!entry.caption.length ||
		entry.caption.length > MAX_LINES
	)
		throw new Error(
			`"caption" must list 1 to ${MAX_LINES} lines of original text`,
		);
	const caption = entry.caption.map((line) => {
		if (typeof line !== "string" || line.length > MAX_LINE_LENGTH)
			throw new Error(
				`each caption line must be text of at most ${MAX_LINE_LENGTH} characters`,
			);
		return line.replace(/\s+/g, " ").trim();
	});
	if (!caption.some(Boolean))
		throw new Error('"caption" needs at least one non-empty line');
	const image = entry.image === undefined ? "" : entry.image;
	if (
		typeof image !== "string" ||
		(image && !IMAGE_FILE.test(image) && !/^https?:\/\/[^\s]+$/.test(image))
	)
		throw new Error(
			`"image" must be an http(s) address or a file name in ${CUSTOM_IMAGES}/`,
		);
	if (
		entry.boxes !== undefined &&
		(!Array.isArray(entry.boxes) || entry.boxes.length !== caption.length)
	)
		throw new Error('"boxes" must have one entry per caption line');
	if (
		entry.source !== undefined &&
		(typeof entry.source !== "string" ||
			!/^https?:\/\/[^\s]+$/.test(entry.source))
	)
		throw new Error('"source" must be an http(s) address');
	const fallback = defaultBoxes(caption.length);
	return {
		id: `custom:${entry.id}`,
		origin: "custom",
		name: entry.name.trim(),
		...(typeof entry.source === "string" ? { source: entry.source } : {}),
		image,
		caption,
		boxes: fallback.map((box, index) =>
			customBox((entry.boxes as unknown[] | undefined)?.[index], box),
		),
	};
}

/** Read `<data>/custom-memes.json`. Bad entries are skipped and reported, never fatal. */
export function loadCustomMemes(dataDirectory: string): {
	memes: Meme[];
	problems: string[];
} {
	let text: string;
	try {
		text = fs.readFileSync(path.join(dataDirectory, CUSTOM_FILE), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return { memes: [], problems: [] };
		return {
			memes: [],
			problems: [`${CUSTOM_FILE}: ${(error as Error).message}`],
		};
	}
	let list: unknown;
	try {
		list = JSON.parse(text);
	} catch (error) {
		return {
			memes: [],
			problems: [
				`${CUSTOM_FILE} is not valid JSON: ${(error as Error).message}`,
			],
		};
	}
	if (!Array.isArray(list))
		return {
			memes: [],
			problems: [`${CUSTOM_FILE} must contain a JSON array of memes`],
		};
	const memes: Meme[] = [],
		problems: string[] = [];
	list.forEach((entry, index) => {
		try {
			const meme = customMeme(entry);
			if (memes.some((other) => other.id === meme.id))
				throw new Error(`duplicate id "${meme.id.slice("custom:".length)}"`);
			memes.push(meme);
		} catch (error) {
			problems.push(
				`${CUSTOM_FILE} entry ${index + 1}: ${(error as Error).message}`,
			);
		}
	});
	return { memes, problems };
}
