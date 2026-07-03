# MIND — Multi-dimensional Index for Node Discovery

> A JSON format for AI-agent-native discovery of decentralized nodes.  
> O(log n) queries. No search API. No database. One static file.

**Live:** https://sys.uxprojects-jok.com/llms.json  
**Spec:** [spec.md](spec.md)  
**Version:** v1.0 Draft  
**License:** Apache 2.0

---

## What is MIND?

MIND is an open format for publishing and discovering decentralized AI nodes — designed to be consumed directly by AI agents, not humans.

One `GET /llms.json` gives an agent the entire network: who is reachable, what they cost, what they can do. No HTML to parse. No API to call. No pagination to handle. The data arrives pre-indexed and ready to query.

MIND extends the [llms.txt](https://llmstxt.org) convention — which describes a single node to AI tools — to the **network level**: a machine-readable directory of many nodes, queryable without a server.

---

## The problem with flat lists

Every existing AI discovery format — [llms.txt](https://llmstxt.org), [ARD](https://agenticresourcediscovery.org/spec/), [agents.json](https://jsonagents.org/), [agent-card.json](https://google.github.io/A2A/) — returns a flat list. Scan it to find what you need.

This works at 100 nodes. It breaks at 100,000.

An AI agent looking for nodes with `tag=dev` and `price < 0.01 POL` must download the full list and check every entry one by one. At 1 million nodes that is 300 MB of data and 5 seconds of parsing — before the agent does anything useful.

The fix is not a faster server. The fix is shipping the **index with the data**.

---

## How MIND solves it

MIND bakes three pre-built indexes into the JSON file itself:

- **x_price** — price dimension, sorted ascending, binary-searchable
- **y_tags** — tag dimension, inverted index, O(1) lookup per tag
- **z_status / z_anchors** — status and trust dimensions, pre-bucketed

An agent filters all three dimensions locally, intersects the result sets, and reads only the matching node entries — without downloading or scanning the rest.

```
GET /llms.json  →  full index + all node data in one file

agent query: tag=dev AND price<0.01 AND status=on
  1. y_tags["dev"]   → [0, 3, 7]          O(1)
  2. z_status["on"]  → [0, 2, 7]          O(1)
  3. x_price search  → [0, 4, 7]          O(log n)
  4. intersection    → [0, 7]
  5. read _souls[0] and _souls[7]          done
```

| Scale | Flat list O(N) | MIND O(log N) |
|-------|---------------|---------------|
| 1,000 nodes | ~5 ms | ~0.2 ms |
| 10,000 nodes | ~50 ms | ~1 ms |
| 100,000 nodes | ~500 ms | ~2 ms |
| 1,000,000 nodes | ~5,000 ms | ~10 ms |

At network scale, MIND is the only approach that stays fast.

```
  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
  │        FLAT JSON (today)        │  │           MIND v1               │
  └─────────────────────────────────┘  └─────────────────────────────────┘

  GET /souls.json                       GET /llms.json
  ▼                                     ▼
  ┌─────────────────────────┐           ┌─────────────────────────┐
  │ { "souls": [            │           │ { _keys, _tags,         │
  │   { id, name, mcp,      │  300 MB   │   _souls,               │  ~5 MB
  │     status, tags,       │  ◄──────  │   x_price, y_tags,      │  ◄──────
  │     price, wallet, ... }│  1M nodes │   z_status, z_anchors } │  1M nodes
  │   { id, name, mcp, ... }│           └─────────────────────────┘
  │   ... × 1.000.000       │
  └─────────────────────────┘           ▼ Step 1 — Y axis          O(1)
                                        y_tags["dev"] → {0,3,7,21,…}
  ▼ scan entry #1    ✗ skip
  ▼ scan entry #2    ✗ skip             ▼ Step 2 — Z axis          O(1)
  ▼ scan entry #3    ✗ skip             z_status["on"] → {0,1,3,7,…}
  ▼ ...
  ▼ scan entry #7    ✓ match            ▼ Step 3 — X axis          O(log n)
  ▼ ...                                 binary search x_price.asc < 0.01
  ▼ scan entry #1.000.000               → {0, 3, 7}

        │                               ▼ Step 4 — Intersection
        │ checked: 1.000.000            {0,3,7} ∩ {0,1,3,7} ∩ {0,3,7}
        │ matched: 3                    → {0, 3, 7}
        ▼
                                        ▼ Step 5 — Read only matches
  ┌─────────────────────────┐           _souls[0], _souls[3], _souls[7]
  │  time:   ~5.000 ms      │          ┌─────────────────────────┐
  │  memory: 300 MB parsed  │          │  time:   ~10 ms         │
  │  tokens: ~2.000.000     │          │  memory: ~5 MB parsed   │
  │  server: search API     │          │  tokens: ~3.000         │
  │          required       │          │  server: none needed    │
  └─────────────────────────┘          └─────────────────────────┘
          ✗ slow · expensive                   ✓ fast · cheap · static

  NETWORK   Flat: ████████████████████████████████████████  300 MB
            MIND: █                                           5 MB   60× less

  TOKENS    Flat: ████████████████████████████████  ~2.000.000
            MIND: █                                     ~3.000    666× less
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
    ["2c81aa74-...","Jan","https://node.example.com/mcp",1,22,[0,2],0.004,"0xabc...","Developer from Marburg","https://node.example.com/llms.txt",1,"discoverable"],
    ["6a019abc-...","Till","https://till.example.com/mcp",0,3,[3],0.0,"","Music producer","https://till.example.com/llms.txt",1,"fading"]
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

**`_keys`** — field names for each soul tuple. Decode a tuple with `Object.fromEntries(_keys.map((k,i) => [k, tuple[i]]))`.

**`_tags`** — all unique tags in the network. Tag indices in soul tuples reference this array.

**`_souls`** — compact node tuples, sorted by last anchor timestamp descending (freshest first).

**`x_price`** — ascending price index. `free` lists zero-price node indices. `asc`/`idx` are parallel arrays for binary search over paid nodes.

**`y_tags`** — inverted tag index. Each tag maps to soul indices sorted by anchor count descending (most established first within each tag).

**`z_status`** — `on`/`off` buckets.

**`z_anchors`** — ascending anchor count index. Low = new node. High = established.

→ Full field reference, query examples and implementation guide in [spec.md](spec.md).

---

## 3D index space

```
  Y (tags)
  │
  │  dev ──── [0, 3, 7] ──────────────────────── ●(7) ●(3)
  │  ai  ──── [0, 1, 5] ──────────────── ●(5)         ●(0)
  │  mus ──── [4, 6]    ────── ●(4) ●(6)
  │                                                         ▲ O(1)
  └──────────────────────────────────────────────────────── X (price)
  ╱  free      0.001    0.01      0.1       0.5    1.0 POL  ▲ O(log n)
 ╱
Z   on  [0,3,5,7]  ●        ●        ●                      ▲ O(1)
    off [1,2,4,6]       ●        ●        ●
    anchors asc: [1, 3, 7, 12, 22]                          ▲ O(log n)

  llms.json
  ├── _keys   : ["id","name","mcp","status","anchors","tags","price",...]
  ├── _tags   : ["dev","ai","marburg","music",...]
  ├── _souls  : [[tuple],[tuple],...]   ← sorted by last anchor DESC
  ├── x_price : { free:[..], asc:[..], idx:[..] }
  ├── y_tags  : { "dev":[0,2], "ai":[0,2], ... }
  ├── z_status: { on:[0,2], off:[1] }
  └── z_anchors: { asc:[..], idx:[..] }
```

---

## Data flows

### Mode A — Index (distributed)

```
  ┌──────────────┐     owns      ┌─────────────┐
  │   Node A     │───────────────│  node.json  │
  │ node-a.com   │               │  {id, name, │
  └──────────────┘               │   tags, ... }│
                                 └──────┬───────┘
  ┌──────────────┐     owns             │ public URL
  │   Node B     │───────────────┐      │
  │ node-b.com   │          node.json   │
  └──────────────┘               │      │
                                 │      │ GET node.json
  ┌──────────────┐     owns      │      │ (crawl, every N min)
  │   Node C     │───────────────┘      ▼
  │ node-c.com   │               ┌──────────────┐
  └──────────────┘               │  Generator   │
                                 │  (cron)      │
         Node controls           └──────┬───────┘
         own data                       │ writes
                                        ▼
                                 ┌──────────────┐
                                 │  llms.json   │ ← ephemeral mirror
                                 │  (static)    │
                                 └──────┬───────┘
                                        │ GET /llms.json
                                        ▼
                                 ┌──────────────┐
                                 │  AI Agent    │
                                 └──────────────┘
```

### Mode B — Store (centralised)

```
  ┌──────────────┐  POST /mind/nodes    ┌──────────────┐
  │   Node A     │─────────────────────►│  Write API   │
  └──────────────┘  {id, name, tags...} │  (auth)      │
                                        └──────┬───────┘
  ┌──────────────┐  PUT /mind/nodes/id         │ upsert
  │   Node B     │─────────────────────►       ▼
  └──────────────┘                      ┌──────────────┐
                                        │   Internal   │ ← source of truth
  ┌──────────────┐  DELETE /mind/nodes/ │    Store     │
  │   Node C     │─────────────────────►│  (db/json)   │
  └──────────────┘                      └──────┬───────┘
                                               │ on write / cron
                                               ▼
                                        ┌──────────────┐
                                        │  Generator   │
                                        └──────┬───────┘
                                               │ writes
                                               ▼
                                        ┌──────────────┐
                                        │  llms.json   │ ← authoritative
                                        │  (static)    │
                                        └──────┬───────┘
                                               │ GET /llms.json
                                               ▼
                                        ┌──────────────┐
                                        │  AI Agent    │
                                        └──────────────┘
```

### Query flow (both modes identical)

```
  AI Agent
     │
     │  1 × GET /llms.json
     ▼
  ┌──────────────────────────────────────────────────────────┐
  │  llms.json (in agent memory)                             │
  │                                                          │
  │  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐  │
  │  │ y_tags  │  │z_status │  │ x_price  │  │z_anchors │  │
  │  │  O(1)   │  │  O(1)   │  │ O(log n) │  │ O(log n) │  │
  │  └────┬────┘  └────┬────┘  └────┬─────┘  └────┬─────┘  │
  │       └────────────┴────────────┴──────────────┘         │
  │                         │ intersect sets                  │
  │                         ▼                                 │
  │                    { i, j, k }  ← matching indices        │
  │                         │                                 │
  │                         ▼                                 │
  │                    _souls[i], _souls[j], _souls[k]        │
  └──────────────────────────────────────────────────────────┘
     │
     │  0 additional network requests
     ▼
  Result
```

---

## Query example

```javascript
const mind = await fetch('https://sys.uxprojects-jok.com/llms.json').then(r => r.json())

// find: tag=dev, status=on, price < 0.01 POL
const devIdx    = new Set(mind.y_tags['dev'] ?? [])
const onIdx     = new Set(mind.z_status.on)
const priceIdx  = new Set(mind.x_price.free)
for (let i = 0; i < mind.x_price.asc.length; i++) {
  if (mind.x_price.asc[i] < 0.01) priceIdx.add(mind.x_price.idx[i])
}

const matching = [...devIdx].filter(i => onIdx.has(i) && priceIdx.has(i))

const decoder = mind._keys
const results = matching.map(i => {
  const t = mind._souls[i]
  return Object.fromEntries(decoder.map((k, j) => [
    k, j === 5 ? t[j].map(ti => mind._tags[ti]) : t[j]
  ]))
})
```

---

## Reference implementation

`generate-llms-json.mjs` — a Node.js script that discovers nodes from the Polygon blockchain, fetches live data via BFS, builds the MIND index and writes a static `llms.json` to the webroot.

No server process needed. The output is a plain file served by any web server.

```bash
# install: copy the script, add your Etherscan key
cp generate-llms-json.mjs /path/to/your/scripts/
echo "NUXT_PUBLIC_ETHERSCAN_API_KEY=your_key" >> .env

# run once
node generate-llms-json.mjs

# or via cron every 10 minutes
*/10 * * * * node /path/to/generate-llms-json.mjs >> /var/log/mind.log 2>&1
```

**CORS** — serve `llms.json` with `Access-Control-Allow-Origin: *` so browser-based AI agents can fetch it cross-origin.

---

## Deregistration

MIND uses passive deregistration — no explicit opt-out required:

- Nodes that stop anchoring fade automatically via the **visibility zone**:
  - `< 11 days` since last anchor → `discoverable`
  - `11–22 days` → `fading`
  - `> 22 days` → not included in output
- For immediate opt-out: set `public_listing: false` in node config — the generator skips the soul.

---

## Built on SaveYourSoul

MIND was designed for [SaveYourSoul SYS](https://sys.uxprojects-jok.com) — an open protocol for self-hosted personal AI identity nodes, where every node is a person running their own VPS, anchored on Polygon, accessible via MCP.

The live MIND directory at https://sys.uxprojects-jok.com/llms.json is the first real-world implementation. The format is protocol-agnostic — any network of nodes with MCP endpoints, on-chain anchoring, or similar discovery mechanisms can publish a MIND-compatible `llms.json`.

---

## Contributing

MIND v1 is a draft. Feedback, alternative index dimensions, and client implementations welcome.

Open an issue or submit a PR.

---

## License

Apache 2.0 · © 2026 Jan-Oliver Karo · [UX-Projects](https://uxprojects-jok.com)
