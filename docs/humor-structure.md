# Humor structure

How humor works in text; what it means for captions. Feeds prompt design (#4).
Companion: [meme-evidence.md](meme-evidence.md).

Entry: citation, link, key finding, **implication for this plugin**.

> **Status:** findings from abstracts, excerpts and search summaries. Verify against full paper before merge (issue #2). Tick when done.

## Theory and structure

### Humor Recognition and Humor Anchor Extraction

- [ ] Verify
- **Citation:** Yang, D., Lavie, A., Dyer, C. & Hovy, E. (2015). EMNLP.
- **Link:** https://nlp.stanford.edu/~diyiy/docs/emnlp_yang_16.pdf
- **Key finding:** Four semantic structures behind humor: incongruity, ambiguity, interpersonal affect, phonetic style. Features per structure; extracts humor-trigger words.
- **Implication for this plugin:** Incongruity must land on the fact, not only the joke. Anchor extraction can check which caption words carry humor.

### General Theory of Verbal Humour

- [ ] Verify
- **Citation:** Attardo, S. & Raskin, V. (1991). *Humor* 4(3-4). Cited by several papers below.
- **Link:** Not yet located. Find original before citing.
- **Key finding:** Joke = two semantic scripts in partial parallel. Amusement from leftover elements pairing anomalously.
- **Implication for this plugin:** Candidate model for slot filling: template = shared script, facts = anomalous pairing. Untested.

### Two decades of computational humor

- [ ] Verify
- **Citation:** Cowie, R. (2023). *Humor*.
- **Link:** https://www.degruyterbrill.com/document/doi/10.1515/humor-2023-0021/html
- **Key finding:** Progress in joke generation, laughter detection, irony use. Learning methods need hard-to-get data.
- **Implication for this plugin:** Generation workable. Meme quality dataset must be built by hand.

### Story-pun jokes (University of Edinburgh)

- [ ] Verify
- **Citation:** University of Edinburgh, DAI research paper rp902.
- **Link:** https://www.dai.ed.ac.uk/daidb/papers/documents/rp902.html
- **Key finding:** Anecdote + punchline distorting well-known phrase or proverb. Proposes staged generation.
- **Implication for this plugin:** Staged generation fits pipeline: pick template, then produce twist.

## Recent computational studies (arXiv)

### Explaining Humour Style Classifications

- [ ] Verify
- **Citation:** arXiv:2501.02891 (2025).
- **Link:** https://arxiv.org/abs/2501.02891
- **Key finding:** LIME explains humor-style classifier. Feature groups: linguistic (puns, WordNet synsets, POS), affective, contrast.
- **Implication for this plugin:** Three groups usable as checklist for judging generated captions.

### When Jokes Cross the Line: Regular and Dark Humor in YouTube Shorts

- [ ] Verify
- **Citation:** arXiv:2606.00046 (2026).
- **Link:** https://arxiv.org/abs/2606.00046
- **Key finding:** Dark humor: more negative or mixed sentiment, more toxicity, stronger anger, disgust, fear.
- **Implication for this plugin:** Keep default tone away from dark humor; reactions to same fact change.

### Who Laughs with Whom?

- [ ] Verify
- **Citation:** arXiv:2601.03103 (2026).
- **Link:** https://arxiv.org/abs/2601.03103
- **Key finding:** Humor preferences differ across user clusters. LLM ratings resemble some clusters.
- **Implication for this plugin:** No single "funny" standard. Consider tone setting; LLM judges may be biased.

### Not Human, Funnier: AI Stand-up Comedy

- [ ] Verify
- **Citation:** arXiv:2602.12763 (2026).
- **Link:** https://arxiv.org/abs/2602.12763
- **Key finding:** 50 stand-up videos: irony (117), exaggeration (83), absurdity (57) most common. Puns rare (7).
- **Implication for this plugin:** Exaggeration and absurdity suit captions. Puns unlikely main tool.

### Computational Humor with Multimodal LLMs

- [ ] Verify
- **Citation:** arXiv:2607.19011 (2026).
- **Link:** https://arxiv.org/abs/2607.19011
- **Key finding:** Reasoning-oriented multimodal models don't consistently understand humor better.
- **Implication for this plugin:** Stronger reasoning model ≠ funnier captions. Test caption quality directly.
