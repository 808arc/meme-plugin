/** Window side of the meme plugin: one session action that opens a page-body
 * surface with the meme, plus the settings page. All state lives in the backend. */
import type {
	PluginFrontendContext,
	PluginSettingsRow,
	PluginSurfaceProps,
	PluginWidgetHandle,
} from "learnharness-plugin-api";
import { type ConceptResult, conceptFromView } from "./concept.ts";
import { element, memePng, mountMeme } from "./render.ts";
import { imageBaseUrlProblem, LIMITS } from "./settings.ts";
import type {
	Concept,
	GeneratedMeme,
	MemeImage,
	PluginState,
	Settings,
} from "./types.ts";

const ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/></svg>';

/** Delay before the second progress label; the backend call is a single step. */
const WRITING_STEP_DELAY_MS = 1500;

const message = (error: unknown) =>
	error instanceof Error && error.message
		? error.message
		: "Something went wrong.";

function mountSurface(
	ctx: PluginFrontendContext,
	container: HTMLElement,
	signal: AbortSignal,
	found: ConceptResult,
): () => void {
	const root = element("div", "meme-plugin-surface");
	const heading = element("h2", "meme-plugin-heading", "Meme");
	// The host focuses this marker when the surface opens.
	heading.tabIndex = -1;
	heading.setAttribute("data-plugin-initial-focus", "");
	const conceptLine = element("p", "meme-plugin-concept");
	// Collapsible: the learner can fold the picture away and keep the fact.
	const collapse = element("details", "meme-plugin-collapse");
	collapse.open = true;
	const collapseTitle = element("summary", "", "Meme image");
	const body = element("div", "meme-plugin-body");
	collapse.append(collapseTitle, body);
	const fact = element("p", "meme-plugin-fact");
	const credit = element("p", "meme-plugin-credit");
	const actions = element("div", "meme-plugin-actions");
	const anotherSlot = element("span", ""),
		copySlot = element("span", ""),
		copyImageSlot = element("span", ""),
		upSlot = element("span", ""),
		downSlot = element("span", "");
	actions.append(anotherSlot, copySlot, copyImageSlot, upSlot, downSlot);
	const notice = element("p", "meme-plugin-notice");
	root.append(heading, conceptLine, collapse, fact, credit, actions, notice);
	container.append(root);

	let concept: Concept | null = found.status === "found" ? found.concept : null;
	let result: GeneratedMeme | null = null;
	let image: MemeImage | null = null;
	let rating: "up" | "down" | null = null;
	let sequence = 0;
	let unmountMeme: (() => void) | null = null;

	const clear = () => {
		unmountMeme?.();
		unmountMeme = null;
		body.replaceChildren();
		fact.textContent = "";
		credit.replaceChildren();
	};
	const status = (text: string, failed = false) => {
		clear();
		body.append(
			element(
				"p",
				failed ? "meme-plugin-status meme-plugin-error" : "meme-plugin-status",
				text,
			),
		);
	};
	const paintRating = () => {
		up.update({ label: rating === "up" ? "👍 Liked" : "👍" });
		down.update({ label: rating === "down" ? "👎 Not for me" : "👎" });
	};
	const show = (next: GeneratedMeme, picture: MemeImage | null) => {
		clear();
		result = next;
		image = picture;
		rating = null;
		unmountMeme = mountMeme(body, next, picture);
		fact.textContent = next.fact;
		credit.append(`Meme: ${next.meme.name}`);
		if (next.meme.source && /^https?:\/\//.test(next.meme.source)) {
			const link = element("a", "", "about this meme");
			link.href = next.meme.source;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			credit.append(" · ", link);
		}
		notice.textContent = "";
		paintRating();
	};

	const run = async () => {
		if (!concept) return;
		const turn = ++sequence;
		const stale = () => signal.aborted || turn !== sequence;
		conceptLine.textContent = concept.prompt;
		another.update({ disabled: true });
		copy.update({ disabled: true });
		copyImage.update({ disabled: true });
		up.update({ disabled: true });
		down.update({ disabled: true });
		notice.textContent = "";
		status("Finding a fitting meme…");
		// The backend makes one call, so the second step is a timed label, not a
		// real stage report. It only shows if the first step is still running.
		const writing = setTimeout(() => {
			if (!stale()) status("Writing the caption…");
		}, WRITING_STEP_DELAY_MS);
		try {
			// Asking again steers away from the meme that is on screen.
			const next = await ctx.call<GeneratedMeme>("generate", {
				...concept,
				...(result ? { excludeMemeId: result.meme.id } : {}),
			});
			if (stale()) return;
			let picture: MemeImage | null = null;
			if (next.meme.hasImage) {
				// A missing image is not a failure: the caption still shows as text.
				try {
					picture = await ctx.call<MemeImage | null>("get-image", {
						id: next.meme.id,
					});
				} catch {
					picture = null;
				}
				if (stale()) return;
			}
			show(next, picture);
			another.update({ disabled: false, label: "Another meme" });
			copy.update({ disabled: false });
			copyImage.update({ disabled: !picture });
			up.update({ disabled: false });
			down.update({ disabled: false });
		} catch (error) {
			if (stale()) return;
			status(message(error), true);
			another.update({ disabled: false, label: "Try again" });
		} finally {
			clearTimeout(writing);
		}
	};

	const rate = async (value: "up" | "down") => {
		if (!result) return;
		const id = result.meme.id;
		const previous = rating;
		rating = rating === value ? null : value;
		paintRating();
		try {
			await ctx.call("rate", { id, rating });
		} catch (error) {
			if (signal.aborted || result?.meme.id !== id) return;
			rating = previous;
			paintRating();
			notice.textContent = `Rating not saved. ${message(error)}`;
		}
	};

	const another = ctx.ui.mountButton(
		anotherSlot,
		{ label: "Another meme", variant: "outline", disabled: true, onClick: run },
		{ signal },
	);
	const copy = ctx.ui.mountButton(
		copySlot,
		{
			label: "Copy caption",
			variant: "ghost",
			disabled: true,
			onClick: async () => {
				if (result)
					await navigator.clipboard.writeText(
						result.lines.filter(Boolean).join("\n"),
					);
			},
		},
		{ signal },
	);
	const copyImage = ctx.ui.mountButton(
		copyImageSlot,
		{
			label: "Copy image",
			variant: "ghost",
			disabled: true,
			onClick: async () => {
				if (!result || !image) return;
				try {
					const blob = await memePng(result, image);
					await navigator.clipboard.write([
						new ClipboardItem({ "image/png": blob }),
					]);
				} catch (error) {
					notice.textContent = `Image not copied. ${message(error)}`;
				}
			},
		},
		{ signal },
	);
	const up = ctx.ui.mountButton(
		upSlot,
		{
			label: "👍",
			variant: "ghost",
			size: "sm",
			disabled: true,
			onClick: () => rate("up"),
		},
		{ signal },
	);
	const down = ctx.ui.mountButton(
		downSlot,
		{
			label: "👎",
			variant: "ghost",
			size: "sm",
			disabled: true,
			onClick: () => rate("down"),
		},
		{ signal },
	);

	if (found.status === "hidden") {
		status("Reveal the question first. A meme would show it early.");
	} else if (found.status === "none") {
		status(
			"No question found on this page. Type the concept to turn into a meme.",
		);
		const slot = element("div", "meme-plugin-composer");
		root.insertBefore(slot, fact);
		let text = "";
		const composer = ctx.ui.mountComposer(
			slot,
			{
				value: text,
				placeholder: "Concept or question",
				autoFocus: true,
				canSend: false,
				onChange: (value) => {
					text = value;
					composer.update({ value, canSend: !!value.trim() });
				},
				onSend: () => {
					if (!text.trim()) return;
					concept = { prompt: text.trim() };
					result = null;
					return run();
				},
			},
			{ signal },
		);
	} else void run();

	return () => {
		sequence++;
		clear();
		root.remove();
	};
}

