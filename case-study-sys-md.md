# Case Study: MIND applied to personal long-term memory (sys.md)

> [!NOTE]
> MIND was designed for network-level node discovery (`llms.json`). This case
> study documents applying the same technique — pre-built indexes shipped with
> the data, filter-per-axis-then-read-only-matches — to a single person's
> long-term memory store instead of a network of nodes.

**Host system:** [SaveYourSoul SYS](https://sys.uxprojects-jok.com) — the soul
file `sys.md` carries a crystallized long-term memory block (`LONGMEM`:
facts/memories/ideas/learnings), periodically distilled from raw conversation
history by a background process ("the Archivist").

**Status:** Implemented and verified against real production data (2026-07-04).

---

## Motivation

Two problems were found before this work started, both concrete, not
hypothetical:

1. **A background "Archivist" process fed itself broken context.** Four
   autonomous reflection triggers built their Claude prompt with
   `soul.replace(frontmatter, '').slice(0, 800)` — a positional slice of the
   raw document. Since the crystallized memory block sits immediately after
   the frontmatter, this slice landed **entirely inside raw LONGMEM JSON** —
   the reflection prompts were literally fed `{"id": "name_birth", "cat":
   "identity", ...}` instead of prose. Verified live against a real soul file
   before any fix was applied.
2. **No consumer could query selectively.** The primary "read everything"
   tool (`soul_read`) always returned the full raw document. Any AI reading
   it — an autonomous agent, a voice assistant, a chat session — had to load
   everything and search itself. Exactly the flat-list problem MIND's README
   describes for network discovery, just one layer down.

## The 3D mapping

LONGMEM's own fields turned out to map cleanly onto MIND's three axes without
inventing anything new:

| MIND (network) | LONGMEM (personal memory) | Axis |
|---|---|---|
| `y_tags` — tag → node indices, O(1) | `facts[].cat` (identity/values/personality/project) → fact indices | **Y** |
| `x_price` — ascending, binary-searchable | `facts[].score` (1–5 relevance) → score-sorted indices | **X** |
| `z_status` / `z_anchors` — bucket + recency | `ideas[].status` bucket, `memories[].date` recency | **Z** |

A persistent index block (`MINDIDX`, mirroring `LONGMEM`'s own marker
convention) is built from these three axes and stored directly inside
`sys.md`, right after the data it describes — same principle as `llms.json`
shipping index and data in one file, not index-here/data-there.

```json
{
  "_v": 1,
  "based_on_updated": "2026-07-04",
  "facts":     { "y_cat": { "identity": [0,1,10], "project": [2,7,15] }, "x_score_desc": [0,1,3,4,7,...] },
  "memories":  { "z_recent": [21,22,23,24,15,...] },
  "ideas":     { "z_status": { "planned": [...], "idea": [...] } },
  "learnings": { "y_cat": { "arch": [...], "tech": [...], "personal": [...] } }
}
```

### One deliberate scope boundary

Not everything in `sys.md` got indexed. The file has three distinct layers,
and only one is a good fit:

| Layer | Example | MIND treatment |
|---|---|---|
| **Long-term store** | LONGMEM (facts/memories/ideas/learnings) | **indexed** — stable, categorized, scored |
| **Conversation store** | Peer/Agent sandbox blocks | left untouched — inherently sequential, not a lookup structure |
| **Short-term/staging store** | raw core sections pre-crystallization | left untouched — transient, gets folded into LONGMEM anyway |

## Design decisions carried over from MIND's own documented findings

- **Lazy, fault-tolerant maintenance.** Only the crystallization process
  builds and persists the index (mirrors MIND's own generator model — nodes
  don't maintain the index, a separate process does). Every reader treats a
  missing or stale index (`based_on_updated` mismatch) as a fast-path miss,
  not a hard error, and transparently rebuilds it in memory from the
  already-persisted LONGMEM data. No forced migration for existing files —
  the index appears the next time real crystallization happens.
- **Never return raw index structures to an AI.** This directly follows from
  MIND's own **Issue #1/#2** (documented in `spec.md`): agents shown a raw
  index either ignore it and fall back to linear scanning, or misinterpret it
  and invent non-existent fields. Every query result here is formatted as
  plain bullet text before it ever reaches a model — the index is an internal
  resolution structure, never a payload.
- **"Don't guess" has to be anchored twice.** MIND's own validation found that
  an embedded hint alone (`_hint.query`) is not reliably followed without
  explicit reinforcement in the calling prompt. The new query tool therefore
  states "do not guess, say so explicitly if nothing matches" directly in its
  tool description — not only implicitly in the data.

## Implementation

- `buildLongmemIndex` / `updateLongmemIndex` / `extractLongmemIndex` /
  `queryLongmem` — index construction, persistence, and the Y∩X∩Z query
  resolver. Query results are always plain text, never raw JSON.
- The four autonomous reflection triggers now call `queryLongmem` with a
  purpose-specific filter (e.g. top-scored identity/value facts for a
  "silence" reflection, project-category facts for an external-agent
  contact) instead of the positional slice.
- The primary "read everything" tool gets a compact index digest
  (top-scored facts + most recent memories) prepended ahead of the full raw
  content — every existing caller benefits immediately, nothing is removed.
- A new, narrower query tool was added for **targeted follow-up questions
  mid-conversation** — deliberately *not* a replacement for the "read
  everything" entry point, since that one's usage is already guaranteed by
  its own calling convention and adoption of a second tool can't be assumed
  (again, MIND's own Issue #1).
- A separate self-chat persona prompt builder already extracted and
  score-sorted `facts` before this work — good instinct, but incomplete
  (memories/ideas/learnings were missing) and had a bug: the raw LONGMEM
  block was being sent to the model **twice** — once formatted, once as part
  of the untouched raw document appended right after it. Both are fixed:
  full coverage of all four LONGMEM categories, and the raw block is now
  stripped from the appended document.

## Tool test results

Run against a real, in-production LONGMEM (18 facts / 26 memories / 5 ideas /
23 learnings at time of testing):

| Query | Result |
|---|---|
| `{dimension:'facts', x_minScore:4, limit:5}` | Top 5 facts by relevance, correctly score-ordered |
| `{dimension:'facts', y_cat:['identity','values']}` | Only identity+values facts, others correctly excluded |
| `{dimension:'facts', y_cat:'project'}` | Only project-category facts |
| `{dimension:'ideas', z_status:'planned'}` | Only planned ideas, `done` ideas correctly excluded |
| `{dimension:'ideas', z_status:'done'}` (no done ideas exist) | Empty result + explicit "nothing found, don't guess" message — not a fabricated answer |
| `{dimension:'facts', y_cat:'nonexistent_category'}` | Same explicit-empty behavior |
| Index round-trip (build → persist → re-extract) | Byte-identical |
| Index persisted across two consecutive crystallization passes | Exactly one `MINDIDX` block each time — no duplication |

## Before / after — real production evidence

**Autonomous reflection trigger context** (what the "Archivist" actually sent
to Claude), same live soul file, before and after:

```
BEFORE:
<!-- SYS:LONGMEM:START -->
{
"v": 1,
"updated": "2026-06-20",
"facts": [
{
"id": "name_birth",
...

AFTER:
- [identity] <redacted — real name/birth fact>
- [identity] <redacted — real family fact>
- [values] Authenticity over perfection; self-determination over conformity
- [values] Conviction: the internet needed an identity layer as a basic right
- [project] <redacted — real project fact>
```

**A related, independently-discovered bug** surfaced while auditing every
consumer of this data: a maturity/completeness score derived from the *raw*
core sections scored **0 out of 20** on the "depth" pillar for a soul that had
already crystallized 18 facts and 26 memories — because those sections get
emptied once their content moves into LONGMEM, and the scorer didn't know
LONGMEM existed. Fixed by crediting an aggregate LONGMEM-depth bonus instead
of attempting to re-attribute facts back to specific original sections
(facts only carry a category, not their original heading — a fabricated
mapping would itself have been a form of "guessing"). Same live file, same
before/after: **0/20 → 20/20**.

**Live confirmation via the product's own UI**, not a test script: clicking
"Clean up now" in the app's Archivist settings panel (which triggers the same
crystallization pass) on the real production soul produced:

| | Before | After |
|---|---|---|
| Last cleanup | 2026-06-20 | 2026-07-04 |
| Facts | 18 | 21 |
| Size | 37.1 KB | 41.2 KB |
| `MINDIDX` block present | no | **yes** |
| Index `based_on_updated` | — | matches `LONGMEM.updated` exactly |

## Honest calibration

At the current scale (~20–25 entries per category), the O(1)/O(log n) vs.
O(n) computational difference is imperceptible — sorting or filtering twenty
items costs microseconds regardless of method. The real, measurable value
here is:

1. **Correctness, not speed.** The reflection-trigger bug existed *because*
   there was no structured access path — a positional slice was standing in
   for one. The fix isn't "faster," it's "no longer wrong."
2. **Token cost only drops where raw structured data previously reached the
   model.** The reflection triggers send roughly the same character count as
   before — but where it used to be 0% usable signal (JSON syntax), it's now
   ~100% (real facts). The one place where a real token reduction is
   measurable is the "read everything" entry point *if and only if* a caller
   is later steered toward the narrower query tool instead of always reading
   the full document — adoption is not automatic (see MIND's own
   Issue #1/#2 finding, reproduced here).
3. **The index's real payoff is structural, not immediate.** It makes
   personal long-term memory queryable by an external agent the same way a
   network of nodes is — a capability that didn't exist before, independent
   of how fast it resolves at today's data volume.

## Deliberately out of scope (for now)

- A document-level position index (avoiding repeated full-document
  re-parsing during crystallization itself) — a write-path performance
  concern, unrelated to the read-path index documented here.
- Tuple/decoder-ring compaction of facts/memories (MIND's own `_keys` +
  compact-array pattern) — only pays off once a size-bounding consolidation
  pass exists for `ideas`/`learnings` (which currently grow unbounded,
  unlike `facts`, which already has one).
