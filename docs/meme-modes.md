# Meme modes (#17)

Design for the meme mode setting. Status: implemented behind the setting, default Answer.
Not yet run in a real LearnHarness host or against a real model.

## Terms

- **Reveal**: the host's `revealed` flag on the pending input. It means the question card
  is uncovered. Before it, the learner reads the teaching prose; the question is hidden.
- **Answer key**: `correctIndices`, `correctAnswer`, `committedAnswer`, `explanation`, a plugin
  question's `payload`, and anything in `view.messages` / `view.transcript`. The host's
  `ClientQuestion` projection omits these on purpose. The plugin never relies on that.

## Modes

| Mode | Caption does | Runs | Fact line shows |
| --- | --- | --- | --- |
| Answer (default) | States the answer. Unchanged. | After reveal only. | The fact. |
| Hint | Points at the answer: category, first letter, a property, a clue. | Before or after reveal. | The hint as one sentence. |
| Think | Poses a question or contrast (two claims, one true; "which is the impostor?"). | Before or after reveal. | The question to the learner. |
| Reflect | Later. Not implemented. | | |

Think: the learner commits by answering the host's question. The plugin never shows which claim
is true.

## What the plugin reads

| Mode | Before reveal | After reveal |
| --- | --- | --- |
| Answer | Nothing. "Reveal the question first." No model call. | As today: question text, context, option labels; or the teacher's latest message. |
| Hint, Think | Question text, context, option labels. Nothing else. | Same as Answer. |

Before reveal, never read: the learner's draft, `payload`, `messages`, `transcript`, any
answer-key field the host might add to the question object. Fields are whitelisted, not
filtered. An unrevealed `unavailable` input stays hidden in every mode (nothing safe to read).

Before reveal the surface does not show the question text either. The concept line says
"Before you reveal the question" instead.

## Flow

1. Press. Revealed (or no reveal flag): send `{prompt, context?, options?}` as today; the backend
   uses its stored mode.
2. Hidden: show "Reveal the question first" (as today). Ask the backend for the mode. Answer: stop.
   Hint/Think: read the whitelisted fields, send them with `early: true`.
3. Backend refuses `early: true` unless the stored mode is Hint or Think (settings may change in
   another window). No model call on refusal.

## Safety checks

1. Whitelist read (above). Answer key never reaches the model or the screen before reveal.
2. Prompt rule (Hint/Think): never write the answer, a synonym, or any option text.
3. The model must also return `answer`: the answer it is hinting at, short. Backend only. Never
   returned to the window, never stored.
4. Deterministic check on every caption line, and the fact line: no option label (all options, not
   only the correct one, since the plugin does not know which is correct) and not the model's
   `answer`. Normalised: case, accents, punctuation, spacing; whole words only.
5. On a leak: one correction round, then the next meme; after three memes, a generic error. Error
   text never quotes the answer.
6. Emphasis off in Hint/Think (it repeats the key term, often the answer).

Limits: when there are no options and the model's `answer` is wrong or paraphrased, only the prompt
rule protects. Facts in Hint/Think still go unchecked until #7.

## Tunables

`MEME_MODES` in `src/config.ts`.

## Evidence

- Testing effect (Roediger & Karpicke 2006; Rowland 2014): retrieval beats restudy. Hint and Think
  keep retrieval with the learner. `docs/meme-evidence.md`.
- LLM retrieval practice (An 2025): same direction.
- Generation effect: cited in the issue, not yet in `docs/meme-evidence.md`.

## Open decisions

1. Reading before reveal shows the question's topic early. Hint/Think accept that; the question
   text itself stays off screen. Keep?
2. Think: allow wrong options in the caption? Today all options are blocked.
3. Think: let the learner pick inside the meme, then show which claim was true? Needs the answer on
   screen before the host grades; not done.
4. True/false or yes/no options: blocking every option label may reject many Hint captions.
5. Scoring whether Hint/Think beat Answer: needs #5.
6. Reflect mode: after reveal, "why does this hold?". Later.
7. README "Good to know" and Planned lines: update once checked in a real host.
