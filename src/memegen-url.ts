/** Rendered meme addresses on a memegen server, as in the Vellum meme-generator skill
 * (MIT, github.com/vellum-ai/vellum-assistant, skills/meme-generator): every meme is a
 * URL, {server}/images/{template}/{line 1}/{line 2}.png, and the server draws the text.
 * Sending this address sends the caption lines to the image server. */

/** One caption line as a memegen path segment. Underscores and dashes are doubled
 * before spaces become underscores, because memegen reads `_` and `-` as spaces.
 * Unlike the skill's script, "!" stays as is: memegen has no `~e` escape and would
 * draw it literally. An empty line is `_`, which memegen draws as nothing. */
export function encodeLine(line: string): string {
	if (!line.trim()) return "_";
	const escaped = line
		.trim()
		.replace(/_/g, "__")
		.replace(/-/g, "--")
		.replace(/\s+/g, "_")
		// memegen has no escape for "~", and "~q" would become "?": draw a dash instead.
		.replace(/~/g, "-")
		.replace(/\?/g, "~q")
		.replace(/&/g, "~a")
		.replace(/%/g, "~p")
		.replace(/#/g, "~h")
		.replace(/\//g, "~s")
		.replace(/\\/g, "~b")
		.replace(/</g, "~l")
		.replace(/>/g, "~g")
		.replace(/"/g, "''");
	// Anything still unsafe in a path (accents, emoji) is percent-encoded; the escapes
	// above use only characters encodeURIComponent leaves alone.
	return encodeURIComponent(escaped);
}

/** The memegen template id behind a catalogue meme id (`memegen:drake` → `drake`). */
export function templateId(memeId: string): string | undefined {
	const match = /^memegen:([a-z0-9][a-z0-9_-]*)$/i.exec(memeId);
	return match?.[1];
}

/** The address of the finished meme on `server`; undefined when it cannot be drawn
 * there (no server, not a catalogue meme, or a line count the template does not have). */
export function renderedImageUrl(
	server: string,
	memeId: string,
	lines: readonly string[],
	boxes: number,
): string | undefined {
	const id = templateId(memeId);
	if (!server || !id || lines.length !== boxes || !lines.some((l) => l.trim()))
		return undefined;
	return `${server.replace(/\/+$/, "")}/images/${id}/${lines.map(encodeLine).join("/")}.png`;
}
