// Readers for sources added after the first thirteen. Same contract as sources.mjs:
// each parser returns { leases, expected, skipped } and passes only if every listing on the page was read.
import { norm } from './sources.mjs';
const STATES = { ALABAMA:'AL', ARKANSAS:'AR', FLORIDA:'FL', GEORGIA:'GA', KENTUCKY:'KY', LOUISIANA:'LA', MISSISSIPPI:'MS', MISSOURI:'MO', 'NEW YORK':'NY', 'NORTH CAROLINA':'NC', OKLAHOMA:'OK', PENNSYLVANIA:'PA', 'SOUTH CAROLINA':'SC', TENNESSEE:'TN', TEXAS:'TX', VIRGINIA:'VA', 'WEST VIRGINIA':'WV', MAINE:'ME', MICHIGAN:'MI', WISCONSIN:'WI', OREGON:'OR', WASHINGTON:'WA', 'NEW HAMPSHIRE':'NH', VERMONT:'VT', OHIO:'OH', KANSAS:'KS', NEBRASKA:'NE', IOWA:'IA', ILLINOIS:'IL', INDIANA:'IN', MINNESOTA:'MN', IDAHO:'ID', MONTANA:'MT', CALIFORNIA:'CA', ARIZONA:'AZ', 'NEW MEXICO':'NM', COLORADO:'CO', MARYLAND:'MD', DELAWARE:'DE', 'NEW JERSEY':'NJ', CONNECTICUT:'CT', MASSACHUSETTS:'MA', 'RHODE ISLAND':'RI', 'SOUTH DAKOTA':'SD', 'NORTH DAKOTA':'ND', WYOMING:'WY', UTAH:'UT', NEVADA:'NV', ALASKA:'AK', HAWAII:'HI' };
const stateCode = (s) => s ? (STATES[s.trim().toUpperCase()] || (/^[A-Z]{2}$/.test(s.trim()) ? s.trim() : null)) : null;
const num = (s) => { if (s == null) return null; const n = Number(String(s).replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const cleanCounty = (s) => s ? s.replace(/\s+(county|parish|co\.?)$/i, '').trim().toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase()) : null;
const lease = (src, o) => ({ id: `${src.id}:${o.unit}`, source: src.name, sourceId: src.id, url: o.url || src.url, name: o.name || null, state: o.state || null,
  county: o.county || null, acres: o.acres ?? null, price: o.price ?? null, priceText: o.priceText || null, per: o.per || null, term: o.term || null,
  posted: null, auction: null, lat: null, lng: null, note: o.note || null, place: o.place || null });

// ---------- American Forest Management (hunt portal, several states) ----------
// The portal gives no lease term, so no billing period is claimed for the price.
// Each listing: "Property ID:n", "County: X", "State: Name", "<acres> Acres / $<price>", "Lease Type", "<type>".
export function parseAfm(src, text) {
  const L = norm(text), leases = [], skipped = [];
  const starts = L.map((l, i) => /^Property ID:\s*\d+/i.test(l) ? i : -1).filter(i => i >= 0);
  starts.forEach((s, k) => {
    const blk = L.slice(s, starts[k + 1] ?? L.length);
    const g = (re) => { for (const l of blk) { const m = l.match(re); if (m) return m; } return null; };
    const id = blk[0].match(/(\d+)/)[1];
    const ap = g(/^([\d,.]+)\s*Acres\s*\/\s*\$([\d,.]+)/i);
    const ti = blk.findIndex(l => /^Lease Type$/i.test(l));
    const type = ti >= 0 ? blk[ti + 1] : null;
    if (type && !/hunt/i.test(type)) { skipped.push(`${id} (${type})`); return; }
    leases.push(lease(src, { unit: id, name: `Property ${id}`, county: cleanCounty((g(/^County:\s*(.+)$/i) || [])[1]), state: stateCode((g(/^State:\s*(.+)$/i) || [])[1]),
      acres: ap ? num(ap[1]) : null, price: ap ? num(ap[2]) : null, per: null, priceText: ap ? `$${ap[2]}` : null }));
  });
  // a page that never showed its list must fail, not pass as "no leases"
  return { leases, expected: starts.length ? starts.length - skipped.length : null, skipped };
}

// ---------- Blue Sky Real Estate (Pennsylvania) ----------
// The list page shows every tract the company leases; only titles marked "(NOW AVAILABLE FOR LEASE!)" are open
// (this matches the company's own dated "available as of" post). Each block ends with a "View Listing" link,
// in the same order as the links. The price is read from each open tract's own page ("ANNUAL FEE: $x").
export function parseBlueSky(src, text, links) {
  const L = norm(text), leases = [];
  const urls = links.filter(l => /^View Listing$/i.test(l.text)).map(l => l.href);
  const ends = L.map((l, i) => /^View Listing$/i.test(l) ? i : -1).filter(i => i >= 0);
  let from = 0, open = 0;
  ends.forEach((e, k) => {
    const blk = L.slice(from, e).filter(l => !/^[A-Z .]+ COUNTY:$/.test(l)); from = e + 1;
    const t = blk.find(l => /\bACRES?\b/i.test(l) && /\bCO(UNTY|\.)/i.test(l)) || '';
    if (!/NOW AVAILABLE FOR LEASE/i.test(t) || blk.some(l => /^Leased until/i.test(l))) return;
    open++;
    const ac = t.match(/([\d,.]+)\s*ACRES?\b/i), co = t.match(/\b([A-Z][A-Za-z]+)\s+CO(?:UNTY\b|\.)/i), st = t.match(/\bCO(?:UNTY|\.)?,?\s*(PA)\b/i);
    leases.push(lease(src, { unit: (urls[k] || '').split('/').filter(Boolean).pop() || `t${k}`, name: null, url: urls[k] || src.url,
      acres: ac ? num(ac[1]) : null, county: co ? cleanCounty(co[1]) : null, state: st ? 'PA' : null, per: 'year' }));
  });
  // every block must have its own link, or the links are out of step with the text
  return { leases, expected: ends.length && ends.length === urls.length ? open : null, seen: `${text.length} chars, ${ends.length} listings, ${urls.length} listing links` };
}
export function parseBlueSkyDetail(text) {
  const m = text.match(/ANNUAL FEE:\s*\$\s*([\d,]+(?:\.\d+)?)/i);
  return m ? num(m[1]) : null;
}

const slug2 = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- Red Rock Wildlife (Missouri and Kansas leases they manage) ----------
// Each card: a short heading, one description paragraph, then a status button: "Available" or "Leased for <year>".
// No prices are posted. A tract with no county named gets "the <town> area" from "just outside <Town>, <State>".
export function parseRedRock(src, text) {
  const L = norm(text), leases = [];
  let statuses = 0, shaped = 0;
  L.forEach((l, i) => {
    const open = /^Available$/i.test(l), taken = /^Leased\b/i.test(l);
    if (!open && !taken) return;
    statuses++;
    const head = L[i - 2] || '', para = L[i - 1] || '';
    if (head.length > 0 && head.length < 100 && para.length > 100) shaped++;
    if (!open) return;
    const both = head + ' ' + para;
    const ac = head.match(/([\d,]+)\s*Acres?\b/i) || para.match(/([\d,]+)[-\s]*acres?\b/i);
    const co = both.match(/\b([A-Z][a-z]+)\s+County\b/);
    const st = both.match(/\b(Kansas|Missouri|Iowa|Nebraska|Oklahoma)\b/);
    const near = para.match(/outside\s+([A-Z][a-z]+),\s*(Kansas|Missouri|Iowa|Nebraska|Oklahoma)\b/);
    leases.push(lease(src, { unit: slug2(head), name: null, acres: ac ? num(ac[1]) : null, state: stateCode(st ? st[1] : null),
      county: co ? cleanCounty(co[1]) : null, place: !co && near ? `the ${near[1]} area, ${near[2]}` : null,
      note: 'Price not posted; contact the lister.' }));
  });
  const bad = leases.filter(x => !x.county && !x.place);
  return { leases, expected: statuses >= 3 && shaped === statuses && !bad.length ? leases.length : null, seen: `${text.length} chars, ${statuses} status buttons, ${shaped} well-formed cards` };
}

// ---------- Martin Ranch Management (Texas ranch leases they list) ----------
// The page lists "The following leases are available for <year>", then old samples. Only the first group is read,
// and only while that year is the current season (June onward counts as the new season).
export function parseMartinRanch(src, text, links, now = new Date()) {
  const L = norm(text);
  const a = L.findIndex(l => /following leases are available for (\d{4})/i.test(l));
  const b = L.findIndex(l => /samples of our previous listings/i.test(l));
  if (a < 0 || b < a) return { leases: [], expected: null, seen: 'section markers not found' };
  const yr = +L[a].match(/(\d{4})/)[1], minYr = now.getUTCMonth() >= 5 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const rows = L.slice(a + 1, b);
  if (yr < minYr) return { leases: [], expected: 0, seen: `list is for ${yr}, treated as out of date` };
  const leases = rows.map(r => {
    const m = r.match(/^([A-Za-z .]+?)\s+([\d,]+)\s*Acre/i), link = links.find(x => (x.text || '').trim() === r);
    return lease(src, { unit: slug2(r), name: null, acres: m ? num(m[2]) : null, state: 'TX', place: m ? `the ${m[1].trim()} area, Texas` : null,
      url: link ? link.href : src.url, note: 'Price not posted; contact the lister.' });
  });
  return { leases, expected: rows.length && rows.every(r => /\d\s*Acre/i.test(r)) ? rows.length : null, seen: `${yr} list, ${rows.length} rows` };
}
