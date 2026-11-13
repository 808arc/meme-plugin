/** Refresh the bundled meme catalogue from a local memegen checkout.
 *
 * memegen (https://github.com/jacebrowning/memegen, MIT) keeps one config.yml per
 * template: name, source link, an example caption and the text boxes that caption
 * is drawn into. Only that metadata is copied here. No images are bundled; the
 * plugin fetches each blank image at run time.
 *
 *   git clone --depth 1 --filter=blob:none --no-checkout https://github.com/jacebrowning/memegen.git
 *   cd memegen && git sparse-checkout set --no-cone '/templates/*\/config.yml' && git checkout && cd ..
 *   npm run sync:memegen -- ./memegen
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const checkout = process.argv[2];
if (!checkout) {
	console.error('Usage: npm run sync:memegen -- "<path-to-memegen-checkout>"');
	process.exit(1);
}
const templatesDirectory = path.join(path.resolve(checkout), "templates");
const number = (value, fallback) =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value) => Math.min(1, Math.max(0, value));

// Tags are hand-made (src/catalogue-tags.ts), so keep the ones already in the file by id.
const output = path.join(root, "src", "data", "memegen-templates.json");
const previousTags = new Map();
if (fs.existsSync(output)) {
	for (const previous of JSON.parse(fs.readFileSync(output, "utf8")).templates)
		if (previous.tags) previousTags.set(previous.id, previous.tags);
}
const templates = [];
const skipped = [];
let untagged = 0;
for (const id of fs.readdirSync(templatesDirectory).sort()) {
	// Underscore folders are memegen's own error/test fixtures.
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
		skipped.push(`${id}: not a template id`);
		continue;
	}
	const file = path.join(templatesDirectory, id, "config.yml");
	if (!fs.existsSync(file)) {
		skipped.push(`${id}: no config.yml`);
		continue;
	}
	const config = parse(fs.readFileSync(file, "utf8"));
	const text = Array.isArray(config?.text) ? config.text : [];
	const example = Array.isArray(config?.example)
		? config.example.map((line) =>
				typeof line === "string" ? line.trim() : "",
			)
		: [];
	const caption = example
		.slice(0, text.length)
		.map((line) => (line === "_" ? "" : line));
	if (!caption.some(Boolean)) {
		skipped.push(`${id}: no example caption`);
		continue;
	}
	// A caption line that is only shown for part of an animation still reads fine on a still image.
	const boxes = caption.map((_, index) => {
		const box = text[index] ?? {};
		return {
			x: clamp(number(box.anchor_x, 0)),
			y: clamp(number(box.anchor_y, 0)),
			w: clamp(number(box.scale_x, 1)),
			h: clamp(number(box.scale_y, 0.2)),
			angle: number(box.angle, 0),
			color: typeof box.color === "string" ? box.color : "white",
			style: ["upper", "lower", "none", "default"].includes(box.style)
				? box.style
				: "none",
			font: ["thick", "thin", "comic"].includes(box.font) ? box.font : "thick",
			align: ["left", "center", "right"].includes(box.align)
				? box.align
				: "center",
		};
	});
	const tags = previousTags.get(id);
	if (!tags) untagged++;
	templates.push({
		id,
		name:
			typeof config.name === "string" && config.name.trim()
				? config.name.trim()
				: id,
		...(typeof config.source === "string" && /^https?:\/\//.test(config.source)
			? { source: config.source }
			: {}),
		caption,
		boxes,
		...(tags ? { tags } : {}),
	});
}

let commit = "unknown";
try {
	commit = execFileSync(
		"git",
		["-C", path.resolve(checkout), "rev-parse", "HEAD"],
		{ encoding: "utf8" },
	).trim();
} catch {
	/* not a git checkout */
}
fs.writeFileSync(
	output,
	JSON.stringify(
		{
			origin: "https://github.com/jacebrowning/memegen",
			license: "MIT",
			commit,
			templates,
		},
		null,
		"\t",
	) + "\n",
);
console.log(`[sync-memegen] ${templates.length} templates -> ${output}`);
if (untagged)
	console.log(
		`[sync-memegen] ${untagged} untagged (new) templates: they stay in the pool until tagged`,
	);
if (skipped.length)
	console.log(
		`[sync-memegen] skipped ${skipped.length}: ${skipped.join("; ")}`,
	);
