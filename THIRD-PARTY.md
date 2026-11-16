# Third-party material

## memegen template metadata

`src/data/memegen-templates.json` (bundled into `backend.cjs`) is derived from the
template configuration files of [memegen](https://github.com/jacebrowning/memegen):
template names, source links, example captions and text-box positions. The commit it
was taken from is recorded in the file. Refresh it with `npm run sync:memegen`.

No meme images are included in this package. Images are requested at run time from
the image server set in the plugin settings (by default the public memegen service,
`https://api.memegen.link`) and cached in the plugin's data directory: the finished
meme with its caption drawn by the server, or the blank image when that fails.

memegen is distributed under the MIT License:

> Copyright 2020 Jace Browning
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify,
> merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright notice and this permission notice shall be included in all copies
> or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
> PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
> HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
> OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Vellum meme-generator skill

The generation process (pick the template by joke structure, then write tight copy,
one line per box, and let memegen draw it) follows the `meme-generator` skill of
[vellum-assistant](https://github.com/vellum-ai/vellum-assistant/tree/main/skills/meme-generator).
`src/memegen-url.ts` ports its caption-encoding rules (fixed: memegen has no `~e`
escape, so "!" is kept), and `BEST_FOR` and the structure list in `src/prompts.ts`
are adapted from its template table.

vellum-assistant is distributed under the MIT License:

> Copyright (c) 2025 Vellum AI
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify,
> merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright notice and this permission notice shall be included in all copies
> or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
> PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
> HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
> OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## LearnHarness

`scripts/install-plugin-local.mjs` is the portable installer from the LearnHarness
plugin authoring skill, unchanged (AGPL-3.0, see `LICENSE`).