function settingsRows(
	settings: Settings,
	bundled: number,
	save: (patch: Partial<Settings>) => Promise<void>,
): PluginSettingsRow[] {
	return [
		{
			type: "toggle",
			key: "emphasis",
			label: "Add emphasis",
			description:
				"Let the meme's character repeat the key term in its own voice.",
			value: settings.emphasis,
			onChange: (emphasis) => save({ emphasis }),
		},
		{
			type: "number",
			key: "cooldownDays",
			label: "Cooldown (days)",
			description:
				"A used meme stays out of rotation this long. 0 turns the cooldown off.",
			value: settings.cooldownDays,
			...LIMITS.cooldownDays,
			step: 1,
			onChange: (cooldownDays) => save({ cooldownDays }),
		},
		{
			type: "number",
			key: "cooldownGrowth",
			label: "Cooldown growth",
			description:
				"Each further use of the same meme multiplies its cooldown by this factor.",
			value: settings.cooldownGrowth,
			...LIMITS.cooldownGrowth,
			step: 0.5,
			onChange: (cooldownGrowth) => save({ cooldownGrowth }),
		},
		{
			type: "toggle",
			key: "useMemegen",
			label: "Use the bundled catalogue",
			description: `${bundled || "About 200"} classic image memes from the open-source memegen project.`,
			value: settings.useMemegen,
			onChange: (useMemegen) => save({ useMemegen }),
		},
		{
			type: "text",
			key: "imageBaseUrl",
			label: "Image server",
			description:
				"Blank meme images are downloaded from here once, then cached. Only the meme's id is sent, never your question. Leave empty to show captions without images.",
			value: settings.imageBaseUrl,
			validate: (value) =>
				imageBaseUrlProblem(value.trim().replace(/\/+$/, "")),
			onChange: (imageBaseUrl) => save({ imageBaseUrl }),
		},
	];
}

