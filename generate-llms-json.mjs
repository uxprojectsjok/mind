#!/usr/bin/env node
/**
 * MIND v1 — generate /llms.json for sys.uxprojects-jok.com
 * Multi-dimensional Index for Node Discovery
 *
 * Run via cron every 10 minutes:
 *   *\/10 * * * * node /var/www/SaveYourSoul_Homepage/scripts/generate-llms-json.mjs
 */

import { writeFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir       = dirname(fileURLToPath(import.meta.url))
const OUT_FILE    = '/var/www/sys.uxprojects-jok.com/llms.json'
const NODES_FILE  = join(__dir, '../public/nodes.json')
const ENV_FILE    = join(__dir, '../.env')

// Load .env manually (no dotenv dependency)
try {
  const envLines = readFileSync(ENV_FILE, 'utf8').split('\n')
  for (const line of envLines) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim()
  }
} catch {}

const ETHERSCAN_KEY  = process.env.NUXT_PUBLIC_ETHERSCAN_API_KEY || process.env.ETHERSCAN_KEY || ''
const RPC            = 'https://polygon-bor-rpc.publicnode.com'
const SYS_CONTRACT   = '0xB68Ca7cFFbe1113F62B3d0397d293693A8e0106B'
const ANCHORED_TOPIC0 = '0x24b87c8294e674d1419dd6c41c12b8d49dc2544499faf53e81accbe330f7cdae'

const VISIBILITY_FADING    = 11
const VISIBILITY_INVISIBLE = 22
const BFS_TIMEOUT          = 8000
const ONLINE_TIMEOUT       = 5000

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToBytes(hex) {
  const clean = hex.replace('0x', '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function extractSysMeta(inputHex) {
  try {
    const raw   = hexToBytes(inputHex)
    if (raw.length <= 100) return null
    const extra = new TextDecoder('utf-8', { fatal: false }).decode(raw.slice(100))
    const MARKER = '\x00SYS1\x00'
    const idx    = extra.indexOf(MARKER)
    if (idx === -1) return null
    return JSON.parse(extra.slice(idx + MARKER.length))
  } catch { return null }
}

async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) })
}

// ── Chain discovery ───────────────────────────────────────────────────────────

async function discoverFromChain() {
  if (!ETHERSCAN_KEY) { console.warn('No Etherscan key — skipping chain discovery'); return { origins: [], stubs: [] } }
  try {
    const url = `https://api.etherscan.io/v2/api?chainid=137&module=logs&action=getLogs` +
      `&address=${SYS_CONTRACT}&topic0=${ANCHORED_TOPIC0}` +
      `&fromBlock=83500000&toBlock=latest&page=1&offset=1000&apikey=${ETHERSCAN_KEY}`

    const json = await fetchWithTimeout(url, {}, 15000).then(r => r.json())
    if (json.status !== '1' || !Array.isArray(json.result)) return { origins: [], stubs: [] }

    const anchorCount = new Map()
    const latestTx    = new Map()
    const latestBlock = new Map()

    for (const log of json.result) {
      const topic = log.topics[1]
      const block = parseInt(log.blockNumber, 16)
      const ts    = parseInt(log.timeStamp, 16)
      anchorCount.set(topic, (anchorCount.get(topic) || 0) + 1)
      const prev = latestTx.get(topic)
      if (!prev || block > prev.block) {
        latestTx.set(topic, { txHash: log.transactionHash, block })
        latestBlock.set(topic, ts)
      }
    }

    const entries  = [...latestTx.entries()]
    const origins  = new Set()
    const stubs    = []

    for (let i = 0; i < entries.length; i += 10) {
      const slice = entries.slice(i, i + 10)
      const batch = slice.map(([, v], idx) => ({
        jsonrpc: '2.0', method: 'eth_getTransactionByHash', params: [v.txHash], id: idx,
      }))
      try {
        const results = await fetchWithTimeout(RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch),
        }, 10000).then(r => r.json())

        for (const res of (Array.isArray(results) ? results : [results])) {
          const tx   = res.result
          const meta = tx?.input ? extractSysMeta(tx.input) : null
          if (!meta?.mcp || !meta?.id) continue
          try {
            const origin = new URL(meta.mcp).origin
            origins.add(origin)
            const topic = slice[res.id]?.[0]
            const lastAnchorTs = latestBlock.get(topic) || 0
            stubs.push({
              soul_id:          meta.id,
              mcp_endpoint:     meta.mcp,
              name:             meta.name  || null,
              tags:             meta.tags  || [],
              cid:              meta.cid   || null,
              tx_hash:          tx.hash,
              anchor_count:     anchorCount.get(topic) || 1,
              last_anchor_ts:   lastAnchorTs,
              chain_verified:   true,
              _stub:            true,
            })
          } catch {}
        }
      } catch {}
    }
    return { origins: [...origins], stubs }
  } catch (e) { console.error('Chain discovery failed:', e.message); return { origins: [], stubs: [] } }
}

// ── IPFS fetch ────────────────────────────────────────────────────────────────

