/** Frontend behavior against a simulated DOM and a recording stand-in for the host
 * context. This checks the plugin's own logic, not LearnHarness's real widgets. */
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { Window } from "happy-dom";
import type {
	PluginAction,
	PluginActionContext,
	PluginFrontendContext,
	PluginSettingsSchema,
} from "learnharness-plugin-api";
import { defaultBoxes } from "../src/library.ts";
import { activate } from "../src/main.ts";
import type { GeneratedMeme, PluginState } from "../src/types.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const generated = (id: string, lines: string[]): GeneratedMeme => ({
	meme: {
		id,
		origin: "custom",
		name: `Name of ${id}`,
		source: "https://example.com/about",
		boxes: defaultBoxes(lines.length),
		hasImage: true,
	},
	concept: { prompt: "Who backed CUDA?" },
	originalCaption: lines,
	templateLines: lines,
	lines,
	values: {},
	emphasis: null,
	fact: "Jensen Huang backed CUDA.",
});
const state: PluginState = {
	settings: {
		model: null,
		emphasis: true,
		cooldownDays: 14,
		cooldownGrowth: 2,
		useMemegen: true,
		imageBaseUrl: "https://api.memegen.link",
		teacherMemes: "off",
		automaticMemes: "off",
	},
	pool: { memegen: 209, custom: 1, coolingDown: 3 },
	problems: ["custom-memes.json entry 2: bad"],
	automatic: { used: 0, perDay: 10 },
};

function fixture(
	t: TestContext,
	backend: (operation: string, input: unknown) => unknown,
) {
	const window = new Window();
	const globals = {
		document: window.document,
		navigator: {
			clipboard: {
				copied: "",
				async writeText(text: string) {
					this.copied = text;
				},
			},
		},
	};
	const previous = Object.fromEntries(
		Object.keys(globals).map((key) => [
			key,
			Object.getOwnPropertyDescriptor(globalThis, key),
		]),
	);
	for (const [key, value] of Object.entries(globals))
		Object.defineProperty(globalThis, key, {
			value,
			configurable: true,
			writable: true,
		});
	t.after(() => {
		for (const [key, descriptor] of Object.entries(previous))
			descriptor
				? Object.defineProperty(globalThis, key, descriptor)
				: delete (globalThis as Record<string, unknown>)[key];
	});

	const activation = new AbortController();
	const calls: { operation: string; input: unknown }[] = [];
	const actions = new Map<string, PluginAction>();
	const placements: unknown[] = [];
	const surfaces: {
		container: HTMLElement;
		signal: AbortController;
		cleanup?: (() => void) | void;
		props: { title: string; onClose?: () => void };
	}[] = [];
	const widgets: {
		kind: string;
		props: Record<string, unknown>;
		container: HTMLElement;
	}[] = [];
	let settings:
		| ((container: HTMLElement, signal: AbortSignal) => unknown)
		| undefined;
	const widget =
		(kind: string) =>
		(
			container: HTMLElement,
			props: Record<string, unknown>,
			options: { signal: AbortSignal },
		) => {
			assert.ok(
				options.signal instanceof AbortSignal,
				`${kind} is scoped to a signal`,
			);
			const entry = { kind, props: { ...props }, container };
			widgets.push(entry);
			return {
				update(next: Record<string, unknown>) {
					Object.assign(entry.props, next);
				},
				dispose() {},
			};
		};
	const appEvents: ((event: { type: string }) => void)[] = [];
	let refreshes = 0;
	const ctx = {
		signal: activation.signal,
		onAppEvent(listener: (event: { type: string }) => void) {
			appEvents.push(listener);
			return () => {};
		},
		onResync() {
			return () => {};
		},
		refreshActions() {
			refreshes++;
		},
		registerAction(action: PluginAction) {
			actions.set(action.id, action);
			return () => {};
		},
		placeAction(placement: unknown) {
			assert.ok(
				actions.has((placement as { actionId: string }).actionId),
				"action registered before placement",
			);
			placements.push(placement);
			return () => {};
		},
		registerSettings(mount: typeof settings) {
			settings = mount;
			return () => {};
		},
		registerToolRenderer() {
			return () => {};
		},
		async call(operation: string, input?: unknown) {
			calls.push({ operation, input });
			return backend(operation, input);
		},
		ui: {
			mountButton: widget("button"),
			mountComposer: widget("composer"),
			mountModelPicker: widget("model"),
			mountSettingsRows: widget("rows"),
			openSurface(
				target: unknown,
				props: {
					title: string;
					content: (
						container: HTMLElement,
						signal: AbortSignal,
					) => (() => void) | void;
					onClose?: () => void;
				},
				options: { signal: AbortSignal },
			) {
				assert.equal(
					target,
					"surface-target",
					"the surface binds to the page the action ran on",
				);
				assert.equal(options.signal, activation.signal);
				const entry: (typeof surfaces)[number] = {
					container: window.document.createElement(
						"div",
					) as unknown as HTMLElement,
					signal: new AbortController(),
					props,
				};
				surfaces.push(entry);
				entry.cleanup = props.content(entry.container, entry.signal.signal);
				return {
					update() {},
					dispose() {
						if (!entry.signal.signal.aborted) {
							entry.signal.abort();
							entry.cleanup?.();
						}
					},
				};
			},
		},
	} as unknown as PluginFrontendContext;
	activate(ctx);
	const press = (
		input: unknown,
		placement: "top-bar" | "keyboard" = "top-bar",
	) =>
		actions.get("meme-this")!.run({
			placement,
			surface: "session",
			sessionId: "s",
			kind: "teaching",
			surfaceTarget: "surface-target",
			view: { transcript: [], input },
		} as unknown as PluginActionContext);
	const button = (label: string) =>
		widgets.findLast(
			(entry) => entry.kind === "button" && entry.props.label === label,
		)!;
	/** A top-bar render: the host evaluates the action's dynamic `disabled` predicate. */
	let reads = 0;
	const render = (view: Record<string, unknown>) => {
		const disabled = actions.get("meme-this")!.disabled as (
			context: PluginActionContext,
		) => boolean;
		return disabled({
			placement: "top-bar",
			surface: "session",
			sessionId: "s",
			kind: "teaching",
			surfaceTarget: "surface-target",
			get view() {
				reads++;
				return {
					sessionId: "s",
					transcript: [],
					messages: [],
					input: { type: "text" },
					...view,
				};
			},
		} as unknown as PluginActionContext);
	};
	return {
		render,
		reads: () => reads,
		refreshes: () => refreshes,
		appEvent: (type: string) => {
			for (const listener of appEvents) listener({ type });
		},
		calls,
		actions,
		placements,
		surfaces,
		widgets,
		press,
		button,
		mountSettings: (container: HTMLElement) =>
			settings!(container, new AbortController().signal),
		document: window.document as unknown as Document,
		clipboard: globals.navigator.clipboard,
	};
}
const question = {
	type: "answer",
	revealed: true,
	question: { question: "Who backed CUDA?", options: [] },
};

