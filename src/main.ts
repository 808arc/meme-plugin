/** Window side of the meme plugin: one session action that opens a page-body
 * surface with the meme, plus the settings page. All state lives in the backend. */
import type {
	PluginActionContext,
	PluginFrontendContext,
	PluginSettingsRow,
	PluginSurfaceProps,
	PluginSurfaceTarget,
	PluginToolRenderProps,
	PluginWidgetHandle,
} from "learnharness-plugin-api";
import {
	type AnsweredQuestion,
	type ConceptResult,
	conceptFromView,
	lastAnsweredQuestion,
} from "./concept.ts";
import { BUTTONLESS, TEACHER_TOOL } from "./config.ts";
import { element, mountMeme } from "./render.ts";
import { imageBaseUrlProblem, LIMITS } from "./settings.ts";
import type {
	AutomaticMemes,
	AutomaticResult,
	Concept,
	GeneratedMeme,
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

const message = (error: unknown) =>
	error instanceof Error && error.message
		? error.message
		: "Something went wrong.";

function mountSurface(
	ctx: PluginFrontendContext,
	container: HTMLElement,
	signal: AbortSignal,
	found: ConceptResult,
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
	const body = element("div", "meme-plugin-body");
	const fact = element("p", "meme-plugin-fact");
	const credit = element("p", "meme-plugin-credit");
	const actions = element("div", "meme-plugin-actions");
	const anotherSlot = element("span", ""),
		copySlot = element("span", "");
	actions.append(anotherSlot, copySlot);
	const content = [conceptLine, body, fact, credit, actions];
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

	const run = async () => {
		if (!concept) return;
		const turn = ++sequence;
		const stale = () => signal.aborted || turn !== sequence;
		conceptLine.textContent = concept.prompt;
		another.update({ disabled: true });
		copy.update({ disabled: true });
		status("Picking a meme and writing the caption…");
		try {
			// Asking again steers away from the meme that is on screen.
			const next = await ctx.call<GeneratedMeme>("generate", {
				...concept,
				...(result ? { excludeMemeId: result.meme.id } : {}),
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
			copy.update({ disabled: false });
		} catch (error) {
			if (stale()) return;
			status(message(error), true);
			another.update({ disabled: false, label: "Try again" });
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

	if (preset) {
		conceptLine.textContent = preset.meme.concept.prompt;
		show(preset.meme, preset.image);
		another.update({ disabled: false });
		copy.update({ disabled: false });
	} else if (found.status === "hidden") {
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
		const rowsSlot = element("div", "");
		const summary = element("p", "meme-plugin-settings-note");
		const budget = element("p", "meme-plugin-settings-note");
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
			budget,
			resetSlot,
			problems,
		);

		// Publish values only after the backend accepted and stored them.
		const publish = (next: PluginState) => {
			if (signal.aborted) return;
			state = next;
			onState(state);
			picker.update({ value: state.settings.model ?? undefined });
			useDefault.update({ disabled: !state.settings.model });
			rows.update({
				rows: settingsRows(state.settings, state.pool.memegen, save),
			});
			summary.textContent = `Pool: ${state.pool.memegen} bundled and ${state.pool.custom} custom memes, ${state.pool.coolingDown} cooling down.`;
			const spent = state.automatic.used >= state.automatic.perDay;
			budget.hidden = !spent;
			budget.textContent = spent
				? "Today's automatic memes are used up; none appear on their own until tomorrow. Meme this still works."
				: "";
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
		queueMicrotask(() => void deliver(target, answered));
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
			openMeme(context.surfaceTarget, conceptFromView(context.view));
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