async function fetchFromIPFS(cid) {
  if (!cid) return null
  for (const gw of [`https://gateway.pinata.cloud/ipfs/${cid}`, `https://ipfs.io/ipfs/${cid}`]) {
    try {
      const r = await fetchWithTimeout(gw, {}, 8000)
      if (r.ok) return await r.json()
    } catch {}
  }
  return null
}

// ── BFS node scan ─────────────────────────────────────────────────────────────

async function bfsScan(seedOrigins) {
  const visited = new Set()
  const queue   = [...seedOrigins]
  const liveMap = new Map()  // soul_id → soul data from live node

  while (queue.length > 0) {
    const raw  = queue.shift()
    const base = raw.replace(/\/mcp$/, '').replace(/\/$/, '')
    if (visited.has(base)) continue
    visited.add(base)

    try {
      const data = await fetchWithTimeout(`${base}/api/soul/scan`, {}, BFS_TIMEOUT)
        .then(r => r.ok ? r.json() : null).catch(() => null)
      if (!data?.souls) continue

      for (const soul of data.souls) {
        liveMap.set(soul.soul_id, { ...soul, _online: true })
        if (soul.mcp_endpoint) {
          try {
            const discovered = new URL(soul.mcp_endpoint).origin
            if (!visited.has(discovered)) queue.push(discovered)
          } catch {}
        }
      }
    } catch {}
  }
  return liveMap
}

// ── Online check ──────────────────────────────────────────────────────────────

async function checkOnline(origin) {
  try {
    const r    = await fetchWithTimeout(`${origin}/api/soul/scan`, {}, ONLINE_TIMEOUT)
    const json = r.ok ? await r.json().catch(() => null) : null
    return json?.ok === true
  } catch { return false }
}

// ── Visibility zone ───────────────────────────────────────────────────────────

function visibilityZone(daysSince) {
  if (daysSince < VISIBILITY_FADING)    return 'discoverable'
  if (daysSince < VISIBILITY_INVISIBLE) return 'fading'
  return 'invisible'
}

// ── MIND index builder ────────────────────────────────────────────────────────

