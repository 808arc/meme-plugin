# Teacher meme tool (#10)

Status: design. Part implemented, see "Built now". Open items need the owner.

## Goal

The teacher agent can put one meme in the chat when it helps a concept stick.

## Mechanics

- Host API: `ctx.registerTools({ agents: ["teacher"], create })` in backend; `ctx.registerInstructions({ agents: ["teacher"], text })`; `ctx.registerToolRenderer({ toolName: "meme_teach" })` in frontend.
- Tool name: `meme_teach`. Input: `{ prompt, context? }` (same concept shape as Meme this). No answer field.
- Output to model: caption lines and fact (so the teacher can refer to it). Output to renderer: `GeneratedMeme` in `details`.
- Same pipeline as Meme this (`generate`), same pool, cooldown and fact step. Shares the one-at-a-time guard.
- Not registered unless the setting is on. Toggle takes effect for future turns (host semantics).

## Reveal rule

- A meme never shows an answer before the learner has tried.
- Enforced by: tool instructions (call only after the learner answered or the question is revealed; never while a question is pending); tool description; no answer field in input.
- Limit: `PluginToolContext` gives only `chatId` and `agent`. The backend cannot read reveal state. Real enforcement needs the host to pass reveal state, or the host to hold tool calls while a question is pending.

## Setting

- `teacherTool: boolean`, default **off**. No frequency levels yet (see open questions). Off changes nothing.

## Open decisions (owner)

1. Frequency: off / when the teacher judges fit / after wrong answers only / every Nth concept. Default off stays.
2. Reveal enforcement: host support for reveal state in tool context (preferred) vs prompt-only.
3. Scope: teacher only, or practice agent too (practice has its own reveal flow).
4. Model cost: tool calls make 1 to 2 requests each. Cap per session? Count against the auto-meme budget from #18?
5. Fact check (#7) must run before the tool returns, not after.
6. Purpose of the inference call: tool runs inside a user turn, so `user` is used; confirm.
7. Teacher-initiated memes when the learner has not asked: allowed by default or not?

## Built now

- Setting `teacherTool` (default off), settings row.
- Backend: tool and instructions registered only while the setting is on.
- Frontend: renderer for `meme_teach` (caption, fact, optional image).
- Not built: frequency, reveal-state plumbing, practice agent, caps.
