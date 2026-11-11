// netlify/functions/sync.mjs  (Day's Flight Schedule; V4 sync, V6.5 strong reads)
//
// Keeps one list of saved schedules per sync code, so every device that uses
// the same code sees the same list. The page POSTs { code, join, items, tomb };
// this merges it with the stored list and returns the merged list.
//
// Dependency-free on purpose (no @netlify/blobs package, no npm install).
// V6.5: rewritten from the Lambda-compatible handler (sync.js) to Netlify's
// current function format, because only this format is handed the Blobs
// context's uncachedEdgeURL. The read before each merge goes there (a
// strongly consistent read, as @netlify/blobs does for consistency:"strong");
// the cached edge URL can serve a list up to 60 s old, and merging into a stale
// list could drop another device's newest save or delete from the server until
// that device synced again. If uncachedEdgeURL is missing, the read falls back
// to the edge URL (the old behaviour). Response header x-blobs-read says which.
// Same URL as before: /.netlify/functions/sync. Same store and keys.
//
// Merge rules must stay identical to merge() in site/index.html:
//   same name (case-insensitive) = same schedule; the newer save wins;
//   a delete (tombstone) wins over any save made before it;
//   tombstones older than 120 days are dropped; at most 100 saves kept.

const STORE_NAME = 'days-flight-schedule-sync';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const MAX_SAVES = 100;
const MAX_BODY = 600 * 1024;
const TOMB_DAYS = 120;

// Same source the @netlify/blobs client reads (getEnvironmentContext): base64 JSON.
function blobsContext() {
  const raw = globalThis.netlifyBlobsContext
    || (globalThis.Netlify && globalThis.Netlify.env && globalThis.Netlify.env.get('NETLIFY_BLOBS_CONTEXT'))
    || (typeof process !== 'undefined' && process.env ? process.env.NETLIFY_BLOBS_CONTEXT : '');
  if (typeof raw !== 'string' || !raw) return {};
  try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch (e) { return {}; }
}

async function blobsRequest(method, ctx, base, key, body) {
  const url = new URL(`/${ctx.siteID}/${STORE_NAME}/${key}`, base).toString();
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${ctx.token}`, ...(body ? { 'content-type': 'text/plain' } : {}) },
    body,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Blobs ${method} failed (HTTP ${res.status})`);
  return method === 'GET' ? res.text() : null;
}

function cleanDoc(d) {
  const out = { items: [], tomb: {} };
  if (!d || typeof d !== 'object') return out;
  if (Array.isArray(d.items)) {
    d.items.forEach(x => {
      if (!x || typeof x.name !== 'string' || !x.name.trim() || !x.state || typeof x.state !== 'object') return;
      out.items.push({ name: x.name.slice(0, 48), at: typeof x.at === 'string' ? x.at.slice(0, 40) : '', state: x.state });
    });
  }
  if (d.tomb && typeof d.tomb === 'object') {
    Object.keys(d.tomb).slice(0, 1000).forEach(k => { out.tomb[String(k).slice(0, 48).toLowerCase()] = String(d.tomb[k]).slice(0, 40); });
  }
  return out;
}

function merge(a, b) {
  const items = new Map(), tomb = {};
  const cutoff = new Date(Date.now() - TOMB_DAYS * 864e5).toISOString();
  [a, b].forEach(d => {
    if (!d) return;
    (Array.isArray(d.items) ? d.items : []).forEach(x => {
      if (!x || typeof x.name !== 'string' || !x.state) return;
      const k = x.name.toLowerCase(), cur = items.get(k);
      if (!cur || String(x.at || '') > String(cur.at || '')) items.set(k, x);
    });
    const t = (d.tomb && typeof d.tomb === 'object') ? d.tomb : {};
    Object.keys(t).forEach(k => { const v = String(t[k]); if (!tomb[k] || v > tomb[k]) tomb[k] = v; });
  });
  const out = [];
  items.forEach((x, k) => {
    if (tomb[k] && tomb[k] >= String(x.at || '')) return;
    delete tomb[k];
    out.push(x);
  });
  Object.keys(tomb).forEach(k => { if (tomb[k] < cutoff) delete tomb[k]; });
  out.sort((p, q) => (String(q.at) > String(p.at) ? 1 : (String(q.at) < String(p.at) ? -1 : 0)));
  return { items: out.slice(0, MAX_SAVES), tomb };
}

export default async (req, context) => {
  const ctx = blobsContext();
  if (!ctx.siteID && context && context.site && context.site.id) ctx.siteID = context.site.id;
  const strong = !!ctx.uncachedEdgeURL;
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'x-blobs-read': strong ? 'strong' : 'eventual' };
  const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return reply(413, { error: 'too large' });
    let body;
    try { body = JSON.parse(raw); } catch (e) { return reply(400, { error: 'bad JSON' }); }
    const code = typeof body.code === 'string' ? body.code : '';
    if (!CODE_RE.test(code)) return reply(400, { error: 'bad code' });

    if (!ctx.siteID || !ctx.token || !ctx.edgeURL) return reply(503, { error: 'Blobs context unavailable in this function' });

    const key = code.replace(/-/g, '');
    const storedText = await blobsRequest('GET', ctx, strong ? ctx.uncachedEdgeURL : ctx.edgeURL, key);
    if (storedText === null && body.join) return reply(404, { error: 'no list for that code' });
    let stored = null;
    if (storedText !== null) { try { stored = cleanDoc(JSON.parse(storedText)); } catch (e) { stored = null; } }

    const merged = merge(stored, cleanDoc(body));
    await blobsRequest('PUT', ctx, ctx.edgeURL, key, JSON.stringify(merged));
    return reply(200, merged);
  } catch (err) {
    return reply(502, { error: err.message });
  }
};