function buildMindIndex(souls) {
  // _keys: field order in each soul tuple
  const KEYS = ['id','name','mcp','status','anchors','tags','price','wallet','description','llms_url','chain_verified','visibility']

  // Collect all unique tags
  const tagSet = new Set()
  for (const s of souls) (s.tags || []).forEach(t => tagSet.add(t))
  const TAG_LIST = [...tagSet].sort()
  const tagIndex = new Map(TAG_LIST.map((t, i) => [t, i]))

  // Build _souls tuples
  // Sort base array by last_anchor_ts descending (freshest first)
  const sorted = [...souls].sort((a, b) => (b.last_anchor_ts || 0) - (a.last_anchor_ts || 0))

  const tuples = sorted.map(s => {
    const price = s.pol_current ?? s.pol_per_request ?? 0
    const origin = s.mcp_endpoint ? (() => { try { return new URL(s.mcp_endpoint).origin } catch { return '' } })() : ''
    return [
      s.soul_id,
      s.name || '',
      s.mcp_endpoint || '',
      s.online ? 1 : 0,
      s.anchor_count || 0,
      (s.tags || []).map(t => tagIndex.get(t) ?? -1).filter(i => i >= 0),
      price,
      s.wallet || '',
      s.description || '',
      origin ? `${origin}/llms.txt` : '',
      s.chain_verified ? 1 : 0,
      s.visibility_zone || 'discoverable',
    ]
  })

  // x_price: ascending price index
  const priceEntries = sorted.map((s, i) => ({ price: s.pol_current ?? s.pol_per_request ?? 0, idx: i }))
  priceEntries.sort((a, b) => a.price - b.price)
  const freeBucket = priceEntries.filter(e => e.price === 0).map(e => e.idx)
  const paidEntries = priceEntries.filter(e => e.price > 0)

  // y_tags: inverted index tag → soul indices (sorted by anchor_count desc)
  const yTags = {}
  for (const tag of TAG_LIST) {
    const tagIdx = tagIndex.get(tag)
    yTags[tag] = sorted
      .map((s, i) => ({ i, anchors: s.anchor_count || 0, hasTag: (s.tags||[]).includes(tag) }))
      .filter(e => e.hasTag)
      .sort((a, b) => b.anchors - a.anchors)
      .map(e => e.i)
  }

  // z_status buckets
  const zStatus = {
    on:  sorted.map((s, i) => s.online ? i : -1).filter(i => i >= 0),
    off: sorted.map((s, i) => !s.online ? i : -1).filter(i => i >= 0),
  }

  // z_anchors: ascending anchor count
  const anchorEntries = sorted.map((s, i) => ({ anchors: s.anchor_count || 0, idx: i }))
  anchorEntries.sort((a, b) => a.anchors - b.anchors)

  return {
    _v:      1,
    _spec:   'https://sys.uxprojects-jok.com/mind',
    _schema: 'https://raw.githubusercontent.com/uxprojectsjok/mind/main/spec.md',
    _ts:     Math.floor(Date.now() / 1000),
    _keys:   KEYS,
    _tags:   TAG_LIST,
    _souls:  tuples,

    _hint: {
      query:  'To filter souls: use y_tags[tag] for O(1) tag lookup, z_status.on/off for O(1) status filter, binary search x_price.asc for price range (parallel array x_price.idx maps to _souls index), binary search z_anchors.asc for anchor range. Intersect result sets. Read only matching _souls entries. Never scan all _souls linearly.',
      decode: 'Each _souls entry is an array ordered by _keys. The tags field contains integer indices into _tags. status 1=online 0=offline. anchors=on-chain anchor count (trust signal).',
      update: 'File regenerated every 10 minutes. Cache with max-age=600.',
    },

    x_price: {
      free: freeBucket,
      asc:  paidEntries.map(e => e.price),
      idx:  paidEntries.map(e => e.idx),
    },

    y_tags: yTags,

    z_status: zStatus,

    z_anchors: {
      asc: anchorEntries.map(e => e.anchors),
      idx: anchorEntries.map(e => e.idx),
    },
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[MIND] Starting scan — ${new Date().toISOString()}`)

  // 1. Seed list + chain discovery in parallel
  let seeds = []
  try { seeds = JSON.parse(readFileSync(NODES_FILE, 'utf8')) } catch {}

  const { origins: chainOrigins, stubs: chainStubs } = await discoverFromChain()
  const allOrigins = [...new Set([...seeds, ...chainOrigins])]
  console.log(`[MIND] Seeds: ${seeds.length} static + ${chainOrigins.length} chain = ${allOrigins.length} unique`)
  console.log(`[MIND] Chain stubs: ${chainStubs.length}`)

  // 2. BFS + IPFS in parallel
  const [liveMap, ipfsResults] = await Promise.all([
    bfsScan(allOrigins),
    Promise.all(chainStubs.filter(s => s.cid).map(async s => {
      const data = await fetchFromIPFS(s.cid)
      return data ? { soul_id: s.soul_id, data } : null
    })).then(r => r.filter(Boolean)),
  ])
  console.log(`[MIND] Live souls: ${liveMap.size}`)

  const ipfsMap = new Map(ipfsResults.map(r => [r.soul_id, r.data]))

  // 3. Merge: live > stub+ipfs, filter invisible
  const now = Math.floor(Date.now() / 1000)
  const soulMap = new Map()

  // Pre-seed stubs (only if name known)
  for (const stub of chainStubs) {
    const ipfs = ipfsMap.get(stub.soul_id)
    const name = stub.name || ipfs?.name
    if (!name) continue
    const daysSince = stub.last_anchor_ts ? (now - stub.last_anchor_ts) / 86400 : 0
    const zone = visibilityZone(daysSince)
    if (zone === 'invisible') continue
    soulMap.set(stub.soul_id, {
      ...stub,
      name,
      description: ipfs?.description || '',
      tags:        stub.tags?.length ? stub.tags : (ipfs?.tags || []),
      wallet:      ipfs?.wallet || '',
      days_since_last_anchor: Math.floor(daysSince),
      visibility_zone: zone,
      online: false,
    })
  }

  // Live data wins
  for (const [soul_id, soul] of liveMap) {
    const stub = soulMap.get(soul_id)
    const ipfs = ipfsMap.get(soul_id)
    const lastAnchorTs = stub?.last_anchor_ts || 0
    const daysSince = lastAnchorTs ? (now - lastAnchorTs) / 86400 : 0
    const zone = visibilityZone(daysSince)
    if (zone === 'invisible') continue
    soulMap.set(soul_id, {
      ...soul,
      name:        soul.name || stub?.name || ipfs?.name || '',
      description: soul.description || stub?.description || ipfs?.description || '',
      tags:        soul.tags?.length ? soul.tags : (stub?.tags || ipfs?.tags || []),
      wallet:      soul.wallet || stub?.wallet || ipfs?.wallet || '',
      anchor_count: soul.anchor_count || stub?.anchor_count || 0,
      last_anchor_ts: lastAnchorTs,
      days_since_last_anchor: Math.floor(daysSince),
      visibility_zone: zone,
      chain_verified: true,
      online: true,
    })
  }

  // 4. Online check for stubs still in map
  const stubOnlineChecks = [...soulMap.values()]
    .filter(s => !s.online && s.mcp_endpoint)
    .map(async s => {
      try {
        const origin = new URL(s.mcp_endpoint).origin
        const online = await checkOnline(origin)
        if (online) soulMap.set(s.soul_id, { ...s, online: true })
      } catch {}
    })
  await Promise.all(stubOnlineChecks)

  const souls = [...soulMap.values()].filter(s => s.name)
  console.log(`[MIND] Final souls: ${souls.length} (${souls.filter(s=>s.online).length} online)`)

  // 5. Build MIND index
  const mind = buildMindIndex(souls)

  // 6. Write atomically
  const tmp = OUT_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(mind))
  writeFileSync(OUT_FILE, JSON.stringify(mind))
  console.log(`[MIND] Written to ${OUT_FILE} (${(JSON.stringify(mind).length / 1024).toFixed(1)} KB)`)
}

main().catch(e => { console.error('[MIND] Fatal:', e); process.exit(1) })
