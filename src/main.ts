/** Window side of the meme plugin: one session action that opens a page-body
 * surface with the meme, plus the settings page. All state lives in the backend. */
import type {
	PluginActionContext,
	PluginFrontendContext,
	PluginSessionViewContext,
	PluginSettingsRow,
	PluginSurfaceProps,
	PluginSurfaceTarget,
	PluginToolRenderProps,
	PluginWidgetHandle,
} from "learnharness-plugin-api";
import {
	type AnsweredQuestion,
	type ConceptResult,
	conceptBeforeReveal,
	conceptFromView,
	lastAnsweredQuestion,
	optionLabels,
} from "./concept.ts";
import {
	BUTTONLESS,
	MEME_MODES,
	type MemeMode,
	STAGE_TOPIC,
	STAGES,
	TEACHER_TOOL,
} from "./config.ts";
import { element, memePng, mountMeme } from "./render.ts";
import {
	customFolderProblem,
	imageBaseUrlProblem,
	LIMITS,
} from "./settings.ts";
import type {
	AutomaticMemes,
	AutomaticResult,
	Concept,
	GeneratedMeme,
	MemeExport,
	MemeImage,
	PluginState,
	Settings,
} from "./types.ts";

const ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/></svg>';

/** #18: a meme the backend already made on its own, shown folded and dismissible. */
interface Preset {
	meme: GeneratedMeme;
	image: MemeImage | null;
	dismiss: () => void;
}

const ordinal = (n: number) =>
	`${n}${(n % 100 >= 11 && n % 100 <= 13 ? "" : ["", "st", "nd", "rd"][n % 10]) || "th"}`;

/** #18: a meme the backend already made on its own, shown folded and dismissible. */
interface Preset {
	meme: GeneratedMeme;
	image: MemeImage | null;
	dismiss: () => void;
}

const message = (error: unknown) =>
	error instanceof Error && error.message
		? error.message
		: "Something went wrong.";