test("the action is registered for sessions, placed explicitly and opts into shortcuts", (t) => {
	const f = fixture(t, () => null);
	const action = f.actions.get("meme-this")!;
	assert.equal(action.name, "Meme this");
	assert.deepEqual(action.shortcut, {
		scope: { sessions: ["teaching", "practice"] },
	});
	assert.deepEqual(f.placements, [
		{
			id: "meme-this-top-bar",
			actionId: "meme-this",
			location: "top-bar",
			sessions: ["teaching", "practice"],
		},
	]);
	// Sidebar/graph/app invocations carry no session and do nothing.
	void action.run({ placement: "sidebar", surface: "sidebar" });
	void action.run({ placement: "keyboard", surface: "app", pathname: "/" });
	assert.equal(f.surfaces.length, 0);
});

test("a question becomes a meme drawn over its image, with text inserted safely", async (t) => {
	const hostile = '<img src=x onerror="alert(1)"> wins';
	const f = fixture(t, (operation) =>
		operation === "generate"
			? generated("custom:a", ["he backed cuda", hostile])
			: { mimeType: "image/png", data: "AAAA" },
	);
	void f.press(question);
	const surface = f.surfaces[0]!;
	assert.equal(surface.props.title, "Meme");
	assert.match(
		surface.container.querySelector(".meme-plugin-status")!.textContent!,
		/Picking a meme/,
	);
	assert.ok(surface.container.querySelector("[data-plugin-initial-focus]"));
	await settle();

	assert.deepEqual(f.calls, [
		{ operation: "generate", input: { prompt: "Who backed CUDA?" } },
		{ operation: "get-image", input: { id: "custom:a" } },
	]);
	const image = surface.container.querySelector(
		"img.meme-plugin-image",
	) as HTMLImageElement;
	assert.equal(image.getAttribute("src"), "data:image/png;base64,AAAA");
	assert.equal(image.alt, "Name of custom:a meme");
	const texts = [...surface.container.querySelectorAll(".meme-plugin-text")];
	assert.deepEqual(
		texts.map((node) => node.textContent),
		["HE BACKED CUDA", hostile.toUpperCase()],
		"upper-style boxes shout; markup stays text",
	);
	assert.equal(
		surface.container.querySelectorAll("img").length,
		1,
		"model text never becomes an element",
	);
	const boxes = [
		...surface.container.querySelectorAll(".meme-plugin-box"),
	] as HTMLElement[];
	assert.deepEqual(
		boxes.map((box) => [
			box.style.left,
			box.style.top,
			box.style.width,
			box.style.height,
		]),
		[
			["0%", "0%", "100%", "20%"],
			["0%", "80%", "100%", "20%"],
		],
	);
	assert.equal(
		surface.container.querySelector(".meme-plugin-concept")!.textContent,
		"Who backed CUDA?",
	);
	assert.equal(
		surface.container.querySelector(".meme-plugin-fact")!.textContent,
		"Jensen Huang backed CUDA.",
	);
	const link = surface.container.querySelector(
		".meme-plugin-credit a",
	) as HTMLAnchorElement;
	assert.deepEqual(
		[link.getAttribute("href"), link.target, link.rel],
		["https://example.com/about", "_blank", "noopener noreferrer"],
	);

	assert.equal(f.button("Another meme").props.disabled, false);
	await (f.button("Copy caption").props.onClick as () => Promise<void>)();
	assert.equal(f.clipboard.copied, `he backed cuda\n${hostile}`);
	// Asking again steers away from the meme on screen.
	await (f.button("Another meme").props.onClick as () => Promise<void>)();
	assert.deepEqual(f.calls[2], {
		operation: "generate",
		input: { prompt: "Who backed CUDA?", excludeMemeId: "custom:a" },
	});
});

