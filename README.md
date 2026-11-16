# meme-plugin

Turns each concept asked by learnharness about into a meme.

> **Status:** early build. Only your own memes, the catalogue and generation work today.
> Most features in [Planned](#planned) are design only. Research findings are unverified
> until checked ([docs](#research)).

## How it works

The process follows the [Vellum meme-generator skill](https://github.com/vellum-ai/vellum-assistant/tree/main/skills/meme-generator):

1. Take the concept from the learnharness prompt. Start with the take: the one fact to remember.
2. Pick the template whose joke structure fits: comparison → Drake, hot take → Change My Mind, escalation → Galaxy Brain, and so on. Your own memes first. Store used; skip during cooldown (reverse spaced repetition).
3. Write tight copy: one line per text box, at most 8 words each.
4. The image server (memegen) draws the lines onto the template. Your own images, or a server that fails, are captioned in the page instead.

## Example

**Prompt:** Who backed CUDA?

**Picked meme:** Drakeposting, best for "this not that" comparisons.

Original lines:

> 1. left on unread
> 2. left on read

**Output lines:**

> 1. Waiting for CPUs to do matrix math
> 2. Jensen Huang betting Nvidia on CUDA

**Fact:** Jensen Huang's Nvidia backed CUDA.

The image comes back from `https://api.memegen.link/images/drake/Waiting_for_CPUs_to_do_matrix_math/Jensen_Huang_betting_Nvidia_on_CUDA.png`.

## Use

### Quick start

1. In a teaching or practice session, try the question first.
2. Press **Meme this** in the top bar.
3. The meme appears over the page body.

| Action | Result |
| --- | --- |
| **Meme this** | Make a meme from the question on screen. |
| **Another meme** | Same concept, different image. |
| **Not this one** | Reject this meme; it sits out one cooldown step longer. Shows another. |
| **Copy caption** | Copy the text. |
| **Meme this** again | Close. |

A chord for **Meme this** is set in Settings → Keyboard. It is unbound until you assign one.

### Good to know

- The meme states the answer. Open it after you have tried the question, not before.
- An unrevealed question is not read, except by Hint, Think and the asked-question trigger.
- No question on screen: the plugin uses the teacher's latest message, or asks you to type a concept.
- Each meme costs one short model request to write it, plus the pick and the fact check when they run.
- One meme is made at a time. **Another meme**, **Try again** or **Meme this** cancel the one in progress; closing the window cancels it too. Automatic and teacher memes wait their turn instead.

## Install

Requires LearnHarness 0.6.0 or newer and Node.js 20+ for building.

```sh
git clone <this-repository> "<plugins-directory>/meme-plugin"
cd "<plugins-directory>/meme-plugin"
cp -r "<learnharness-plugins-skill>/types" .sdk
npm install
npm run build
```

`<plugins-directory>` is shown in **Settings → Community plugins**. Folder must be
named `meme-plugin`. Refresh list. Enable **Meme plugin**. Restart LearnHarness after code changes.

Building somewhere else: `npm run install:local -- "<plugins-directory>"` builds and
replaces only the installed `dist/`.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Model | cheap model slot | Writes the captions. |
| Caption model | Model | Model for the caption text only; picking and fact check keep Model. Set separately, so a stronger model writes captions while the cheap one does the rest. |
| Meme mode | Answer | Answer: states the fact. Hint, Think: point at it, never state it; also work before reveal. Shuffle: Answer, Hint, Think in turn, one per question; each label shows its mode. |
| Tone | none | Comic tone of the wording: deadpan, absurd, sarcastic, self-deprecating, playful. Shuffle: a random one of these per meme. Facts unchanged. |
| Cooldown (days) | 14 | How long a used meme stays out of rotation. 0 turns it off. |
| Cooldown growth | 2 | Each further use of the same meme multiplies its cooldown: 14, 28, 56 … days, at most a year. |
| Use the bundled catalogue | on | About 200 image memes from [memegen](https://github.com/jacebrowning/memegen). |
| Automatic memes | off | Meme opens on its own, folded, dismissible. After the answer is revealed: every, every 3rd, or only wrong. When a question is asked: every, or every 3rd; Hint or Think only, never the answer. Shuffle: one of these five per question. Shares the daily cap of 10 automatic memes with teacher memes; at the cap, none, and settings say so. Meme this still works. |
| Image server | `https://api.memegen.link` | Draws the caption onto catalogue memes, and serves blank images. A self-hosted memegen works too. Empty: captions only, no images. |
| Minimum cooldown after rejecting (days) | 1 | A meme rejected with **Not this one** stays out at least this long, even with cooldown 0. |
| Own memes first (%) | 100 | Chance a pick is one of your own memes while one is out of cooldown. 100: always. Lower mixes in the catalogue. |
| Custom memes folder | empty (`data/`) | Absolute path to a folder with `custom-memes.json` and `custom-images/`. Only read. |
| Teacher memes (experimental) | off | In teaching sessions the teacher may put a meme in the chat: when it decides, or only after wrong answers. Shuffle: one of the two, drawn again each teacher turn. |
| Search the web for memes | on | Before generating, look for an existing meme through the search agent. At most 15 seconds; past that, the meme is generated instead. Off: local sources and generation only. |
| Search provider | none | none or Tavily. Tavily needs `TAVILY_API_KEY` in the environment; no key, nothing is searched. Tavily gives no licence, so its hits are filtered out. |
| Search agent | none | The model and provider that search uses. Without one, and with no provider, nothing is searched. |

**Reset cooldowns** makes every meme eligible again.

**Export my memes** copies `custom-memes.json` and `custom-images/` to a new
`data/exports/memes-<time>/` folder; settings show the full path.

When every meme is cooling down, the one that becomes eligible soonest is used.

## Where memes come from

Each question runs these steps in order, stopping at the first hit:

1. Earlier meme for the same question in the same mode, reused as a limited share of picks. Shipped ([#9](https://github.com/808arc/meme-plugin/issues/9)).
2. Web search for an existing meme. Answer mode only; on by default; needs a search agent you configure ([#11](https://github.com/808arc/meme-plugin/issues/11)).
3. Template: your own memes first (100% by default), then the bundled catalogue. The model picks the one whose joke structure fits; dated templates rank last ([#4](https://github.com/808arc/meme-plugin/issues/4), [#6](https://github.com/808arc/meme-plugin/issues/6), [#21](https://github.com/808arc/meme-plugin/issues/21)).
4. Caption: the model writes one short line per box. Answer states the fact; Hint points at it; Think asks you to pick ([#4](https://github.com/808arc/meme-plugin/issues/4), [#17](https://github.com/808arc/meme-plugin/issues/17)).
5. Check: Answer runs the fact check ([#7](https://github.com/808arc/meme-plugin/issues/7)); Hint and Think run the no-answer check ([#17](https://github.com/808arc/meme-plugin/issues/17)).

If no relevant meme is found, the plugin generates a new caption straight away.

Reject a meme with **Not this one** to see another. Shipped. It counts as a use: back in rotation after a longer cooldown (at least 1 day), not deleted.

### Your own memes

The bundled catalogue is classic rather than current. Add any meme you like, such as
the one in the example above, in `<plugins-directory>/meme-plugin/data/custom-memes.json`:

```json
[
  {
    "id": "brave-explorer",
    "name": "Emotional speech at the dinner table",
    "image": "brave-explorer.jpg",
    "caption": ["<the original text on the image>"]
  }
]
```

- `image`: a file in `data/custom-images/` (PNG, JPEG, WebP or GIF, without the
  original text), or an `https://` address. Omit it for a text-only meme.
- `caption`: 1 to 8 lines of original text. One line is drawn as a subtitle, two as
  top/bottom text, more are stacked.
- `boxes` (optional): one per caption line, to place the text yourself. Fractions of
  the image: `{ "x": 0.05, "y": 0.7, "w": 0.9, "h": 0.25 }`, plus optional `angle`,
  `color`, `style` (`upper`, `lower`, `none`), `font` (`thick`, `thin`, `comic`) and
  `align`.
- `source` (optional): a link shown as "about this meme".

Bad entries skipped, listed in settings. Changes apply next meme; no restart.

Elsewhere: set **Custom memes folder** (for example a synced or backed-up folder) and
put `custom-memes.json` and `custom-images/` there. Plugin only reads it.

Backup: **Export my memes** in settings, or copy the folder. Plugin never edits or
deletes your files.

## What leaves your machine

- The question and the meme's original caption go to the model you chose, through
  LearnHarness's own connection.
- The image server receives the meme's id **and its caption lines**, because it draws
  them (for example `/images/drake/CPU_math/CUDA.png`). The lines state the answer in
  Answer mode. To keep captions on your machine, point **Image server** at a
  self-hosted memegen. Your own memes never go to the server. Blank images (fallback)
  send only the id. Images are cached in `data/image-cache/`.
- Nothing else. Writes only in `data/`, even with a custom memes folder elsewhere
  (read only) and for exports. Learning records untouched.
- Web search for existing memes, on by default. The concept goes to the search agent you configure, and from there to its search providers ([#11](https://github.com/808arc/meme-plugin/issues/11)). Tavily, when chosen: the concept goes to Tavily as the query ([#31](https://github.com/808arc/meme-plugin/issues/31)). A settings switch turns it off.
- Loading a web meme's image exposes your IP address to the host of that image.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run sync:memegen -- "<memegen-checkout>"   # refresh the bundled catalogue
```

`tests/host/` holds a check that loads the built package in the real LearnHarness
plugin host; it needs a LearnHarness checkout (instructions in the file).

Source map: `src/concept.ts` (step 1), `src/scheduler.ts` and `src/library.ts`
(step 2), `src/prompts.ts` and `src/caption.ts` (step 3), `src/memegen-url.ts`
(step 4), `src/backend.ts` (storage and model calls), `src/main.ts` and
`src/render.ts` (interface).

Model only proposes. A caption is accepted only with one line per box, each at most
8 words, and passes the fact check (Answer) or the no-answer check (Hint, Think).

## Limits

- Facts come from the model and are not checked against a source.
- Catalogue memes are drawn by memegen. Own memes, and the fallback when the server fails, follow memegen's box positions in the page; rotated boxes are approximate there.
- Animated memes are shown as a still image.
- Bundled catalogue is dated. Tagging and filtering planned ([#6](https://github.com/808arc/meme-plugin/issues/6)).

## Planned

Open issues. Not in the current build.

- Buttonless mode: memes appear on their own after an answer. Off by default. Shipped: setting **Automatic memes** ([#18](https://github.com/808arc/meme-plugin/issues/18)); asked trigger ([#38](https://github.com/808arc/meme-plugin/issues/38)).
- Like or dislike any meme; save favourites in a local library ([#19](https://github.com/808arc/meme-plugin/issues/19)).
- Elastic cooldown and meme choice on top of the user knowledge graph. Needs a decision on learner strength first ([#20](https://github.com/808arc/meme-plugin/issues/20)).
- Memes as spaced-repetition cards, with optional quizzes ([#22](https://github.com/808arc/meme-plugin/issues/22)).
- Choose memes by graph tags: plugin picks, learner picks, as independent toggles that can be on together ([#23](https://github.com/808arc/meme-plugin/issues/23)).
- Pick a meme that fits the concept; ask for humor that stays accurate ([#4](https://github.com/808arc/meme-plugin/issues/4)).
- Eval: score fit, humor and accuracy before and after prompt changes ([#5](https://github.com/808arc/meme-plugin/issues/5)).
- Check the caption's fact against the question's answer options ([#7](https://github.com/808arc/meme-plugin/issues/7)).
- Inline meme in the question card, with progress states, 👍/👎 and copy image ([#8](https://github.com/808arc/meme-plugin/issues/8)).
- Reuse earlier memes for the same concept, stored locally ([#9](https://github.com/808arc/meme-plugin/issues/9)).
- Teacher agent tool to drop memes into the chat. Needs design ([#10](https://github.com/808arc/meme-plugin/issues/10)).
- Web search for existing memes, on by default, through a user-configured search agent. Sends the concept to that agent's providers ([#11](https://github.com/808arc/meme-plugin/issues/11)).
- CI, and a release zip of `dist/`, so installs don't need a local build ([#3](https://github.com/808arc/meme-plugin/issues/3)).

## Research

Evidence behind the design choices:

- [docs/meme-evidence.md](docs/meme-evidence.md): humor and memory; how memes spread and persuade.
- [docs/humor-structure.md](docs/humor-structure.md): how humor works in text; what it means for captions.

Key findings are unverified until ticked off in each file.

## License

AGPL-3.0-only. Third-party material: see `THIRD-PARTY.md`.
