// netlify/functions/sync.js  (Day's Flight Schedule V4)
//
// Keeps one list of saved schedules per sync code, so every device that uses
// the same code sees the same list. The page POSTs { code, join, items, tomb };
// this merges it with the stored list and returns the merged list.
//
// Dependency-free on purpose, same as Weather History and Probability's
// hit-counter.js (see its header comment): no @netlify/blobs package, because
// drag-and-drop deploys run no npm install. Blobs access uses the same verified
// Lambda "edge" protocol as that function: siteID from the x-nf-site-id header,
// token + edge URL from event.blobs, one authenticated request per GET/PUT.
//
// Merge rules must stay identical to merge() in index.html:
//   same name (case-insensitive) = same schedule; the newer save wins;
//   a delete (tombstone) wins over any save made before it;
//   tombstones older than 120 days are dropped; at most 100 saves kept.

const STORE_NAME = 'days-flight-schedule-sync';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const MAX_SAVES = 100;
const MAX_BODY = 600 * 1024;
const TOMB_DAYS = 120;

function getBlobsAuth(event) {
  if (!event || !event.blobs || !event.headers) return {};
  try {
    const data = JSON.parse(Buffer.from(event.blobs, 'base64').toString('utf8'));
    return { siteID: event.headers['x-nf-site-id'], token: data.token, edgeURL: data.url };
  } catch (err) {
    return {};
  }
}

async function blobsRequest(method, { siteID, token, edgeURL }, key, body) {
  const url = new URL(`/${siteID}/${STORE_NAME}/${key}`, edgeURL).toString();
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'text/plain' } : {}) },
    body,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Blobs ${method.toUpperCase()} failed (HTTP ${res.status})`);
  return method === 'get' ? res.text() : null;
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

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (statusCode, obj) => ({ statusCode, headers, body: JSON.stringify(obj) });
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    if (raw.length > MAX_BODY) return reply(413, { error: 'too large' });
    let req;
    try { req = JSON.parse(raw); } catch (e) { return reply(400, { error: 'bad JSON' }); }
    const code = typeof req.code === 'string' ? req.code : '';
    if (!CODE_RE.test(code)) return reply(400, { error: 'bad code' });

    const auth = getBlobsAuth(event);
    if (!auth.siteID || !auth.token || !auth.edgeURL) return reply(503, { error: 'Blobs auth unavailable in this function context' });

    const key = code.replace(/-/g, '');
    const storedText = await blobsRequest('get', auth, key);
    if (storedText === null && req.join) return reply(404, { error: 'no list for that code' });
    let stored = null;
    if (storedText !== null) { try { stored = cleanDoc(JSON.parse(storedText)); } catch (e) { stored = null; } }

    const merged = merge(stored, cleanDoc(req));
    await blobsRequest('put', auth, key, JSON.stringify(merged));
    return reply(200, merged);
  } catch (err) {
    return reply(502, { error: err.message });
  }
};