test("pressing the action again closes its surface, and a closed surface reopens", async (t) => {
	const f = fixture(t, (operation) =>
		operation === "generate" ? generated("custom:a", ["x"]) : null,
	);
	void f.press(question);
	await settle();
	assert.equal(
		f.surfaces[0]!.container.querySelector(".meme-plugin-line")!.textContent,
		"x",
		"no image: the caption shows as text",
	);
	void f.press(question, "keyboard");
	assert.equal(f.surfaces.length, 1);
	assert.equal(f.surfaces[0]!.signal.signal.aborted, true);
	assert.equal(
		f.surfaces[0]!.container.children.length,
		0,
		"cleanup removes the plugin's nodes",
	);
	void f.press(question);
	assert.equal(f.surfaces.length, 2);
	// The host closing it (user X, navigation) is noticed too: the next press opens, not closes.
	f.surfaces[1]!.signal.abort();
	f.surfaces[1]!.cleanup?.();
	void f.press(question);
	assert.equal(f.surfaces.length, 3);
});

test("results that arrive after the surface closed are dropped", async (t) => {
	let finish!: (value: GeneratedMeme) => void;
	const f = fixture(t, (operation) =>
		operation === "generate"
			? new Promise<GeneratedMeme>((resolve) => {
					finish = resolve;
				})
			: null,
	);
	void f.press(question);
	void f.press(question);
	finish(generated("custom:late", ["late"]));
	await settle();
	assert.equal(f.surfaces[0]!.container.textContent, "");
	assert.equal(f.calls.length, 1, "no image is requested for a dropped meme");
});

test("failures are shown with a retry; an image failure falls back to text", async (t) => {
	let attempt = 0;
	const f = fixture(t, (operation) => {
		if (operation === "get-image") throw new Error("offline");
		if (++attempt === 1)
			throw new Error("Choose a model in the Meme plugin settings.");
		return generated("custom:a", ["first", "second"]);
	});
	void f.press(question);
	await settle();
	const surface = f.surfaces[0]!.container;
	assert.equal(
		surface.querySelector(".meme-plugin-error")!.textContent,
		"Choose a model in the Meme plugin settings.",
	);
	const retry = f.button("Try again");
	assert.equal(retry.props.disabled, false);
	await (retry.props.onClick as () => Promise<void>)();
	assert.equal(surface.querySelector(".meme-plugin-error"), null);
	assert.deepEqual(
		[...surface.querySelectorAll(".meme-plugin-line")].map(
			(node) => node.textContent,
		),
		["first", "second"],
	);
	assert.equal(surface.querySelector("img"), null);
});