function mountSettings(
	ctx: PluginFrontendContext,
	container: HTMLElement,
	signal: AbortSignal,
): () => void {
	const root = element("div", "meme-plugin-settings");
	const loading = element("p", "meme-plugin-settings-note", "Loading…");
	root.append(loading);
	container.append(root);

	void (async () => {
		let state: PluginState;
		try {
			state = await ctx.call<PluginState>("get-state");
		} catch (error) {
			if (!signal.aborted) loading.textContent = message(error);
			return;
		}
		if (signal.aborted) return;
		loading.remove();

		const modelRow = element("div", "meme-plugin-settings-model");
		const pickerSlot = element("span", ""),
			defaultSlot = element("span", "");
		modelRow.append(pickerSlot, defaultSlot);
		const rowsSlot = element("div", "");
		const summary = element("p", "meme-plugin-settings-note");
		const resetSlot = element("div", "");
		const problems = element("ul", "meme-plugin-settings-problems");
		root.append(
			element("p", "meme-plugin-settings-label", "Model"),
			element(
				"p",
				"meme-plugin-settings-note",
				"Writes the captions. Each meme costs one or two short requests. Default: the cheap model slot.",
			),
			modelRow,
			rowsSlot,
			summary,
			resetSlot,
			problems,
		);

		// Publish values only after the backend accepted and stored them.
		const publish = (next: PluginState) => {
			if (signal.aborted) return;
			state = next;
			picker.update({ value: state.settings.model ?? undefined });
			useDefault.update({ disabled: !state.settings.model });
			rows.update({
				rows: settingsRows(state.settings, state.pool.memegen, save),
			});
			summary.textContent = `Pool: ${state.pool.memegen} bundled and ${state.pool.custom} custom memes, ${state.pool.coolingDown} cooling down.`;
			problems.replaceChildren(
				...state.problems.map((problem) => element("li", "", problem)),
			);
		};
		const save = async (patch: Partial<Settings>) =>
			publish(await ctx.call<PluginState>("save-settings", patch));

		const picker = ctx.ui.mountModelPicker(
			pickerSlot,
			{
				value: undefined,
				onChange: (model) =>
					save({ model: { provider: model.provider, id: model.id } }),
			},
			{ signal },
		);
		const useDefault = ctx.ui.mountButton(
			defaultSlot,
			{
				label: "Use cheap slot",
				variant: "outline",
				size: "sm",
				onClick: () => save({ model: null }),
			},
			{ signal },
		);
		const rows = ctx.ui.mountSettingsRows(
			rowsSlot,
			{ rows: settingsRows(state.settings, state.pool.memegen, save) },
			{ signal },
		);
		ctx.ui.mountButton(
			resetSlot,
			{
				label: "Reset cooldowns",
				variant: "outline",
				size: "sm",
				onClick: async () =>
					publish(await ctx.call<PluginState>("reset-usage")),
			},
			{ signal },
		);
		publish(state);
	})();

	return () => root.remove();
}

export function activate(ctx: PluginFrontendContext): void {
	let open: PluginWidgetHandle<PluginSurfaceProps> | null = null;

	ctx.registerAction({
		id: "meme-this",
		name: "Meme this",
		icon: ICON,
		// Listed in Keyboard settings, unbound until the learner assigns a chord.
		shortcut: { scope: { sessions: ["teaching", "practice"] } },
		run(context) {
			if (context.surface !== "session") return;
			// The same action closes its own surface.
			if (open) {
				open.dispose();
				open = null;
				return;
			}
			const found = conceptFromView(context.view);
			const handle = ctx.ui.openSurface(
				context.surfaceTarget,
				{
					title: "Meme",
					content: (container, signal) => {
						const unmount = mountSurface(ctx, container, signal, found);
						// Runs on user close, navigation away and plugin disable alike.
						return () => {
							unmount();
							if (open === handle) open = null;
						};
					},
					onClose: () => {
						if (open === handle) open = null;
					},
				},
				{ signal: ctx.signal },
			);
			open = handle;
		},
	});
	ctx.placeAction({
		id: "meme-this-top-bar",
		actionId: "meme-this",
		location: "top-bar",
		sessions: ["teaching", "practice"],
	});
	ctx.registerSettings((container, signal) =>
		mountSettings(ctx, container, signal),
	);
}
