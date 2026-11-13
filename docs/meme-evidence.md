# Meme evidence

Humor and memory; how memes spread. Feeds prompt design (#4) and UI timing (#8).
Companion: [humor-structure.md](humor-structure.md).

Entry: citation, link, key finding, **implication for this plugin**.

> **Status:** findings from abstracts and search summaries. Verify against full paper before merge (issue #2). Tick when done.

## Humor, memory and learning

### The exception of humour: Iconicity, Phonemic Surprisal, Memory Recall, and Emotional Associations

- [ ] Verify
- **Citation:** Kilpatrick, A. & Flaksman, M. (2025). arXiv:2502.01682.
- **Link:** https://arxiv.org/abs/2502.01682
- **Key finding:** Negative words usually more surprising and memorable. Humorous words break this: positive, yet higher surprisal and recall. Reanalysis of existing word-rating and recall data, no new experiment.
- **Implication for this plugin:** Humor works as memory aid, not only entertainment. Surprise seems part of mechanism: caption twisting meme's phrasing may beat one restating the fact.

### A SMART Mnemonic Sounds like "Glue Tonic": Mixing LLMs with Student Feedback to Make Mnemonic Learning Stick

- [ ] Verify
- **Citation:** arXiv:2406.15352 (2024).
- **Link:** https://arxiv.org/abs/2406.15352
- **Key finding:** LLM mnemonic generator tuned on student feedback. Preference and actual learning diverge; authors use both signals.
- **Implication for this plugin:** User liking a caption is not enough. Measure recall too. Close methodological template for LLM memory aid.

### Humor in Software Testing Education

- [ ] Verify
- **Citation:** arXiv:2606.21682 (2026).
- **Link:** https://arxiv.org/abs/2606.21682
- **Key finding:** Students: humor made subject less intimidating (65.5%), less anxiety (58.6%), less frustration (46.6%). Measures engagement and emotion, not retention.
- **Implication for this plugin:** Memes can ease stress on hard questions. Not evidence for memory gain.

### The Resiliency of Memorability: A Predictor of Memory Separate from Attention and Priming

- [ ] Verify
- **Citation:** arXiv:1703.07738 (2017).
- **Link:** https://arxiv.org/abs/1703.07738
- **Key finding:** Some images intrinsically more memorable. Holds regardless of attention, priming, encoding depth.
- **Implication for this plugin:** Image choice matters apart from caption. Favor memorable images in selection, alongside reverse-spaced-repetition rule.

### KoroT-3E: A Personalized Musical Mnemonics Tool for Enhancing Memory Retention of Complex Computer Science Concepts

- [ ] Verify
- **Citation:** arXiv:2409.10446 (2024).
- **Link:** https://arxiv.org/abs/2409.10446
- **Key finding:** Personalized musical mnemonic tool for CS concepts, aimed at retention.
- **Implication for this plugin:** Comparable generated-mnemonic tool. Check how it evaluates retention.

### Enhancing Student Learning with LLM-Generated Retrieval Practice Questions

- [ ] Verify
- **Citation:** arXiv:2507.05629 (2025). Title from truncated snippet; confirm.
- **Link:** https://arxiv.org/abs/2507.05629
- **Key finding:** LLM-generated retrieval practice: significantly higher retention than week without it.
- **Implication for this plugin:** Supports rule: meme hidden until user tries question. Retrieval first, meme reinforces after.

## How memes spread and persuade

### Strong men create good memes: Far-right memes as means of …

- [ ] Verify
- **Citation:** arXiv:2601.14190 (2026). Full title unconfirmed (truncated).
- **Link:** https://arxiv.org/abs/2601.14190
- **Key finding:** Far-right war memes harder to identify as state propaganda due to humor. Co-produce state narratives bottom-up.
- **Implication for this plugin:** Humor lowers resistance, the effect wanted and a risk: wrong fact in funny meme accepted too. Slot facts must be accurate.

### Narratives of War: Ukrainian Memetic Warfare on Twitter

- [ ] Verify
- **Citation:** arXiv:2309.08363 (2023).
- **Link:** https://arxiv.org/abs/2309.08363
- **Key finding:** Reach depends on audience willingness to share. Platform algorithms and moderation shape spread.
- **Implication for this plugin:** Shareable meme gets repeated; repetition is practice. Relevant to **Copy caption**.

### Detecting Propaganda Techniques in Memes

- [ ] Verify
- **Citation:** arXiv:2109.08013 (2021).
- **Link:** https://arxiv.org/abs/2109.08013
- **Key finding:** Dataset: 950 memes, 22 propaganda techniques. Persuasion carried jointly by image and text.
- **Implication for this plugin:** Caption must match image. Ignoring image loses half the effect; template extraction keeps image link.

### SemEval-2021 Task 6: Detection of Persuasion Techniques in Texts and Images

- [ ] Verify
- **Citation:** arXiv:2105.09284 (2021).
- **Link:** https://arxiv.org/abs/2105.09284
- **Key finding:** Visual cues used with text as persuasive vehicle.
- **Implication for this plugin:** Image is part of message. See entry above.

### On the Origins of Memes by Means of Fringe Web Communities

- [ ] Verify
- **Citation:** arXiv:1805.12512 (2018).
- **Link:** https://arxiv.org/abs/1805.12512
- **Key finding:** Image memes spread across 4chan, Reddit, Gab, Twitter. Few communities push memes to fringe and mainstream.
- **Implication for this plugin:** Background. Caution: popular templates may come from communities whose content should not be reused.

### Virality Prediction and Community Structure in Social Networks

- [ ] Verify
- **Citation:** arXiv:1306.0158 (2013).
- **Link:** https://arxiv.org/abs/1306.0158
- **Key finding:** Most memes spread as complex contagions in communities. Few go across communities. Early community structure predicts virality.
- **Implication for this plugin:** Background. Meme user recognizes from own community lands better than obscure one.

### Dank or Not? Analyzing and Predicting the Popularity of Memes on Reddit

- [ ] Verify
- **Citation:** arXiv:2011.14326 (2020).
- **Link:** https://arxiv.org/abs/2011.14326
- **Key finding:** Few memes go viral; most seen by few dozen. Diverse, well-connected audiences raise virality.
- **Implication for this plugin:** Favor widely recognized templates. Obscure meme adds confusion, no recognition benefit.

### Entropy and complexity unveil the landscape of memes evolution

- [ ] Verify
- **Citation:** arXiv:2105.12376 (2021).
- **Link:** https://arxiv.org/abs/2105.12376
- **Key finding:** Dawkins framework: replication, variation, selection. Measures image meme evolution.
- **Implication for this plugin:** Fixed phrasing + new slots = variation on replicating template. Explains why familiar templates carry new facts well.

### A hybrid marketplace of ideas

- [ ] Verify
- **Citation:** arXiv:2501.02132 (2025).
- **Link:** https://arxiv.org/abs/2501.02132
- **Key finding:** AI agents generate and spread memes as cultural agents. Virality-optimized platforms favor spread over substance.
- **Implication for this plugin:** Plugin is AI meme generator. Optimize captions for fact retention, not shareability or humor alone.

### A Template Is All You Meme

- [ ] Verify
- **Citation:** arXiv:2311.06649 (2023).
- **Link:** https://arxiv.org/abs/2311.06649
- **Key finding:** Memes as instances of reusable templates; template knowledge aids understanding.
- **Implication for this plugin:** Matches pipeline (reduce caption to template, fill slots). Possible source of template data or methods.

## Seed list from issue #2 (journal articles, not on arXiv)

Not yet looked up. Add link, key finding, implication once verified.

- [ ] Schmidt (1994): humor and sentence memory.
- [ ] Banas, Dunbar, Rodriguez & Liu (2011): review of humor in educational settings.
- [ ] Kaplan & Pascoe (1977): humorous lectures and retention.
- [ ] McDaniel & Einstein (1986): bizarreness effect.
- [ ] Retrieval practice / testing effect: supports "reveal the question first" rule.