test("an unrevealed question is not read; with no question the learner types a concept", async (t) => {
	const f = fixture(t, (operation) =>
		operation === "generate" ? generated("custom:a", ["x"]) : null,
	);
	void f.press({ ...question, revealed: false });
	await settle();
	assert.match(
		f.surfaces[0]!.container.querySelector(".meme-plugin-status")!.textContent!,
		/Reveal the question first/,
	);
	assert.equal(f.calls.length, 0);
	void f.press(question);

	void f.press({ type: "text" });
	await settle();
	assert.match(
		f.surfaces[1]!.container.querySelector(".meme-plugin-status")!.textContent!,
		/Type the concept/,
	);
	const composer = f.widgets.find((entry) => entry.kind === "composer")!;
	assert.equal(composer.props.canSend, false);
	await (composer.props.onSend as () => unknown)();
	assert.equal(f.calls.length, 0, "an empty concept is not sent");
	(composer.props.onChange as (value: string) => void)("  transformers  ");
	assert.deepEqual(
		[composer.props.value, composer.props.canSend],
		["  transformers  ", true],
	);
	await (composer.props.onSend as () => Promise<void>)();
	assert.deepEqual(f.calls[0], {
		operation: "generate",
		input: { prompt: "transformers" },
	});
});

test("settings publish only what the backend accepted", async (t) => {
	let current = state;
	const f = fixture(t, (operation, input) => {
		if (operation === "save-settings") {
			if ((input as { cooldownDays?: number }).cooldownDays === 999)
				throw new Error("cooldownDays must be a number from 0 to 365");
			current = {
				...current,
				settings: { ...current.settings, ...(input as object) },
			};
		}
		if (operation === "reset-usage")
			current = { ...current, pool: { ...current.pool, coolingDown: 0 } };
		return current;
	});
	const container = f.document.createElement("div");
	f.mountSettings(container);
	assert.equal(container.textContent, "Loading…");
	await settle();

	const rows = () =>
		(
			f.widgets.find((entry) => entry.kind === "rows")!
				.props as unknown as PluginSettingsSchema
		).rows;
	assert.deepEqual(
		rows().map((row) => [row.key, row.type, row.value]),
		[
			["emphasis", "toggle", true],
			["cooldownDays", "number", 14],
			["cooldownGrowth", "number", 2],
			["useMemegen", "toggle", true],
			["teacherMemes", "dropdown", "off"],
			["automaticMemes", "dropdown", "off"],
			["imageBaseUrl", "text", "https://api.memegen.link"],
		],
	);
	assert.match(
		container.textContent!,
		/Pool: 209 bundled and 1 custom memes, 3 cooling down\./,
	);
	assert.equal(
		container.querySelector(".meme-plugin-settings-problems li")!.textContent,
		"custom-memes.json entry 2: bad",
	);
	const url = rows().find((row) => row.key === "imageBaseUrl")!;
	assert.equal(
		url.type === "text" && url.validate!("https://memes.example/"),
		undefined,
	);
	assert.match((url.type === "text" && url.validate!("ftp://x")) || "", /http/);

	const days = rows().find((row) => row.key === "cooldownDays")!;
	await (days.onChange as (value: number) => Promise<void>)(30);
	assert.equal(rows().find((row) => row.key === "cooldownDays")!.value, 30);
	await assert.rejects(
		(days.onChange as (value: number) => Promise<void>)(999),
		/0 to 365/,
	);
	assert.equal(
		rows().find((row) => row.key === "cooldownDays")!.value,
		30,
		"a rejected save is not published",
	);

	const picker = f.widgets.find((entry) => entry.kind === "model")!;
	assert.equal(picker.props.value, undefined);
	assert.equal(f.button("Use cheap slot").props.disabled, true);
	await (picker.props.onChange as (value: unknown) => Promise<void>)({
		provider: "p",
		id: "m",
		extra: "ignored",
	});
	assert.deepEqual(f.calls.at(-1), {
		operation: "save-settings",
		input: { model: { provider: "p", id: "m" } },
	});
	assert.deepEqual(picker.props.value, { provider: "p", id: "m" });
	assert.equal(f.button("Use cheap slot").props.disabled, false);
	await (f.button("Use cheap slot").props.onClick as () => Promise<void>)();
	assert.equal(picker.props.value, undefined);
	await (f.button("Reset cooldowns").props.onClick as () => Promise<void>)();
	assert.match(container.textContent!, /0 cooling down/);
});

// #18 buttonless mode
const answered = (
	toolCallId: string,
	extra: Record<string, unknown> = {},
	answeredAt = new Date(Date.now() + 1000).toISOString(),
) => ({
	role: "toolResult",
	toolCallId,
	toolName: "quiz",
	content: [],
	isError: false,
	details: {
		kind: "quiz",
		questionText: "Who backed CUDA?",
		options: [
			{ index: 0, label: "Jensen Huang" },
			{ index: 1, label: "Lisa Su" },
		],
		dontKnow: false,
		answers: [],
		correct: true,
		answeredAt,
		...extra,
	},
});
const automaticBackend =
	(mode: string, log: unknown[] = []) =>
	(operation: string, input: unknown) => {
		if (operation === "get-state")
			return {
				...state,
				settings: { ...state.settings, automaticMemes: mode },
			};
		if (operation === "auto-meme") {
			log.push(input);
			return { status: "meme", meme: generated("custom:auto", ["auto"]) };
		}
		return null;
	};

