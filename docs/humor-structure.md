# Humor structure

How humor works in text; what it means for captions. Feeds prompt design (#4).
Companion: [meme-evidence.md](meme-evidence.md).

Entry: citation, link, key finding, **implication for this plugin**.

> **Status:** record checked against abstracts or listings. Full texts not read. Claims marked NOT-FOUND were not in the abstract and need the full paper. Tick when verified against the full text.

## Theory and structure

### Humor Recognition and Humor Anchor Extraction

- [ ] Verify
- **Citation:** Yang, D., Lavie, A., Dyer, C. & Hovy, E. (2015). EMNLP, pp. 2367–2376. DOI 10.18653/v1/D15-1284.
- **Link:** [aclanthology.org/D15-1284](https://aclanthology.org/D15-1284/)
- **Key finding:** four latent semantic structures behind humor (incongruity, ambiguity, interpersonal effect, phonetic style). Features per structure. Extracts "humor anchors", minimal word spans that enable humor.
- **Implication for this plugin:** caption needs incongruity landing on the fact, not only the joke. Anchors can show which caption words carry the humor.

### General Theory of Verbal Humour

- [ ] Verify
- **Citation:** Attardo, S. & Raskin, V. (1991). "Script theory revis(it)ed: Joke similarity and joke representation model." *Humor* 4(3/4), 293–347.
- **Link:** [doi.org/10.1515/humr.1991.4.3-4.293](https://doi.org/10.1515/humr.1991.4.3-4.293)
- **Note:** "General Theory of Verbal Humor" is the theory's name, introduced in this paper. Not the article title.
- **Key finding:** joke = two scripts in partial parallel; amusement from leftover elements pairing anomalously. Claim NOT-FOUND in the record; full text needed.
- **Implication for this plugin:** candidate model for slot filling: template = shared script, facts = anomalous pairing. Untested.

### Computational research and the case for taking humor seriously

- [ ] Verify
- **Citation:** Cowie, R. (2023). *Humor* 36(2), 207–223. DOI 10.1515/humor-2023-0021.
- **Link:** [doi.org/10.1515/humor-2023-0021](https://doi.org/10.1515/humor-2023-0021)
- **Key finding:** progress in systems that make jokes, detect and generate laughter, and use irony. Learning techniques need data that is hard to supply. Confirmed in abstract.
- **Implication for this plugin:** generation is workable. A meme quality dataset must be built by hand.

### Towards a model of story puns

- [ ] Verify
- **Citation:** Binsted, K. & Ritchie, G. D. (1997). "Towards a model of story puns." *Humor*.
- **Link:** [dai.ed.ac.uk rp902](https://www.dai.ed.ac.uk/papers/documents/rp902.html) (University of Edinburgh DAI research paper)
- **Key finding:** story-pun jokes: an anecdote followed by a punchline that distorts a familiar phrase or proverb. Generation proposed in stages.
- **Implication for this plugin:** staged generation fits the pipeline: pick template, then produce the twist.

## Recent computational studies (arXiv)

### Explaining Humour Style Classifications

- [ ] Verify
- **Citation:** Kenneth, M. O., Khosmood, F. & Edalat, A. (2025). arXiv:2501.02891.
- **Link:** [arxiv.org/abs/2501.02891](https://arxiv.org/abs/2501.02891)
- **Key finding:** abstract mentions linguistic, emotional and semantic features. **NOT-FOUND:** the LIME method and the puns / WordNet / POS / contrast groups are not in the abstract.
- **Implication for this plugin:** feature groups usable as a caption checklist, once the full text confirms them.

### When Jokes Cross the Line: Regular and Dark Humor in YouTube Shorts

- [ ] Verify
- **Citation:** Johns, S., Parthasarathy, S., Bhalla, S. & Garg, V. (2026). arXiv:2606.00046.
- **Link:** [arxiv.org/abs/2606.00046](https://arxiv.org/abs/2606.00046)
- **Key finding:** dark humor draws more mixed, neutral and sometimes more toxic reactions. **NOT-FOUND:** anger, disgust and fear claim is not in the abstract.
- **Implication for this plugin:** keep the default tone away from dark humor; reactions to the same fact change.

### Who Laughs with Whom?

- [ ] Verify
- **Citation:** Murakami, Kamigaito, Takamura & Okumura (2026). arXiv:2601.03103.
- **Link:** [arxiv.org/abs/2601.03103](https://arxiv.org/abs/2601.03103)
- **Key finding:** user clusters show distinct preference patterns (Oogiri user votes). LLM results can resemble some clusters. Confirmed in abstract.
- **Implication for this plugin:** no single "funny" standard. Consider a tone setting; LLM judges may be biased.

### "Not Human, Funnier": How Machine Identity Shapes Humor Perception in Online AI Stand-up Comedy

- [ ] Verify
- **Citation:** arXiv:2602.12763 (2026).
- **Link:** [arxiv.org/abs/2602.12763](https://arxiv.org/abs/2602.12763)
- **Key finding:** machine identity shapes how humor is perceived (N = 32 audience). **NOT-FOUND:** the counts (irony 117, exaggeration 83, absurdity 57, puns 7) are not in the abstract. Full text needed.
- **Implication for this plugin:** perception depends on whether the audience knows the source is a machine. Test caption humor with and without that label.

### Computational Humor with Multimodal LLMs

- [ ] Verify
- **Citation:** Liang, T., Hu, Z., Liu, D., Li, J. & Yin, Y. (2026). arXiv:2607.19011.
- **Link:** [arxiv.org/abs/2607.19011](https://arxiv.org/abs/2607.19011)
- **Key finding:** survey, not an experiment. **NOT-FOUND:** the claim that reasoning-oriented models do not consistently improve humor understanding is not in the abstract.
- **Implication for this plugin:** do not assume a stronger reasoning model writes funnier captions. Test caption quality directly.
