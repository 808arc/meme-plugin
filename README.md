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