function mountSurface(
	ctx: PluginFrontendContext,
	container: HTMLElement,
	signal: AbortSignal,
	found: ConceptResult,
	view: PluginSessionViewContext,
	preset?: Preset,
): () => void {
	const root = element("div", "meme-plugin-surface");
	const heading = element("h2", "meme-plugin-heading", "Meme");
	// The host focuses this marker when the surface opens. An automatic meme takes no focus.
	if (!preset) {
		heading.tabIndex = -1;
		heading.setAttribute("data-plugin-initial-focus", "");
	}
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
		rejectSlot = element("span", ""),
		copySlot = element("span", ""),
		copyImageSlot = element("span", ""),
		upSlot = element("span", ""),
		downSlot = element("span", "");
	actions.append(
		anotherSlot,
		rejectSlot,
		copySlot,
		copyImageSlot,
		upSlot,
		downSlot,
	);
	const notice = element("p", "meme-plugin-notice");
	const content = [conceptLine, collapse, fact, credit, actions, notice];
	if (preset) {
		// Folded to one line until the learner expands it; Dismiss closes the surface.
		const fold = element("div", "meme-plugin-fold");
		fold.append(...content);
		let folded: boolean = BUTTONLESS.collapsed;
		fold.hidden = folded;
		const bar = element("div", "meme-plugin-actions");
		const toggleSlot = element("span", ""),
			dismissSlot = element("span", "");
		bar.append(toggleSlot, dismissSlot);
		root.append(
			heading,
			element(
				"p",
				"meme-plugin-concept",
				"A meme for the question you just answered.",
			),
			bar,
			fold,
		);
		const toggle = ctx.ui.mountButton(
			toggleSlot,
			{
				label: folded ? "Show meme" : "Hide meme",
				variant: "outline",
				onClick: () => {
					folded = !folded;
					fold.hidden = folded;
					toggle.update({ label: folded ? "Show meme" : "Hide meme" });
				},
			},
			{ signal },
		);
		ctx.ui.mountButton(
			dismissSlot,
			{ label: "Dismiss", variant: "ghost", onClick: preset.dismiss },
			{ signal },
		);
	} else root.append(heading, ...content);
	container.append(root);

	let concept: Concept | null = found.status === "found" ? found.concept : null;
	let result: GeneratedMeme | null = null;
	let image: MemeImage | null = null;
	let rating: "up" | "down" | null = null;
	// #17: option labels for the no-answer check (used by Hint and Think only), and
	// whether the question was read before the learner revealed it.
	const options = found.status === "found" ? optionLabels(view) : [];
	let extra: { options?: string[]; early?: true } = options.length
		? { options }
		: {};
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
		rating = next.rating ?? null;
		unmountMeme = mountMeme(body, next, picture);
		fact.textContent =
			next.webMatch === "related"
				? "Related meme: found on the web, not checked as an answer."
				: next.mode
					? `${MEME_MODES.labels[next.mode]}: ${next.fact}`
					: next.fact;
		credit.append(`Meme: ${next.meme.name}`);
		if (next.meme.credit) credit.append(` · Credit: ${next.meme.credit}`);
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

	/** `rejecting`: the learner turned down the meme on screen ("Not this one"). */
	const run = async (rejecting = false) => {
		if (!concept) return;
		const turn = ++sequence;
		const stale = () => signal.aborted || turn !== sequence;
		// Before reveal the question text stays off screen too.
		conceptLine.textContent = extra.early
			? "Before you reveal the question"
			: concept.prompt;
		another.update({ disabled: true });
		reject.update({ disabled: true });
		copy.update({ disabled: true });
		copyImage.update({ disabled: true });
		up.update({ disabled: true });
		down.update({ disabled: true });
		notice.textContent = "";
		status(STAGES.selecting);
		// The backend reports each step as it starts; only this request's events count.
		const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
		let done = false;
		const stopStages = ctx.onNotification((event) => {
			if (done || stale() || event.topic !== STAGE_TOPIC) return;
			const data = event.data as { requestId?: unknown; stage?: unknown };
			if (data?.requestId !== requestId || typeof data.stage !== "string")
				return;
			const label = (STAGES as Record<string, string>)[data.stage];
			if (label) status(label);
		});
		try {
			// Asking again steers away from the meme that is on screen; rejecting
			// it also lengthens its cooldown.
			const next = await ctx.call<GeneratedMeme>("generate", {
				...concept,
				...extra,
				requestId,
				...(view.sessionId ? { sessionId: view.sessionId } : {}),
				...(result
					? {
							[rejecting ? "rejectMemeId" : "excludeMemeId"]: result.meme.id,
						}
					: {}),
			});
			done = true;
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
			reject.update({ disabled: false });
			copy.update({ disabled: false });
			copyImage.update({ disabled: !picture });
			// Rating needs the stored handle; a meme without one cannot be rated.
			up.update({ disabled: !next.generatedId });
			down.update({ disabled: !next.generatedId });
		} catch (error) {
			if (stale()) return;
			status(message(error), true);
			another.update({ disabled: false, label: "Try again" });
		} finally {
			done = true;
			stopStages();
		}
	};

	const rate = async (value: "up" | "down") => {
		const id = result?.generatedId;
		if (!id) return;
		const previous = rating;
		rating = rating === value ? null : value;
		paintRating();
		try {
			await ctx.call("rate", { id, rating });
		} catch (error) {
			if (signal.aborted || result?.generatedId !== id) return;
			rating = previous;
			paintRating();
			notice.textContent = `Rating not saved. ${message(error)}`;
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

	if (preset) {
		conceptLine.textContent = preset.meme.concept.prompt;
		show(preset.meme, preset.image);
		another.update({ disabled: false });
		copy.update({ disabled: false });
	} else if (found.status === "hidden") {
		status("Reveal the question first. A meme would show it early.");
		void readBeforeReveal();
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
					extra = {};
					result = null;
					return run();
				},
			},
			{ signal },
		);
	} else void run();

	/** #17: only Hint and Think read an unrevealed question, through the whitelisted
	 * path in concept.ts. Any failure leaves the "reveal first" message (Answer). */
	async function readBeforeReveal() {
		let mode: MemeMode | undefined;
		try {
			// #32: the mode of this chat's next meme (Shuffle resolves to one).
			mode = (
				await ctx.call<PluginState>(
					"get-state",
					view.sessionId ? { sessionId: view.sessionId } : undefined,
				)
			).nextMode;
		} catch {
			return;
		}
		if (
			signal.aborted ||
			!mode ||
			!(MEME_MODES.preReveal as readonly string[]).includes(mode)
		)
			return;
		const early = conceptBeforeReveal(view);
		if (!early) return;
		concept = early.concept;
		extra = {
			early: true,
			...(early.options.length ? { options: early.options } : {}),
		};
		await run();
	}

	return () => {
		sequence++;
		clear();
		root.remove();
	};
}

