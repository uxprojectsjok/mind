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

## Versioning

`_v` increments only on breaking changes to the format. Additive fields (new index dimensions) are non-breaking.

---

## Reference implementation

`generate-llms-json.mjs` — Node.js script included in this repository.  
Runs as a cron job, writes `/llms.json` to the static webroot every 10 minutes.

**No server required.** The output is a static file.

---

## Live network

- **Directory:** https://sys.uxprojects-jok.com/llms.json
- **Spec page:** https://sys.uxprojects-jok.com/mind
- **Protocol:** [SaveYourSoul SYS](https://sys.uxprojects-jok.com)

---

## License

Apache 2.0 · © 2026 Jan-Oliver Karo · UX-Projects
