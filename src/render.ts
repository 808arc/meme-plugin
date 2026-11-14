/** Draws a generated meme with plain DOM: the blank image with caption boxes laid
 * over it. All model text is inserted with textContent, never as markup. */
import type { Box, GeneratedMeme, MemeImage } from "./types.ts";

const FONTS: Record<Box["font"], string> = {
	thick:
		'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Black", sans-serif',
	thin: "Arial, Helvetica, sans-serif",
	comic: '"Comic Sans MS", "Comic Neue", cursive, sans-serif',
};

export function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function styled(text: string, style: Box["style"]): string {
	if (style === "upper") return text.toUpperCase();
	if (style === "lower") return text.toLowerCase();
	return text;
}

/** Largest font size at which the text stays inside its box. */
function fit(box: HTMLElement, text: HTMLElement, largest: number): void {
	let low = 6,
		high = Math.max(low, largest);
	for (let step = 0; step < 10; step++) {
		const size = (low + high) / 2;
		text.style.fontSize = `${size}px`;
		if (
			text.scrollHeight <= box.clientHeight + 1 &&
			text.scrollWidth <= box.clientWidth + 1
		)
			low = size;
		else high = size;
	}
	text.style.fontSize = `${low}px`;
}

/** Mount the meme into `container`; returns cleanup. Without an image the caption
 * is shown as a plain stacked card so the meme still reads. */
export function mountMeme(
	container: HTMLElement,
	result: GeneratedMeme,
	image: MemeImage | null,
): () => void {
	const figure = element("figure", "meme-figure");
	const stage = element(
		"div",
		image ? "meme-stage" : "meme-stage meme-stage-text",
	);
	figure.append(stage);
	container.append(figure);
	const cleanup: (() => void)[] = [() => figure.remove()];

	if (!image) {
		for (const line of result.lines)
			if (line) stage.append(element("p", "meme-line", line));
		return () => cleanup.forEach((run) => run());
	}

	const picture = element("img", "meme-image");
	picture.alt = `${result.meme.name} meme`;
	picture.src = `data:${image.mimeType};base64,${image.data}`;
	stage.append(picture);
	const boxes: { box: HTMLElement; text: HTMLElement; angled: boolean }[] = [];
	result.lines.forEach((line, index) => {
		const spec = result.meme.boxes[index];
		if (!line || !spec) return;
		const box = element("div", "meme-box");
		box.style.left = `${spec.x * 100}%`;
		box.style.top = `${spec.y * 100}%`;
		box.style.width = `${spec.w * 100}%`;
		box.style.height = `${spec.h * 100}%`;
		if (spec.angle) box.style.transform = `rotate(${-spec.angle}deg)`;
		const text = element(
			"div",
			spec.color === "black"
				? "meme-text meme-text-dark"
				: "meme-text",
			styled(line, spec.style),
		);
		text.style.fontFamily = FONTS[spec.font];
		text.style.textAlign = spec.align;
		// Assigning through the style API drops anything that is not a valid color.
		text.style.color = spec.color;
		box.append(text);
		stage.append(box);
		boxes.push({ box, text, angled: spec.angle !== 0 });
	});
	// Same ceiling memegen uses: a ninth of the image height, a quarter for angled boxes.
	const layout = () => {
		for (const item of boxes)
			fit(item.box, item.text, stage.clientHeight / (item.angled ? 4 : 9));
	};
	picture.addEventListener("load", layout);
	cleanup.push(() => picture.removeEventListener("load", layout));
	if (typeof ResizeObserver !== "undefined") {
		const observer = new ResizeObserver(layout);
		observer.observe(stage);
		cleanup.push(() => observer.disconnect());
	}
	if (picture.complete) layout();
	return () => cleanup.forEach((run) => run());
}

/** Composites the blank image and the caption lines into one PNG, for "Copy image".
 * Mirrors the on-screen boxes; the caption is drawn, never read from the DOM. */
export async function memePng(
	result: GeneratedMeme,
	image: MemeImage,
): Promise<Blob> {
	const picture = new Image();
	picture.src = `data:${image.mimeType};base64,${image.data}`;
	await picture.decode();
	const width = picture.naturalWidth,
		height = picture.naturalHeight;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Image copy is not available here.");
	context.drawImage(picture, 0, 0, width, height);
	result.lines.forEach((line, index) => {
		const spec = result.meme.boxes[index];
		if (!line || !spec) return;
		const boxWidth = spec.w * width,
			boxHeight = spec.h * height;
		const text = styled(line, spec.style);
		// Largest size that fits the box height and width, as the on-screen fit does.
		let size = Math.min(boxHeight * 0.9, height / (spec.angle ? 4 : 9));
		context.font = `${spec.color === "black" ? 400 : 700} ${size}px ${FONTS[spec.font]}`;
		while (size > 6 && context.measureText(text).width > boxWidth) {
			size -= 1;
			context.font = `${spec.color === "black" ? 400 : 700} ${size}px ${FONTS[spec.font]}`;
		}
		const pad = boxWidth * 0.04;
		const anchorX =
			spec.align === "left"
				? spec.x * width + pad
				: spec.align === "right"
					? (spec.x + spec.w) * width - pad
					: (spec.x + spec.w / 2) * width;
		context.save();
		context.translate(anchorX, (spec.y + spec.h / 2) * height);
		if (spec.angle) context.rotate((-spec.angle * Math.PI) / 180);
		context.textAlign = spec.align;
		context.textBaseline = "middle";
		context.fillStyle = spec.color;
		if (spec.color !== "black") {
			context.strokeStyle = "#000";
			context.lineWidth = size * 0.08;
			context.lineJoin = "round";
			context.strokeText(text, 0, 0);
		}
		context.fillText(text, 0, 0);
		context.restore();
	});
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("Could not make the image.")),
			"image/png",
		),
	);
}
