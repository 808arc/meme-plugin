/** Window side of the meme plugin: one session action that opens a page-body
 * surface with the meme, plus the settings page. All state lives in the backend. */
import type {
	PluginFrontendContext,
	PluginSettingsRow,
	PluginSurfaceProps,
	PluginWidgetHandle,
} from "learnharness-plugin-api";
import { type ConceptResult, conceptFromView } from "./concept.ts";
import { element, mountMeme } from "./render.ts";
import {
	customFolderProblem,
	imageBaseUrlProblem,
	LIMITS,
} from "./settings.ts";
import type {
	Concept,
	GeneratedMeme,
	MemeExport,
	MemeImage,
	PluginState,
	Settings,
} from "./types.ts";

const ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/></svg>';

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
	const body = element("div", "meme-plugin-body");
	const fact = element("p", "meme-plugin-fact");
	const credit = element("p", "meme-plugin-credit");
	const actions = element("div", "meme-plugin-actions");
	const anotherSlot = element("span", ""),
		rejectSlot = element("span", ""),
		copySlot = element("span", "");
	actions.append(anotherSlot, rejectSlot, copySlot);
	root.append(heading, conceptLine, body, fact, credit, actions);
	container.append(root);

	let concept: Concept | null = found.status === "found" ? found.concept : null;
	let result: GeneratedMeme | null = null;
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
	const show = (next: GeneratedMeme, image: MemeImage | null) => {
		clear();
		result = next;
		unmountMeme = mountMeme(body, next, image);
		fact.textContent = next.fact;
		credit.append(`Meme: ${next.meme.name}`);
		if (next.meme.source && /^https?:\/\//.test(next.meme.source)) {
			const link = element("a", "", "about this meme");
			link.href = next.meme.source;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			credit.append(" · ", link);
		}
	};

	/** `rejecting`: the learner turned down the meme on screen ("Not this one"). */
	const run = async (rejecting = false) => {
		if (!concept) return;
		const turn = ++sequence;
		const stale = () => signal.aborted || turn !== sequence;
		conceptLine.textContent = concept.prompt;
		another.update({ disabled: true });
		reject.update({ disabled: true });
		copy.update({ disabled: true });
		status("Picking a meme and writing the caption…");
		try {
			// Asking again steers away from the meme that is on screen; rejecting
			// it also lengthens its cooldown.
			const next = await ctx.call<GeneratedMeme>("generate", {
				...concept,
				...(result
					? {
							[rejecting ? "rejectMemeId" : "excludeMemeId"]: result.meme.id,
						}
					: {}),
			});
			if (stale()) return;
			let image: MemeImage | null = null;
			if (next.meme.hasImage) {
				// A missing image is not a failure: the caption still shows as text.
				try {
					image = await ctx.call<MemeImage | null>("get-image", {
						id: next.meme.id,
					});
				} catch {
					image = null;
				}
				if (stale()) return;
			}
			show(next, image);
			another.update({ disabled: false, label: "Another meme" });
			reject.update({ disabled: false });
			copy.update({ disabled: false });
		} catch (error) {
			if (stale()) return;
			status(message(error), true);
			another.update({ disabled: false, label: "Try again" });
		}
	};

	const another = ctx.ui.mountButton(
		anotherSlot,
		{
			label: "Another meme",
			variant: "outline",
			disabled: true,
			onClick: () => run(),
		},
		{ signal },
	);
	const reject = ctx.ui.mountButton(
		rejectSlot,
		{
			label: "Not this one",
			variant: "ghost",
			disabled: true,
			onClick: () => run(true),
		},
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
			type: "number",
			key: "rejectCooldownDays",
			label: "Minimum cooldown after rejecting (days)",
			description:
				"A meme you reject with Not this one stays out at least this long, even when the cooldown is 0.",
			value: settings.rejectCooldownDays,
			...LIMITS.rejectCooldownDays,
			step: 1,
			onChange: (rejectCooldownDays) => save({ rejectCooldownDays }),
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
		{
			type: "slider",
			key: "ownMemesShare",
			label: "Own memes first (%)",
			description:
				"Chance a meme comes from your own memes while one is out of cooldown. 100: always, then the catalogue.",
			value: settings.ownMemesShare,
			...LIMITS.ownMemesShare,
			step: 5,
			onChange: (ownMemesShare) => save({ ownMemesShare }),
		},
		{
			type: "text",
			key: "customFolder",
			label: "Custom memes folder",
			description:
				"Folder with custom-memes.json and custom-images/. Only read, never changed. Leave empty for the plugin's data folder.",
			value: settings.customFolder,
			validate: (value) => customFolderProblem(value.trim()),
			onChange: (customFolder) => save({ customFolder }),
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
		const exportSlot = element("div", "");
		const exported = element("p", "meme-plugin-settings-note");
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
			exportSlot,
			exported,
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
			summary.textContent = `Pool: ${state.pool.memegen} bundled and ${state.pool.custom} custom memes, ${state.pool.coolingDown} cooling down. Custom memes are read from ${state.customFolder}.`;
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
		// No save dialog in the plugin API: the copy goes under data/exports/ and the
		// path is shown so the learner can move it.
		ctx.ui.mountButton(
			exportSlot,
			{
				label: "Export my memes",
				variant: "outline",
				size: "sm",
				onClick: async () => {
					try {
						const result = await ctx.call<MemeExport>("export-memes");
						if (!signal.aborted)
							exported.textContent = `Exported custom-memes.json and ${result.images} images to ${result.path}`;
					} catch (error) {
						if (!signal.aborted) exported.textContent = message(error);
					}
				},
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
