# Teacher meme tool (#10)

Status: **experimental**, off by default. The reveal rule is prompt-only (see below); that is the main risk.

## Goal

In teaching sessions the teacher agent can put a meme in the chat when it helps a concept stick.

## Mechanics

- Host API: `ctx.registerTools({ agents: ["teacher"], create })` and `ctx.registerInstructions({ agents: ["teacher"], text })` in backend; `ctx.registerToolRenderer({ toolName: "meme_teach" })` in frontend.
- Teaching sessions only (`teacher` agent). Not prober, not practice.
- Tool name: `meme_teach`. Input: `{ prompt, context? }` (same concept shape as Meme this). No answer field.
- Output to model: caption lines and fact. Output to renderer: `GeneratedMeme` in `details`.
- Same pipeline as Meme this (`generate`): same pool, cooldown, fact. Shares the one-at-a-time guard.
- Tool and instructions are registered only while a mode is on. Changes apply to future turns (host semantics).

## Setting: Teacher memes (experimental)

| Value | Behaviour |
| --- | --- |
| Off (default) | Nothing registered. No change to sessions. |
| Teacher decides | Teacher may call the tool unprompted, within the cap. |
| After wrong answers | Teacher told to call it only right after a wrong answer, once revealed. Prompt-only: the plugin sees no grading signal. |

## Limits (`src/config.ts`, section `// #10 teacher tool`)

- `turnsPerMeme: 5`: at most one teacher meme per 5 teacher turns per chat. A turn = one call of the `registerTools` `create` factory (the host builds a fresh loadout per turn). The tool context has no turn counter or time signal; this is the only turn signal. Over the cap the tool is not offered that turn; `execute` also refuses.
- `automaticMemesPerDay: 10`: one shared daily budget for all automatic memes (this tool now, buttonless mode #18 later). Local calendar day, persisted in `state.json` as `automatic`. Counted on success.
- Turn counts are in memory and reset on restart. The daily budget does not.

## Inference purpose

- SDK: `PluginCallPurpose = "user" | "background"`. Docs: purpose must reflect who started the work; automatic work must not be classified as user.
- Tool path uses `"background"` (the teacher, not the learner, chose to make it). Meme this stays `"user"`.

## Reveal rule

- A meme never shows an answer before the learner has tried.
- Today enforced only by: teacher instructions, tool description, no answer field in the input.
- Gap: `PluginToolContext` has only `chatId` and `agent`. The backend cannot see whether a question is pending or revealed.

### Host request (exact)

Either of these, in order of preference:

1. **Reveal state in tool context.** Add to `PluginToolContext` a read-only field, for example `readonly input: { pending: boolean; revealed: boolean }`, matching `PluginSessionViewContext.input` for the chat when the tool executes. The plugin then refuses `meme_teach` when `pending && !revealed`.
2. **Hold tool calls while a question is pending.** A tool option, for example `holdWhileQuestionPending: true` on the tool definition, so the host defers or rejects execution while the learner has an unanswered, unrevealed question in that chat.

Until one exists, the setting stays labelled experimental and off by default.

## Still open

- Fact check (#7) should run before the tool returns.
- A grading signal (host event with answer correctness) would make "After wrong answers" enforceable.
- Whether practice sessions get the tool later.
