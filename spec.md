# MIND v1
## Multi-dimensional Index for Node Discovery

**Spec URL:** https://sys.uxprojects-jok.com/mind  
**File:** `GET /llms.json`  
**Live reference:** https://sys.uxprojects-jok.com/llms.json  
**Status:** Draft · v1.0

---

## What is MIND?

MIND is a JSON format for machine-readable discovery of decentralized AI nodes. It extends the [llms.txt](https://llmstxt.org) convention with a **pre-built multi-dimensional index** — enabling AI agents to find the right node in O(log n) instead of scanning the entire list.

A single `GET /llms.json` gives an AI agent the full network, queryable without a search API, without HTML parsing, without a database.

---

## Why not a flat list?

Existing formats (ARD, agents.json, agent-card.json) return flat lists. At 100 nodes this is fine. At 100,000 nodes an AI agent downloading and scanning a 30 MB JSON to find nodes with `tag=dev` and `price < 0.01 POL` is not.

MIND solves this by shipping the index with the data:

| Scale | Flat list O(N) | MIND O(log N) |
|-------|---------------|---------------|
| 100 nodes | ~1 ms | ~0.1 ms |
| 10,000 nodes | ~50 ms | ~1 ms |
| 1,000,000 nodes | ~5,000 ms | ~10 ms |

The real gain: with MIND's tiered design, an agent downloads only the index (small), binary-searches locally, then fetches only the matching nodes — **0.001% of the data instead of 100%**.

---

## Overview — 3D Index Space

```
╔══════════════════════════════════════════════════════════════════════╗
║          MIND v1 · Multi-dimensional Index for Node Discovery        ║
╚══════════════════════════════════════════════════════════════════════╝

  Y (tags)
  │
  │  dev ──── [0, 3, 7] ──────────────────────── ●(7) ●(3)
  │  ai  ──── [0, 1, 5] ──────────────── ●(5)         ●(0)
  │  mus ──── [4, 6]    ────── ●(4) ●(6)
  │  hlth ─── [2]       ── ●(2)
  │                                                         ▲ O(1)
  └──────────────────────────────────────────────────────── X (price)
  ╱  free        0.001    0.01      0.1       0.5    1.0 POL
 ╱   [1,4]        │        │         │         │      │   ▲ O(log n)
Z                 │        │         │         │      │
│  on  [0,3,5,7] ●         ●         ●                    ▲ O(1)
│  off [1,2,4,6]      ●         ●         ●
│
└── anchors asc: [1, 3, 7, 12, 22]   ▲ O(log n)
    idx:         [4, 1, 6,  2,  0]

──────────────────────────────────────────────────────────────────────

  llms.json
  │
  ├── _v      : 1
  ├── _spec   : "https://sys.uxprojects-jok.com/mind"
  ├── _ts     : 1751563686
  │
  ├── _keys   : ["id","name","mcp","status","anchors","tags","price","wallet",...]
  │              └─ decoder ring — defined once, used N times
  │
  ├── _tags   : ["dev","ai","marburg","music","health",...]
  │              └─ tag vocabulary — indices instead of strings in _souls
  │
  ├── _souls  : sorted by last_anchor_ts DESC (freshest first)
  │   ├── [0] ["2c81aa74","Jan",  "https://me.../mcp",  1, 22, [0,2,3], 0.004, "0xabc"]
  │   ├── [1] ["6a019abc","Till", "https://till.../mcp", 0,  3, [3],    0.001, "0xdef"]
  │   ├── [2] ["eb10a04d","Test", "https://test.../mcp", 1,  7, [0,1],  0.010, "0xghi"]
  │   └── ...  └── tag indices → _tags[0]="dev", _tags[2]="marburg"
  │
  ├── x_price ─── X axis ───────────────────────────────── O(log n)
  │   ├── free : [1]                   ← price === 0
  │   ├── asc  : [0.001, 0.004, 0.010] ← ascending sorted
  │   └── idx  : [1,     0,     2    ] ← → _souls[idx]
  │
  ├── y_tags ──── Y axis ───────────────────────────────── O(1)
  │   ├── "dev"    : [0, 2]            ← soul indices, anchor-count DESC
  │   ├── "ai"     : [0, 2]
  │   ├── "marburg": [0]
  │   └── "music"  : [1]
  │
  ├── z_status ── Z axis (bucket) ─────────────────────── O(1)
  │   ├── on  : [0, 2]
  │   └── off : [1]
  │
  └── z_anchors ─ Z axis (sort) ──────────────────────── O(log n)
      ├── asc : [3,  7,  22]
      └── idx : [1,  2,   0]

──────────────────────────────────────────────────────────────────────

  QUERY: tag=dev AND status=on AND price < 0.01 POL

  y_tags["dev"]  → {0, 2}          O(1)
  z_status["on"] → {0, 2}          O(1)
  x_price < 0.01 → binary search   O(log n)  → {0, 2}

  Intersection   → {0, 2}          ← only these _souls entries read
  Result         → Jan (#0), Test (#2)
```

---

## Format

```json
{
  "_v": 1,
  "_spec": "https://sys.uxprojects-jok.com/mind",
  "_ts": 1751563686,
  "_keys": ["id","name","mcp","status","anchors","tags","price","wallet","description","llms_url","chain_verified","visibility"],
  "_tags": ["dev","ai","marburg","music"],

  "_souls": [
    ["2c81aa74-...","Jan","https://node.example.com/mcp",1,22,[0,2],0.004,"0xabc...","Developer","https://node.example.com/llms.txt",1,"discoverable"],
    ["6a019abc-...","Till","https://till.example.com/mcp",0,3,[3],0.0,"","","https://till.example.com/llms.txt",1,"fading"]
  ],

  "x_price": {
    "free": [1],
    "asc":  [0.004],
    "idx":  [0]
  },

  "y_tags": {
    "dev":     [0],
    "ai":      [0],
    "marburg": [0],
    "music":   [1]
  },

  "z_status": {
    "on":  [0],
    "off": [1]
  },

  "z_anchors": {
    "asc": [3, 22],
    "idx": [1, 0]
  }
}
```

---

## Fields

### Root

| Field | Type | Description |
|-------|------|-------------|
| `_v` | integer | Format version (currently `1`) |
| `_spec` | string | URL of this specification |
| `_ts` | integer | Unix timestamp of last update |
| `_keys` | string[] | Field names for each soul tuple (decoder ring) |
| `_tags` | string[] | All unique tags in the network (decoder ring) |
| `_souls` | array[] | Soul data as compact tuples |

### Soul tuple (`_souls[i]`)

Ordered by `_keys`. Fields:

| Key | Type | Description |
|-----|------|-------------|
| `id` | string | UUID v4 — globally unique soul identifier |
| `name` | string | Human name |
| `mcp` | string | MCP endpoint URL |
| `status` | 0\|1 | `1` = online, `0` = offline |
| `anchors` | integer | Total on-chain anchor count (trust signal) |
| `tags` | integer[] | Indices into `_tags` array |
| `price` | number | POL per request (0 = free) |
| `wallet` | string | Polygon wallet address |
| `description` | string | Short description |
| `llms_url` | string | `{origin}/llms.txt` |
| `chain_verified` | 0\|1 | `1` = discovered from blockchain anchor event |
| `visibility` | string | `discoverable` \| `fading` \| `invisible` |

### `_souls` sort order

Base array sorted by last anchor timestamp descending — freshest (most likely reachable) first. Use index dimensions for other sort orders.

### `x_price` — price index

| Field | Type | Description |
|-------|------|-------------|
| `free` | integer[] | Indices of souls with `price === 0` |
| `asc` | number[] | Ascending paid prices |
| `idx` | integer[] | Soul index for each price in `asc` |

**Binary search** `x_price.asc` to find the price range, then read `x_price.idx` for the soul indices.

### `y_tags` — tag inverted index

```
y_tags[tagName] → integer[]  (soul indices, sorted by anchor count desc)
```

O(1) tag lookup. Within each tag, higher anchor count = more established soul first.

### `z_status` — online/offline buckets

```
z_status.on  → integer[]  (online soul indices)
z_status.off → integer[]  (offline soul indices)
```

### `z_anchors` — anchor count index

| Field | Type | Description |
|-------|------|-------------|
| `asc` | integer[] | Ascending anchor counts |
| `idx` | integer[] | Soul index for each anchor count |

Low anchor count = new node. High = established, trusted.

---

## Search algorithm

An agent queries MIND by intersecting index dimensions. Each dimension reduces the candidate set independently — the intersection of small sets is always faster than scanning the full list.

**Step 1 — collect candidates per dimension**

For each filter in the query, read exactly one index entry:
- Tag filter → look up `y_tags[tagName]` → list of soul indices. One hash-map lookup, O(1).
- Status filter → look up `z_status["on"]` or `z_status["off"]` → list of indices. O(1).
- Price range → binary search `x_price.asc` for the boundary price, read the slice of `x_price.idx` up to that position. O(log n). Add `x_price.free` if free souls are wanted.
- Anchor range → binary search `z_anchors.asc` the same way. O(log n).

No dimension filter = skip that step entirely.

**Step 2 — intersect**

Convert each candidate list to a Set, then intersect. Start with the smallest set to minimize iterations. The result is a handful of indices even across millions of souls.

**Step 3 — read matches**

Index into `_souls` only for the surviving indices. Decode tuples using `_keys` as the decoder ring and `_tags` for tag index resolution. No full array scan ever happens.

**Cost summary:** One GET request + O(1) per tag/status filter + O(log n) per price/anchor filter + O(k) for the intersection where k is the size of the smallest candidate set.

---

## Deletion algorithm

MIND has no explicit delete operation. Removal is **passive and time-based**.

**Passive fade (default)**

Every soul carries a `last_anchor_ts` — the Unix timestamp of its most recent on-chain anchor event. The cron generator reads this timestamp on each run and applies the visibility zone:

- Last anchor < 11 days ago → `discoverable` — included in `_souls` and all indexes.
- Last anchor 11–22 days ago → `fading` — included with `visibility: "fading"`, status forced to `0`.
- Last anchor > 22 days ago → `invisible` — completely excluded from output.

A node that simply goes offline and stops anchoring disappears from the network automatically within 22 days. No deregistration call needed, no central authority involved.

**Active opt-out**

A node operator sets `public_listing: false` in the node's soul config. The generator checks this flag during the BFS fetch step and skips the soul entirely, regardless of anchor age. Effective on the next cron cycle (max 10 min delay).

**Immutability note**

Nothing is deleted from the blockchain. The Polygon anchor events are permanent. MIND's deletion is purely at the index layer — the generator decides what to include in the static output file. The on-chain history remains auditable forever.

---

## Recommended agent prompt

AI agents default to O(n) iteration when filtering JSON, even when pre-built indexes are present. To get correct O(log n) behaviour, instruct the agent explicitly.

**Minimal prompt:**

```
Fetch https://your-mind-server.com/llms.json and find all nodes
with tag="dev", status=online, price < 0.01. Use the pre-built
indexes (y_tags, z_status, x_price) — do not iterate _souls linearly.
```

**Full prompt for complex queries:**

```
Fetch https://your-mind-server.com/llms.json — this is a MIND v1 index.
Read _hint.query_example for the correct query algorithm.
Find all nodes matching: tag="dev", status=online, price < 0.01 POL.
Use y_tags for tag lookup (O(1)), z_status for status (O(1)),
x_price.asc + x_price.idx for price range (binary search).
Intersect the result sets. Return name, price and mcp for each match.
```

**What _hint provides:**

The `_hint` field in every MIND file contains:
- `query` — plain language description of the query strategy
- `query_example` — concrete JavaScript pseudocode for the intersection algorithm
- `decode` — how to read soul tuples and resolve tag indices
- `update` — cache behaviour

An agent that reads `_hint.query_example` before writing query code will produce O(log n) queries. An agent prompted to "derive the format" without reading `_hint` will default to O(n) iteration — functionally correct but inefficient at scale.

**Validation results (Claude, 2026-07-03):**

| Test | Result |
|------|--------|
| Cold format derivation + Python query | O(n) loop — _hint not applied to code |
| "Return all online nodes" | ✓ used z_status.on directly |
| "Compare MIND vs llms.txt" | ✓ cited x_price.asc[0] for cheapest node |
| "Add node with correct indexes" | ~ correct x_price + z_status, missing y_tags + z_anchors |

Conclusion: explicit prompting + `_hint` reference produces correct index usage. Cold derivation without prompt guidance falls back to linear scan.

---

## Query examples

### "Find souls with tag 'dev', status on, price < 0.01 POL"

```javascript
const mind = await fetch('/llms.json').then(r => r.json())

// 1. tag filter — O(1)
const devIdx = new Set(mind.y_tags['dev'] ?? [])

// 2. status filter — O(1)
const onIdx  = new Set(mind.z_status.on)

// 3. price filter — binary search O(log n)
const maxPrice = 0.01
const priceIdx = new Set()
for (let i = 0; i < mind.x_price.asc.length; i++) {
  if (mind.x_price.asc[i] <= maxPrice) priceIdx.add(mind.x_price.idx[i])
}
mind.x_price.free.forEach(i => priceIdx.add(i))

// 4. intersection
const matching = [...devIdx].filter(i => onIdx.has(i) && priceIdx.has(i))

// 5. fetch soul data
const decoder = mind._keys
const souls = matching.map(i => {
  const t = mind._souls[i]
  return Object.fromEntries(decoder.map((k, j) => [k, j === 5 ? t[j].map(ti => mind._tags[ti]) : t[j]]))
})
```

---

## Deregistration

MIND uses **passive deregistration** — no explicit opt-out needed:

- Nodes that stop anchoring fade from the network automatically via the visibility zone:
  - `< 11 days` since last anchor → `discoverable`
  - `11–22 days` → `fading`
  - `> 22 days` → `invisible` (not included in output)
- For active opt-out: set `public_listing: false` in node config — the generator skips the soul.

---

## Discovery mechanism (SYS implementation)

The SYS reference implementation discovers nodes from the Polygon blockchain:

1. Read `Anchored` events from SYS smart contract via Etherscan V2 API
2. Batch-fetch TX calldata to extract `\x00SYS1\x00` markers
3. Parse `{id, mcp, name?, tags?, cid?}` from calldata
4. BFS: fetch live data from each `mcp` origin via `/api/soul/scan`
5. IPFS enrichment via `cid` field if present

This makes discovery fully autonomous — no central registry, no DNS, no seed server required.

---

## CORS

Implementations MUST serve `llms.json` with:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Content-Type: application/json; charset=utf-8
```

AI agents run in browser contexts and require CORS to fetch cross-origin.

---

## Architecture modes

MIND supports two fundamentally different architectures. The format (`_keys`, `_tags`, `_souls`, indexes) is identical in both — only the source of truth differs.

---

### Mode A — Index (distributed)

`llms.json` is a mirror. The truth lives in the nodes themselves.

```
  Node A  ──┐
  Node B  ──┤── Generator (cron) ──► llms.json   ◄── Agent reads
  Node C  ──┘
```

- Each node hosts its own data at a stable URL (e.g. `https://node.example/node.json`)
- The generator crawls all known node URLs periodically and rebuilds `llms.json`
- A node controls its own data — updating `node.json` is enough to change what appears in the index
- `llms.json` is ephemeral: regenerated on every cron run, safe to delete and rebuild

**Operations:**

| Operation | How |
|-----------|-----|
| Read | `GET /llms.json` — query locally |
| Write | Publish `node.json` at your URL, submit URL to operator |
| Modify | Update `node.json` — reflected on next generator run |
| Delete (passive) | Go offline — generator skips unreachable nodes after N days |
| Delete (active) | Set `"listed": false` in `node.json` — generator skips immediately |

---

### Mode B — Store (centralised)

`llms.json` is the truth. There are no external source URLs.

```
  Agent ──► POST /mind/nodes  ──► internal store
                                       │
                               Generator (on write)
                                       │
                                  llms.json   ◄── Agent reads
```

- The MIND operator runs a write API in front of the generator
- Nodes push their data to the API instead of hosting it themselves
- The generator reads from the internal store and produces `llms.json`
- Authentication is the operator's responsibility (API key, OAuth, signature, etc.)

**Operations:**

| Operation | How |
|-----------|-----|
| Read | `GET /llms.json` — query locally |
| Write | `POST /mind/nodes` `{ id, name, mcp, tags, price, ... }` |
| Modify | `PUT /mind/nodes/{id}` — full replace; or `PATCH` for partial update |
| Delete | `DELETE /mind/nodes/{id}` — removed on next generation |

**When to use Mode B**

- No distributed infrastructure — operator controls all entries
- Need strict authentication on writes
- Nodes cannot self-host a `node.json` endpoint
- MIND used as a general-purpose indexed data store for any entity type (products, events, locations — not only AI nodes)

---

### Mode A vs Mode B

| | Mode A — Index | Mode B — Store |
|---|---|---|
| Source of truth | Distributed nodes | Central store |
| Write path | Node updates own URL | Node calls write API |
| `llms.json` | Ephemeral mirror | Authoritative output |
| Auth | None (operator crawls public URLs) | Required (operator-defined) |
| Operator control | Low — nodes own their data | High — operator owns all data |
| Suitable for | Open decentralised networks | Curated directories, private networks |

Both modes produce identical `llms.json` output. A consumer cannot tell which mode generated a file.

---

## Versioning

`_v` increments only on breaking changes to the format. Additive fields (new index dimensions) are non-breaking.

---

## Reference implementation

`generate-llms-json.mjs` — Node.js script included in this repository.  
Runs as a cron job, writes `/llms.json` to the static webroot every 10 minutes.

**No server required.** The output is a static file.

---

## Open issues

### Issue #1 — AI agents ignore pre-built indexes

**Observed:** When an AI agent (Claude, GPT-4) is given a MIND file without prior knowledge of the format, it correctly parses `_keys`, `_tags` and `_souls` but defaults to O(n) iteration over `_souls` instead of using the pre-built index dimensions (`x_price`, `y_tags`, `z_status`, `z_anchors`).

**Root cause:** The purpose of the index fields is not self-evident from field names alone. An agent discovering the format cold has no signal that `x_price.asc` + `x_price.idx` are a parallel binary-search pair, or that `y_tags` is an inverted index ready for O(1) lookup.

**Proposed fix — `_hint` field (v1.1)**

Add an optional `_hint` object to the root that describes the query strategy in plain language:

```json
"_hint": {
  "query": "To filter souls: use y_tags[tag] for O(1) tag lookup, z_status.on/off for status, binary search x_price.asc for price range (parallel array x_price.idx maps to _souls index), binary search z_anchors.asc for anchor range. Intersect result sets. Read only matching _souls entries.",
  "decode": "Each _souls entry is an array ordered by _keys. Tags field contains integer indices into _tags array.",
  "update": "File regenerated every 10 minutes. Cache with max-age=600."
}
```

This gives any agent — regardless of prior MIND knowledge — the exact query strategy in one read. The cost is minimal (~40 tokens). The benefit is correct O(log n) queries instead of O(n) fallback scans.

**Status:** Proposed for v1.1. Not yet in the format.

---

### Issue #2 — Index structure not reconstructed correctly by agents

**Observed:** When asked to add a node and return the updated file with correct indexes, Claude produced `_tags_map` (non-existent field) and omitted `y_tags`, `z_status` and `z_anchors` entirely.

**Root cause:** Agents understand the data layer (_keys/_tags/_souls) intuitively but the index layer requires explicit knowledge of each dimension's structure. Without documentation loaded into context, agents invent plausible-looking but wrong field names.

**Proposed fix:** The `_hint` field from Issue #1 partially addresses this. A secondary fix is a `_schema` URL pointing to this spec — giving agents a fetch target if they need to understand the full index structure before writing.

```json
"_schema": "https://raw.githubusercontent.com/uxprojectsjok/mind/main/spec.md"
```

**Status:** Proposed for v1.1. Not yet in the format.

---

## Live network

- **Directory:** https://sys.uxprojects-jok.com/llms.json
- **Spec page:** https://sys.uxprojects-jok.com/mind
- **Protocol:** [SaveYourSoul SYS](https://sys.uxprojects-jok.com)

---

## License

Apache 2.0 · © 2026 Jan-Oliver Karo · UX-Projects
