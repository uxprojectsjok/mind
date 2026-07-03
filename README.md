# MIND — Multi-dimensional Index for Node Discovery

> A JSON format for AI-agent-native discovery of decentralized nodes. O(log n) queries. No search API. No database. One static file.

**Live:** https://sys.uxprojects-jok.com/llms.json  
**Spec:** [spec.md](spec.md)  
**Version:** v1.0 Draft

---

## The problem

Existing AI discovery formats (llms.txt, ARD, agents.json) return flat lists. Fine at 100 nodes. Unusable at 100,000.

An AI agent looking for souls with `tag=dev` and `price < 0.01 POL` has to download the full list and scan every entry. At 1M nodes that's 300 MB and 5 seconds — before doing anything useful.

## The solution

MIND ships the **index with the data**. Pre-sorted, pre-bucketed, ready for binary search.

```
GET /llms.json  →  index + data in one request
                   O(log n) filter, no server needed
```

| Scale | Flat list | MIND |
|-------|-----------|------|
| 1,000 nodes | ~5 ms | ~0.2 ms |
| 100,000 nodes | ~500 ms | ~2 ms |
| 1,000,000 nodes | ~5,000 ms | ~10 ms |

## Format at a glance

```json
{
  "_v": 1,
  "_spec": "https://sys.uxprojects-jok.com/mind",
  "_ts": 1751563686,
  "_keys": ["id","name","mcp","status","anchors","tags","price","wallet","description","llms_url","chain_verified","visibility"],
  "_tags": ["dev","ai","marburg"],
  "_souls": [
    ["2c81aa74","Jan","https://node.example.com/mcp",1,22,[0,1],0.004,"0xabc","Developer","https://node.example.com/llms.txt",1,"discoverable"]
  ],
  "x_price":   { "free": [], "asc": [0.004], "idx": [0] },
  "y_tags":    { "dev": [0], "ai": [0] },
  "z_status":  { "on": [0], "off": [] },
  "z_anchors": { "asc": [22], "idx": [0] }
}
```

→ Full spec in [spec.md](spec.md)

## Reference implementation

`generate-llms-json.mjs` — runs as a cron job, writes a static `llms.json`. No server required.

```bash
# every 10 minutes
*/10 * * * * node generate-llms-json.mjs
```

## License

Apache 2.0 · © 2026 Jan-Oliver Karo · UX-Projects
