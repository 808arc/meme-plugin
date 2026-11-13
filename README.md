# meme-plugin

Turns each concept asked by learnharness about into a meme.

## How it works

1. Take the concept from the learnharness prompt.
2. Pick random image meme. Store used; skip during cooldown (reverse spaced repetition). Picks ignore the concept for now ([#4](https://github.com/808arc/meme-plugin/issues/4)).
3. Reduce caption to template: fixed phrasing + fillable slots.
4. Fill the slots with facts about the concept.
5. Optionally add emphasis in the meme character's voice.

## Example

**Prompt:** Who backed CUDA?

**Random meme:** emotional Tony Soprano image

Original text on the image:

> He discovered America is what he did. He was a brave Italian explorer. And in this house, Christopher Columbus is a hero!

**Template:**

Pattern recognized in the image text:

> He {achievement} is what he did. He was a brave {descriptor}. And in this house, {name} is a hero!

**Output:**

Text that replaces the original on the image, creating the learn-through-memes effect:

> He backed CUDA is what he did. CUDA!! He was a brave Taiwanese-American industrialist. And in this house, Jensen Huang is a hero!

## Use

### Quick start

1. In a teaching or practice session, try the question first.
2. Press **Meme this** in the top bar.
3. The meme appears over the page body.

| Action | Result |
| --- | --- |
| **Meme this** | Make a meme from the question on screen. |
| **Another meme** | Same concept, different image. |
| **Copy caption** | Copy the text. |
| **Meme this** again | Close. |

A chord for **Meme this** is set in Settings → Keyboard. It is unbound until you assign one.

### Good to know

- The meme states the answer. Open it after you have tried the question, not before.
- An unrevealed question is not read.
- No question on screen: the plugin uses the teacher's latest message, or asks you to type a concept.
- Each meme costs one short model request. The first use of a given meme costs one more, to cache its template.

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
| Add emphasis | on | Step 5. |
| Cooldown (days) | 14 | How long a used meme stays out of rotation. 0 turns it off. |
| Cooldown growth | 2 | Each further use of the same meme multiplies its cooldown: 14, 28, 56 … days, at most a year. |
| Use the bundled catalogue | on | About 200 image memes from [memegen](https://github.com/jacebrowning/memegen). |
| Image server | `https://api.memegen.link` | Where blank images come from. A self-hosted memegen works too. Empty: captions only. |

**Reset cooldowns** makes every meme eligible again.

When every meme is cooling down, the one that becomes eligible soonest is used.

## Where memes come from

The plugin lets you watch memes during the learning process. Intended sources, in order:

1. Earlier memes for the same concept, reused as a limited share of picks so they don't repeat often. Planned ([#9](https://github.com/808arc/meme-plugin/issues/9), [#19](https://github.com/808arc/meme-plugin/issues/19)).
2. Your own memes (below). Planned ([#21](https://github.com/808arc/meme-plugin/issues/21)).
3. The bundled catalogue, about 200 classic templates. Shipped. Dated ones to be hidden ([#6](https://github.com/808arc/meme-plugin/issues/6)).
4. Web search for an existing meme. Planned, on by default, through the search agent you configure ([#11](https://github.com/808arc/meme-plugin/issues/11)).

If no relevant meme is found, the plugin generates a new caption straight away. Shipped. Fitting picks planned ([#4](https://github.com/808arc/meme-plugin/issues/4)).

You can reject a meme to see another. Planned ([#21](https://github.com/808arc/meme-plugin/issues/21)).

Today: random pick from the catalogue, then generate.

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

## What leaves your machine

- The question and the meme's original caption go to the model you chose, through
  LearnHarness's own connection.
- The image server receives only the meme's id (for example `/images/drake.jpg`), once
  per meme. Images are cached in `data/image-cache/`.
- Nothing else. Writes only in `data/`. Learning records untouched.

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
(step 2), `src/prompts.ts` and `src/template.ts` (steps 3 to 5), `src/backend.ts`
(storage and model calls), `src/main.ts` and `src/render.ts` (interface).

Model only proposes. Template accepted only if original words in slots reproduce the
original caption. Plugin assembles final text; fixed phrasing cannot be reworded.

## Limits

- Facts come from the model and are not checked against a source.
- Text placement follows memegen's box positions; rotated boxes are approximate.
- Animated memes are shown as a still image.
- Bundled catalogue is dated. Tagging and filtering planned ([#6](https://github.com/808arc/meme-plugin/issues/6)).

## Planned

Open issues. Not in the current build.

- Meme modes: Answer (today), Hint, Think, which make the learner think before reveal ([#17](https://github.com/808arc/meme-plugin/issues/17)).
- Buttonless mode: memes appear on their own after reveal. Off by default ([#18](https://github.com/808arc/meme-plugin/issues/18)).
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
