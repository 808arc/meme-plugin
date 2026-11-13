/** Draws a generated meme with plain DOM: the blank image with caption boxes laid
 * over it. All model text is inserted with textContent, never as markup. */
import type { Box, GeneratedMeme, MemeImage } from "./types.ts";

const FONTS: Record<Box["font"], string> = {
	thick: 'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Black", sans-serif',
	thin: "Arial, Helvetica, sans-serif",
	comic: '"Comic Sans MS", "Comic Neue", cursive, sans-serif',
};

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
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
	let low = 6, high = Math.max(low, largest);
	for (let step = 0; step < 10; step++) {
		const size = (low + high) / 2;
		text.style.fontSize = `${size}px`;
		if (text.scrollHeight <= box.clientHeight + 1 && text.scrollWidth <= box.clientWidth + 1) low = size;
		else high = size;
	}
	text.style.fontSize = `${low}px`;
}

/** Mount the meme into `container`; returns cleanup. Without an image the caption
 * is shown as a plain stacked card so the meme still reads. */
export function mountMeme(container: HTMLElement, result: GeneratedMeme, image: MemeImage | null): () => void {
	const figure = element("figure", "meme-plugin-figure");
	const stage = element("div", image ? "meme-plugin-stage" : "meme-plugin-stage meme-plugin-stage-text");
	figure.append(stage);
	container.append(figure);
	const cleanup: (() => void)[] = [() => figure.remove()];

	if (!image) {
		for (const line of result.lines) if (line) stage.append(element("p", "meme-plugin-line", line));
		return () => cleanup.forEach((run) => run());
	}

	const picture = element("img", "meme-plugin-image");
	picture.alt = `${result.meme.name} meme`;
	picture.src = `data:${image.mimeType};base64,${image.data}`;
	stage.append(picture);
	const boxes: { box: HTMLElement; text: HTMLElement; angled: boolean }[] = [];
	result.lines.forEach((line, index) => {
		const spec = result.meme.boxes[index];
		if (!line || !spec) return;
		const box = element("div", "meme-plugin-box");
		box.style.left = `${spec.x * 100}%`;
		box.style.top = `${spec.y * 100}%`;
		box.style.width = `${spec.w * 100}%`;
		box.style.height = `${spec.h * 100}%`;
		if (spec.angle) box.style.transform = `rotate(${-spec.angle}deg)`;
		const text = element("div", spec.color === "black" ? "meme-plugin-text meme-plugin-text-dark" : "meme-plugin-text", styled(line, spec.style));
		text.style.fontFamily = FONTS[spec.font];
		text.style.textAlign = spec.align;
		// Assigning through the style API drops anything that is not a valid color.
		text.style.color = spec.color;
		box.append(text);
		stage.append(box);
		boxes.push({ box, text, angled: spec.angle !== 0 });
	});
	// Same ceiling memegen uses: a ninth of the image height, a quarter for angled boxes.
	const layout = () => { for (const item of boxes) fit(item.box, item.text, stage.clientHeight / (item.angled ? 4 : 9)); };
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