function settingsRows(
	settings: Settings,
	bundled: number,
	keyFound: boolean,
	save: (patch: Partial<Settings>) => Promise<void>,
): PluginSettingsRow[] {
	return [
		{
			type: "dropdown",
			key: "mode",
			label: "Meme mode",
			description:
				"Answer states the fact. Hint points at it without saying it. Think asks you to pick before the answer shows. Shuffle cycles Answer, Hint, Think, one per question; each meme shows its mode. Hint and Think also work before you reveal the question.",
			value: settings.mode,
			options: MEME_MODES.modes.map((value) => ({
				value,
				label: MEME_MODES.labels[value],
			})),
			onChange: (mode) => save({ mode: mode as MemeMode }),
		},
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
			key: "webSearch",
			label: "Search the web for memes",
			description: `${
				settings.webSearch &&
				settings.searchProvider === "none" &&
				!settings.searchAgent
					? "On, but needs a search provider: choose one below. Until then nothing is searched. "
					: ""
			}Before generating, look for an existing meme on the web through the search provider below. The concept is sent to that provider. Off: local sources and generation only.`,
			value: settings.webSearch,
			onChange: (webSearch) => save({ webSearch }),
		},
		{
			type: "dropdown",
			key: "searchProvider",
			label: "Search provider",
			description: `${
				settings.searchProvider === "tavily" && !keyFound
					? "TAVILY_API_KEY is not set in the environment: nothing is searched. "
					: ""
			}Tavily sends the concept to Tavily, which reports no licence, so its results are currently filtered out. Key: the TAVILY_API_KEY environment variable only.`,
			value: settings.searchProvider,
			options: [
				{ value: "none", label: "None" },
				{ value: "tavily", label: "Tavily" },
			],
			onChange: (searchProvider) =>
				save({ searchProvider: searchProvider as Settings["searchProvider"] }),
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
			type: "dropdown",
			key: "teacherMemes",
			label: "Teacher memes (experimental)",
			description: `In teaching sessions the teacher may put a meme in the chat, at most one per ${TEACHER_TOOL.turnsPerMeme} teacher turns and ${TEACHER_TOOL.automaticMemesPerDay} a day. It is told to wait until you have tried the question, but this is not yet enforced by LearnHarness.`,
			value: settings.teacherMemes,
			options: [
				{ value: "off", label: "Off" },
				{ value: "teacher", label: "Teacher decides" },
				{ value: "wrong", label: "After wrong answers" },
			],
			onChange: (value) =>
				save({ teacherMemes: value as Settings["teacherMemes"] }),
		},
		{
			type: "dropdown",
			key: "automaticMemes",
			label: "Automatic memes",
			description: `After you answer a question, a meme opens over the page on its own, folded to one line; Dismiss closes it. Each counts toward the ${TEACHER_TOOL.automaticMemesPerDay} automatic memes a day shared with teacher memes.`,
			value: settings.automaticMemes,
			options: [
				{ value: "off", label: "Off" },
				{ value: "every", label: "Every revealed question" },
				{
					value: "nth",
					label: `Every ${ordinal(BUTTONLESS.everyNth)} revealed question`,
				},
				{ value: "wrong", label: "Only after wrong answers" },
			],
			onChange: (value) =>
				save({ automaticMemes: value as Settings["automaticMemes"] }),
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
	onState: (state: PluginState) => void,
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
		const searchRow = element("div", "meme-plugin-settings-model");
		const searchSlot = element("span", "");
		searchRow.append(searchSlot);
		const rowsSlot = element("div", "");
		const summary = element("p", "meme-plugin-settings-note");
		const budget = element("p", "meme-plugin-settings-note");
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
			element("p", "meme-plugin-settings-label", "Search agent"),
			element(
				"p",
				"meme-plugin-settings-note",
				"Looks for existing memes when web search is on. Pick the model and provider you trust with your questions. Without one, no search runs.",
			),
			searchRow,
			rowsSlot,
			summary,
			budget,
			resetSlot,
			exportSlot,
			exported,
			problems,
		);

		// Publish values only after the backend accepted and stored them.
		const publish = (next: PluginState) => {
			if (signal.aborted) return;
			state = next;
			onState(state);
			const spent = state.automatic.used >= state.automatic.perDay;
			budget.hidden = !spent;
			budget.textContent = spent
				? "Today's automatic memes are used up; none appear on their own until tomorrow. Meme this still works."
				: "";
			picker.update({ value: state.settings.model ?? undefined });
			searchPicker.update({ value: state.settings.searchAgent ?? undefined });
			useDefault.update({ disabled: !state.settings.model });
			rows.update({
				rows: settingsRows(
					state.settings,
					state.pool.memegen,
					state.searchKeyFound,
					save,
				),
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
		const searchPicker = ctx.ui.mountModelPicker(
			searchSlot,
			{
				value: undefined,
				onChange: (model) =>
					save({ searchAgent: { provider: model.provider, id: model.id } }),
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
			{
				rows: settingsRows(
					state.settings,
					state.pool.memegen,
					state.searchKeyFound,
					save,
				),
			},
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

/** Teacher tool result: the meme the teacher put in the chat. Renders only what the backend returned. */
function mountTeacherMeme(
	ctx: PluginFrontendContext,
	container: HTMLElement,
	tool: PluginToolRenderProps,
): () => void {
	const root = element("div", "meme-plugin-tool");
	container.append(root);
	const note = (text: string, failed = false) =>
		root.replaceChildren(
			element(
				"p",
				failed ? "meme-plugin-status meme-plugin-error" : "meme-plugin-status",
				text,
			),
		);
	if (tool.state === "output-error") {
		note(tool.errorText || "The meme could not be made.", true);
		return () => root.remove();
	}
	const result = tool.output as GeneratedMeme | undefined;
	if (
		tool.state !== "output-available" ||
		!result ||
		!Array.isArray(result.lines)
	) {
		note("Making a meme…");
		return () => root.remove();
	}
	let unmount: (() => void) | null = null;
	const show = (image: MemeImage | null) => {
		if (tool.signal.aborted) return;
		unmount?.();
		root.replaceChildren();
		unmount = mountMeme(root, result, image);
		root.append(element("p", "meme-plugin-fact", result.fact));
	};
	if (result.meme.hasImage) {
		// A missing image is not a failure: the caption still shows as text.
		ctx
			.call<MemeImage | null>("get-image", { id: result.meme.id })
			.then(show, () => show(null));
	} else show(null);
	return () => {
		unmount?.();
		root.remove();
	};
}

export function activate(ctx: PluginFrontendContext): void {
	let open: PluginWidgetHandle<PluginSurfaceProps> | null = null;

	ctx.registerToolRenderer({
		toolName: "meme_teach",
		mount: (container, tool) => mountTeacherMeme(ctx, container, tool),
	});

	const openMeme = (
		target: PluginSurfaceTarget,
		found: ConceptResult,
		view: PluginSessionViewContext,
		preset?: Omit<Preset, "dismiss">,
	) => {
		const handle = ctx.ui.openSurface(
			target,
			{
				title: "Meme",
				content: (container, signal) => {
					const unmount = mountSurface(
						ctx,
						container,
						signal,
						found,
						view,
						preset && { ...preset, dismiss: () => handle.dispose() },
					);
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
	};

	// #18 buttonless mode. The SDK has no session subscription; the action's dynamic
	// `disabled` predicate is the one live read of the session view, re-run whenever the
	// host re-renders the top bar (and on refreshActions). It never disables the action.
	const activatedAt = Date.now();
	let automatic: AutomaticMemes | null = null;
	let loading = false;
	const handled = new Set<string>();
	const loadAutomatic = () => {
		if (loading) return;
		loading = true;
		ctx
			.call<PluginState>("get-state")
			.then(
				(state) => {
					if (ctx.signal.aborted) return;
					automatic = state.settings.automaticMemes;
					ctx.refreshActions();
				},
				() => {},
			)
			.finally(() => {
				loading = false;
			});
	};
	const deliver = async (
		target: PluginSurfaceTarget,
		answered: AnsweredQuestion,
		view: PluginSessionViewContext,
	) => {
		let result: AutomaticResult;
		try {
			result = await ctx.call<AutomaticResult>("auto-meme", {
				key: answered.key,
				...answered.concept,
				wrong: answered.wrong,
			});
		} catch {
			return; // Automatic: a failure stays quiet; Meme this still works.
		}
		if (result.status !== "meme" || ctx.signal.aborted || open) return;
		let image: MemeImage | null = null;
		if (result.meme.meme.hasImage)
			try {
				image = await ctx.call<MemeImage | null>("get-image", {
					id: result.meme.meme.id,
				});
			} catch {
				image = null;
			}
		if (ctx.signal.aborted || open) return;
		try {
			openMeme(
				target,
				{ status: "found", concept: result.meme.concept },
				view,
				{ meme: result.meme, image },
			);
		} catch {
			/* the learner left that page */
		}
	};
	const observe = (context: PluginActionContext) => {
		if (context.surface !== "session" || ctx.signal.aborted) return;
		if (automatic === null) return loadAutomatic();
		if (automatic === "off") return;
		const view = context.view;
		// Same reveal rule as Meme this: nothing while an unrevealed question is on screen.
		if (conceptFromView(view).status === "hidden") return;
		const answered = lastAnsweredQuestion(view);
		// Only answers given while this window runs; never the same question twice.
		if (
			!answered ||
			handled.has(answered.key) ||
			!(answered.answeredAt >= activatedAt)
		)
			return;
		handled.add(answered.key);
		// A meme is already open: the learner has one; this question is done.
		if (open) return;
		const target = context.surfaceTarget;
		queueMicrotask(() => void deliver(target, answered, context.view));
	};
	ctx.onAppEvent((event) => {
		if (
			automatic !== null &&
			(event.type === "turn-settled" || event.type === "record-changed")
		)
			loadAutomatic();
	});
	ctx.onResync(() => {
		if (automatic !== null) loadAutomatic();
	});

	ctx.registerAction({
		id: "meme-this",
		name: "Meme this",
		icon: ICON,
		// Listed in Keyboard settings, unbound until the learner assigns a chord.
		shortcut: { scope: { sessions: ["teaching", "practice"] } },
		disabled(context) {
			try {
				observe(context);
			} catch {
				/* watching must never break the action */
			}
			return false;
		},
		run(context) {
			if (context.surface !== "session") return;
			// The same action closes its own surface.
			if (open) {
				open.dispose();
				open = null;
				return;
			}
			openMeme(
				context.surfaceTarget,
				conceptFromView(context.view),
				context.view,
			);
		},
	});
	ctx.placeAction({
		id: "meme-this-top-bar",
		actionId: "meme-this",
		location: "top-bar",
		sessions: ["teaching", "practice"],
	});
	ctx.registerSettings((container, signal) =>
		mountSettings(ctx, container, signal, (state) => {
			automatic = state.settings.automaticMemes;
		}),
	);
}