test("automatic memes are off by default: no view read, no request, action stays enabled", async (t) => {
	const f = fixture(t, automaticBackend("off"));
	assert.equal(f.render({ messages: [answered("q1")] }), false);
	await settle();
	assert.deepEqual(
		f.calls.map((call) => call.operation),
		["get-state"],
	);
	assert.equal(
		f.refreshes(),
		1,
		"the predicate is re-run once settings are known",
	);
	assert.equal(f.render({ messages: [answered("q1")] }), false);
	await settle();
	assert.equal(f.reads(), 0, "off: the session view is never read");
	assert.equal(f.surfaces.length, 0);
	assert.ok(
		!f.calls.some((call) => call.operation === "auto-meme"),
		"off: nothing is sent",
	);
});

test("an automatic meme appears only after an answer, folded and dismissible", async (t) => {
	const sent: unknown[] = [];
	const f = fixture(t, automaticBackend("every", sent));
	f.render({ input: { type: "text" } });
	await settle();

	// A pending question, even revealed, has no answer yet: nothing.
	f.render({ input: question });
	// An unrevealed next question on screen: the reveal rule holds nothing back early.
	f.render({
		input: { ...question, revealed: false },
		messages: [answered("q1")],
	});
	await settle();
	assert.deepEqual(sent, []);
	assert.equal(f.surfaces.length, 0);

	f.render({ input: { type: "text" }, messages: [answered("q1")] });
	await settle();
	assert.deepEqual(sent, [
		{
			key: "s:q1",
			prompt: "Who backed CUDA?",
			context: "Answer options shown to the learner: Jensen Huang | Lisa Su",
			wrong: false,
		},
	]);
	const surface = f.surfaces[0]!;
	assert.equal(
		surface.container.querySelector("[data-plugin-initial-focus]"),
		null,
		"an automatic meme takes no focus",
	);
	const fold = surface.container.querySelector(
		".meme-plugin-fold",
	) as HTMLElement;
	assert.equal(fold.hidden, true, "collapsed by default");
	assert.equal(
		fold.querySelector(".meme-plugin-line")!.textContent,
		"auto",
		"the meme is ready behind the fold",
	);
	(f.button("Show meme").props.onClick as () => void)();
	assert.equal(fold.hidden, false);
	assert.equal(f.button("Hide meme").props.label, "Hide meme");
	(f.button("Dismiss").props.onClick as () => void)();
	assert.equal(surface.signal.signal.aborted, true);
	assert.equal(surface.container.children.length, 0);

	// Same question again (later renders): never a second automatic meme.
	f.render({ input: { type: "text" }, messages: [answered("q1")] });
	f.appEvent("turn-settled");
	await settle();
	f.render({ input: { type: "text" }, messages: [answered("q1")] });
	await settle();
	assert.equal(sent.length, 1);
	assert.equal(f.surfaces.length, 1);
});

test("automatic memes skip old answers, dismissed questions and an open meme", async (t) => {
	const sent: unknown[] = [];
	const f = fixture(t, automaticBackend("wrong", sent));
	f.render({});
	await settle();
	// Answered before this window started: history, not a fresh answer.
	f.render({ messages: [answered("old", {}, "2020-01-01T00:00:00.000Z")] });
	f.render({ messages: [answered("gone", { dismissed: true })] });
	await settle();
	assert.deepEqual(sent, []);

	void f.press(question);
	f.render({ messages: [answered("q2", { correct: false })] });
	await settle();
	assert.deepEqual(sent, [], "the learner already has a meme open");

	f.surfaces[0]!.signal.abort();
	f.surfaces[0]!.cleanup?.();
	f.render({ messages: [answered("q3", { correct: false })] });
	await settle();
	assert.deepEqual(
		(sent as { key: string; wrong: boolean }[]).map((entry) => [
			entry.key,
			entry.wrong,
		]),
		[["s:q3", true]],
		"the graded verdict travels; the backend applies the frequency",
	);
});

test("settings say when today's automatic budget is used up", async (t) => {
	const f = fixture(t, () => ({
		...state,
		automatic: { used: 10, perDay: 10 },
	}));
	const container = f.document.createElement("div");
	f.mountSettings(container);
	await settle();
	assert.match(
		container.textContent!,
		/automatic memes are used up.*Meme this still works/,
	);
});
