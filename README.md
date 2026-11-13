# meme-plugin

Turns each concept learnharness asks about into a meme.

## How it works

1. Take the concept from the learnharness prompt.
2. Pick a random modern image meme. Once used, store it and don't reuse it for a while (reverse spaced repetition).
3. Reduce its caption to a template: fixed memetic phrasing + fillable slots.
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

In a teaching or practice session, press **Meme this** in the top bar. The plugin reads
the question on screen, makes the meme and shows it over the page body. **Another meme**
makes a new one with a different image; **Copy caption** copies the text. Pressing
**Meme this** again closes it. The action is also listed under Settings → Keyboard,
unbound until you assign a chord.

- The meme states the answer. Open it when you want the answer to stick, not before
  you have tried the question.
- A question you have not revealed yet is not read.
- With no question on screen, the plugin uses the teacher's latest message, or asks you
  to type a concept.

Each meme costs one short model request, plus one more the first time a given meme is
used (its template is then cached).

## Install

Requires LearnHarness 0.6.0 or newer and Node.js 20+ for building.

```sh
git clone <this-repository> "<plugins-directory>/meme-plugin"
cd "<plugins-directory>/meme-plugin"
cp -r "<learnharness-plugins-skill>/types" .sdk
npm install
npm run build
```

`<plugins-directory>` is shown in **Settings → Community plugins**. The folder must be
named `meme-plugin`. Then refresh the list, enable **Meme plugin**, and restart
LearnHarness after later code changes.

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

## Your own memes

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

Entries with mistakes are skipped and listed on the settings page. Changes are picked
up on the next meme; no restart needed.

## What leaves your machine

- The question and the meme's original caption go to the model you chose, through
  LearnHarness's own connection.
- The image server receives only the meme's id (for example `/images/drake.jpg`), once
  per meme. Images are cached in `data/image-cache/`.
- Nothing else. The plugin writes only inside its own `data/` directory and does not
  change learning records.

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

The model only proposes. A template is accepted only if putting the original words
back into its slots reproduces the original caption, and the final text is assembled
by the plugin from the template, so the meme's fixed phrasing cannot be reworded.

## Limits

- Facts come from the model and are not checked against a source.
- Text placement follows memegen's box positions; rotated boxes are approximate.
- Animated memes are shown as a still image.

## License

AGPL-3.0-only. Third-party material: see `THIRD-PARTY.md`.
