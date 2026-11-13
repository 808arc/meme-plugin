/** Blank meme images. Fetched by the backend so the page needs no remote image
 * access, and cached in plugin data so each image is requested from the network once.
 * Only the image address leaves the machine: never the concept or the caption. */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CUSTOM_IMAGES, IMAGE_FILE } from "./library.ts";
import type { Meme, MemeImage } from "./types.ts";

export const IMAGE_CACHE = "image-cache";
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/** Decide the type from the bytes, not from a header or a file name. */
export function sniff(bytes: Uint8Array): string | undefined {
	const starts = (...signature: number[]) =>
		signature.every((byte, index) => bytes[index] === byte);
	if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
	if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
	if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
	if (
		starts(0x52, 0x49, 0x46, 0x46) &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	)
		return "image/webp";
	return undefined;
}

function encode(bytes: Buffer): MemeImage {
	const mimeType = sniff(bytes);
	if (!mimeType)
		throw new Error("The file is not a PNG, JPEG, GIF or WebP image");
	return { mimeType, data: bytes.toString("base64") };
}

function readBounded(file: string): Buffer {
	const stat = fs.lstatSync(file);
	if (!stat.isFile()) throw new Error("Not a regular file");
	if (stat.size > MAX_BYTES) throw new Error("Image is larger than 8 MiB");
	return fs.readFileSync(file);
}

async function download(url: string, signal: AbortSignal): Promise<Buffer> {
	const response = await fetch(url, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
		redirect: "follow",
	});
	if (!response.ok)
		throw new Error(`Image request failed (${response.status})`);
	const declared = Number(response.headers.get("content-length"));
	if (declared > MAX_BYTES) throw new Error("Image is larger than 8 MiB");
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.length > MAX_BYTES) throw new Error("Image is larger than 8 MiB");
	return bytes;
}

/** `customDirectory` holds custom-images/ (#21: may be outside data/, only read). */
export async function loadImage(
	meme: Pick<Meme, "image" | "origin">,
	dataDirectory: string,
	signal: AbortSignal,
	customDirectory: string = dataDirectory,
): Promise<MemeImage | null> {
	if (!meme.image) return null;
	if (!/^https?:\/\//.test(meme.image)) {
		// The library only admits bare file names here; recheck before touching the disk.
		if (meme.origin !== "custom" || !IMAGE_FILE.test(meme.image))
			throw new Error("Unsupported image location");
		return encode(
			readBounded(path.join(customDirectory, CUSTOM_IMAGES, meme.image)),
		);
	}
	const cache = path.join(dataDirectory, IMAGE_CACHE);
	const file = path.join(
		cache,
		createHash("sha256").update(meme.image).digest("hex").slice(0, 32),
	);
	try {
		return encode(readBounded(file));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			fs.rmSync(file, { force: true });
	}
	const bytes = await download(meme.image, signal);
	const image = encode(bytes);
	if (signal.aborted) throw new Error("Meme plugin is disabled.");
	fs.mkdirSync(cache, { recursive: true });
	const temporary = path.join(cache, `.${randomUUID()}.tmp`);
	try {
		fs.writeFileSync(temporary, bytes, { flag: "wx" });
		fs.renameSync(temporary, file);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
	return image;
}
