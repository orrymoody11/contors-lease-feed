// Readers for the seven lease sources that are not on the shared Orbis platform.
// Each parser takes the page's visible text (and its links) and returns
//   { leases: [...], expected: <count found independently on the page>, skipped: [...] }
// A source passes only when leases.length === expected and every lease has acres + state.

const STATES = { ALABAMA:'AL', ALASKA:'AK', ARIZONA:'AZ', ARKANSAS:'AR', CALIFORNIA:'CA', COLORADO:'CO', CONNECTICUT:'CT', DELAWARE:'DE', FLORIDA:'FL', GEORGIA:'GA', IDAHO:'ID', ILLINOIS:'IL', INDIANA:'IN', IOWA:'IA', KANSAS:'KS', KENTUCKY:'KY', LOUISIANA:'LA', MAINE:'ME', MARYLAND:'MD', MASSACHUSETTS:'MA', MICHIGAN:'MI', MINNESOTA:'MN', MISSISSIPPI:'MS', MISSOURI:'MO', MONTANA:'MT', NEBRASKA:'NE', NEVADA:'NV', 'NEW HAMPSHIRE':'NH', 'NEW JERSEY':'NJ', 'NEW MEXICO':'NM', 'NEW YORK':'NY', 'NORTH CAROLINA':'NC', 'NORTH DAKOTA':'ND', OHIO:'OH', OKLAHOMA:'OK', OREGON:'OR', PENNSYLVANIA:'PA', 'RHODE ISLAND':'RI', 'SOUTH CAROLINA':'SC', 'SOUTH DAKOTA':'SD', TENNESSEE:'TN', TEXAS:'TX', UTAH:'UT', VERMONT:'VT', VIRGINIA:'VA', WASHINGTON:'WA', 'WEST VIRGINIA':'WV', WISCONSIN:'WI', WYOMING:'WY' };
const CODES = new Set(Object.values(STATES));
const stateCode = (s) => { if (!s) return null; const u = s.trim().toUpperCase().replace(/\.$/, ''); return CODES.has(u) ? u : (STATES[u] || null); };
const STATE_NAME_RE = new RegExp('\\b(' + Object.keys(STATES).sort((a, b) => b.length - a.length).map(s => s.replace(' ', '\\s+')).join('|') + ')\\b', 'i');
const num = (s) => { if (s == null) return null; const n = Number(String(s).replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const title = (s) => s ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase()) : s;
const cleanCounty = (s) => s ? title(s.replace(/\s+(county|parish|co\.?)$/i, '').trim()) : null;
export const norm = (t) => t.replace(/\r/g, '').replace(/[ \t ]+/g, ' ').split('\n').map(l => l.trim()).filter(Boolean);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
const isoDate = (s) => { const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10); };

function lease(src, o) {
  return { id: `${src.id}:${o.unit || slug(`${o.county || ''}-${o.acres || ''}-${o.name || ''}`)}`, source: src.name, sourceId: src.id,
    url: o.url || src.url, name: o.name || null, state: o.state || null, county: o.county || null, acres: o.acres ?? null,
    price: o.price ?? null, priceText: o.priceText || null, per: o.per || null, term: o.term || null,
    posted: o.posted || null, auction: o.auction || null, lat: o.lat ?? null, lng: o.lng ?? null, note: o.note || null };
}

// ---------- FORECON (NY / PA / WV) ----------
export function parseForecon(src, text, links) {
  const L = norm(text), leases = [];
  for (let i = 0; i < L.length; i++) {
    const a = L[i].match(/^±?\s*([\d,]+(?:\.\d+)?)\s+ACRES$/i);
    if (!a) continue;
    const posted = L[i + 1] && /^[A-Z]{3} \d{1,2}, \d{4}$/i.test(L[i + 1]) ? isoDate(L[i + 1]) : null;
    const name = L[i + 2] || null;
    const loc = (L[i + 3] || '').match(/^(.+?),\s*([A-Z]{2})$/);
    const ls = slug(name || '');
    const link = links.map(l => l.href).find(h => /\/huntleases\//.test(h) && (ls.includes(h.split('/huntleases/')[1].replace(/\/$/, '')) || h.includes(ls)));
    leases.push(lease(src, { unit: link ? link.split('/huntleases/')[1] : ls, name, acres: num(a[1]), posted,
      county: loc ? cleanCounty(loc[1]) : null, state: loc ? stateCode(loc[2]) : null, url: link,
      note: 'Price not posted; contact FORECON.' }));
  }
  const expected = new Set(links.map(l => l.href).filter(h => /\/huntleases\/[a-z0-9-]+\/?$/.test(h))).size;
  return { leases, expected };
}

// ---------- Bull Creek Leasing (TX / AR / LA) ----------
export function parseBullCreek(src, text) {
  const L = norm(text), leases = [], skipped = [];
  let state = null, block = [];
  for (const line of L) {
    if (/^(TEXAS|ARKANSAS|LOUISIANA|OKLAHOMA|MISSISSIPPI)$/i.test(line)) { state = stateCode(line); block = []; continue; }
    block.push(line);
    const fee = line.match(/^Annual Fee\s*-\s*\$\s*([\d,]+(?:\.\d+)?)(.*)$/i);
    if (!fee) continue;
    const head = block[0] || '';
    const a = head.match(/^([\d,]+(?:\.\d+)?)\s+acres\b/i);
    if (!a) { skipped.push(head); block = []; continue; }
    const body = block.join(' ');
    const cty = body.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?) (County|Parish)\b/);
    const ll = body.match(/(-?\d{2}\.\d{3,})\s*,\s*(-\d{2,3}\.\d{3,})/);
    const st = state || stateCode((body.match(STATE_NAME_RE) || [])[1]);
    const parts = body.match(/(\d+) tracts? of ([\d ,and]+) acres/i);
    leases.push(lease(src, { unit: slug(head), name: head, acres: num(a[1]), state: st, county: cty ? cleanCounty(cty[1].replace(/^(This|The|In|Near|Of|A|An|And|From)\s+/, '')) : null,
      price: num(fee[1]), priceText: `$${fee[1]} per year`, per: 'year', term: '1 year from signing',
      lat: ll ? Number(ll[1]) : null, lng: ll ? Number(ll[2]) : null,
      note: parts ? `${parts[0]}; can be leased separately.` : null }));
    block = [];
  }
  const expected = L.filter(l => /^Annual Fee\s*-/i.test(l)).length - skipped.length;
  return { leases, expected, skipped };
}

// ---------- Alabama Forest Owners' Association (table) ----------
const ROW = /^(\d{1,2}\/\d{1,2}\/\d{4})\s+([A-Z]{2})\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+(\$[\d,]+(?:\.\d+)?)\.?\s*(.*)$/;
export function parseAfoa(src, text) {
  const L = norm(text), leases = [];
  const rows = L.map((l, i) => [l, i]).filter(([l]) => /^\d{1,2}\/\d{1,2}\/\d{4}\s+[A-Z]{2}\s/.test(l));
  for (const [line, i] of rows) {
    const m = line.match(ROW);
    if (!m) continue;
    const [, date, st, county, acres, price, rest] = m;
    let tail = rest; for (let j = i + 1; j < L.length && !/^\d{1,2}\/\d{1,2}\/\d{4}\s/.test(L[j]) && !/^P\.?O\.? Box/i.test(L[j]); j++) tail += ' ' + L[j];
    const ll = tail.match(/(-?\d{2}\.\d{3,})\s*\/\s*(-\d{2,3}\.\d{3,})/);
    const turkeyOnly = /turkey (season|lease) only/i.test(tail);
    const per = /\/\s*season/i.test(rest) || turkeyOnly ? 'season' : /\/\s*acre/i.test(rest) ? 'acre' : 'year';
    const via = tail.match(/\b(Growing Assets)\b/);
    leases.push(lease(src, { unit: slug(`${date}-${county}-${acres}`), state: stateCode(st), county: cleanCounty(county), acres: num(acres),
      price: num(price), priceText: (price + ' ' + (rest.match(/^\/\S+(?: including insurance)?/) || [''])[0]).trim(), per,
      posted: isoDate(date), lat: ll ? Number(ll[1]) : null, lng: ll ? Number(ll[2]) : null,
      note: [turkeyOnly ? 'Turkey season only.' : null, via ? `Posted by ${via[1]}.` : null].filter(Boolean).join(' ') || null }));
  }
  return { leases, expected: rows.length };
}

// ---------- Larson & McGowin ----------
export function parseLarson(src, text, links) {
  const L = norm(text), leases = [];
  for (let i = 0; i < L.length; i++) {
    const a = L[i].match(/^([\d,]+(?:\.\d+)?)\s+Acres$/i);
    if (!a) continue;
    const loc = (L[i - 1] || '').match(/^(.+?)\s+County,\s*(.+)$/i);
    const term = L.slice(i + 1, i + 4).find(l => /thru|through|to /i.test(l) && /\d{4}/.test(l)) || null;
    const pr = L.slice(i + 1, i + 4).find(l => /^\$[\d,]/.test(l)) || null;
    const acres = num(a[1]);
    const link = links.map(l => l.href).find(h => /\/properties\/[^/]+\/?$/.test(h) && h.includes(`${String(acres).replace('.', '-')}-acres`));
    leases.push(lease(src, { unit: link ? link.split('/properties/')[1].replace(/\/$/, '') : slug(L[i - 2] || ''), name: L[i - 2] || null,
      acres, county: loc ? cleanCounty(loc[1]) : null, state: loc ? stateCode(loc[2]) : null, url: link,
      price: pr ? num(pr.match(/\$[\d,.]+/)[0]) : null, priceText: pr, per: 'year', term }));
  }
  const expected = new Set(links.map(l => l.href).filter(h => /larsonmcgowin\.com\/properties\/[^/]+\/?$/.test(h) && !/news|safety/i.test(h))).size;
  return { leases, expected };
}

// ---------- Nebraska Board of Educational Lands and Funds (auctions) ----------
export function parseNebraska(src, text, links, now = new Date()) {
  const L = norm(text), leases = [], past = [];
  const urls = [...new Map(links.map(l => l.href).filter(h => /\/recleases\/reclease-/i.test(h)).map(h => [h.toLowerCase(), h])).values()];
  let k = -1;
  for (let i = 0; i < L.length; i++) {
    if (!/^Click for More Info$/i.test(L[i])) continue;
    k++;
    const [head, name, when, venue, town] = L.slice(i - 5, i);
    const c = (head || '').match(/^(.+?) County\s+(.+)$/i);
    const d = (when || '').match(/^([A-Za-z]+)\s+(\d{1,2})\s*@\s*(.+)$/);
    let auction = null;
    if (d && MONTHS[d[1].slice(0, 3).toLowerCase()] !== undefined) {
      const dt = new Date(Date.UTC(now.getUTCFullYear(), MONTHS[d[1].slice(0, 3).toLowerCase()], Number(d[2]), 23, 59));
      if (dt < now) { past.push(head); continue; }
      auction = { date: dt.toISOString().slice(0, 10), time: d[3], place: [venue, town].filter(Boolean).join(', ') };
    }
    leases.push(lease(src, { unit: slug(head || String(k)), name: `${name} (${(c && c[2]) || ''})`.replace(' ()', ''), state: 'NE',
      county: c ? cleanCounty(c[1]) : null, url: urls.length === L.filter(l => /^Click for More Info$/i.test(l)).length ? urls[k] : src.url,
      auction, per: 'year', note: 'Public auction; rent is set by bidding. Acreage is on the auction notice.' }));
  }
  const expected = L.filter(l => /^Click for More Info$/i.test(l)).length - past.length;
  return { leases, expected, skipped: past };
}
export function parseNebraskaDetail(text) {
  const t = norm(text).join(' ');
  const rent = t.match(/(\d{4}) Rent\s*-\s*\$([\d,]+(?:\.\d+)?)/i);
  const acres = t.match(/([\d,]+(?:\.\d+)?)\s*(?:\+\/-\s*)?acres/i);
  return { price: rent ? num(rent[2]) : null, priceText: rent ? `${rent[1]} rent listed: $${rent[2]} (final rent set at auction)` : null, acres: acres ? num(acres[1]) : null };
}

// ---------- Growing Assets (AL / MS) ----------
export function parseGrowingAssets(src, text, links) {
  const L = norm(text), leases = [];
  const val = (i, label) => { for (let j = i; j < Math.min(L.length, i + 16); j++) if (L[j].toLowerCase() === label.toLowerCase() + ':') return L[j + 1]; return null; };
  for (let i = 0; i < L.length; i++) {
    if (!/^Tract ID:$/i.test(L[i])) continue;
    const unit = L[i + 1];
    const acres = num(val(i, 'Acres'));
    const loc = (val(i, 'Location') || '').match(/^(.+?)\s+Co(?:unty)?\.?,\s*([A-Z]{2})$/i);
    const cost = val(i, 'Cost') || '';
    const rate = cost.match(/\$([\d,.]+)\s*\/\s*acre/i);
    const pdf = links.map(l => l.href).find(h => /\.pdf$/i.test(h) && h.toUpperCase().includes(unit.toUpperCase()));
    leases.push(lease(src, { unit, name: `Tract ${unit}`, acres, county: loc ? cleanCounty(loc[1]) : null, state: loc ? stateCode(loc[2]) : null,
      price: rate && acres ? Math.round(num(rate[1]) * acres * 100) / 100 : num(cost), priceText: cost, per: rate ? 'year (per-acre rate)' : 'year',
      term: val(i, 'Term'), url: pdf, note: /insurance/i.test(cost) ? 'Plus insurance.' : null }));
  }
  return { leases, expected: L.filter(l => /^Tract ID:$/i.test(l)).length };
}

// ---------- US Hunts (Shopify products feed) ----------
export function parseUsHunts(src, text, products, stateByHandle = {}) {
  const leases = [], skipped = [];
  const avail = products.filter(p => (p.variants || []).some(v => v.available));
  for (const p of avail) {
    const a = p.title.match(/([\d,]+(?:\.\d+)?)\s*-?\s*acres?\b/i);
    if (p.product_type !== 'Hunting Lease' || !a) { skipped.push(p.title); continue; }
    const body = (p.body_html || '').replace(/<[^>]+>/g, ' ');
    const both = p.title + ' ' + body;
    const cty = p.title.match(/\b([A-Z][a-z]+) County\b/) || body.match(/\b([A-Z][a-z]+) County\b/);
    const st = stateByHandle[p.handle] || (p.title.match(/County,?\s+([A-Z]{2})\b/) || [])[1] || (both.match(STATE_NAME_RE) || [])[1] || (body.match(/County,?\s+([A-Z]{2})\b/) || [])[1];
    const v = p.variants.find(x => x.available) || p.variants[0];
    leases.push(lease(src, { unit: p.handle, name: p.title, acres: num(a[1]), county: cty ? cleanCounty(cty[1]) : null, state: stateCode(st),
      price: num(v.price), priceText: `$${Number(v.price).toLocaleString('en-US', { minimumFractionDigits: 2 })} listed`, per: 'year',
      term: 'Annual, renews yearly', url: `https://ushunts.com/products/${p.handle}`,
      note: (p.tags || []).includes('downpay') ? 'US Hunts takes a deposit to hold it; confirm the full price on the listing.' : null }));
  }
  const m = norm(text).join('\n').match(/Availability\nAvailable\n\((\d+)\)/i) || norm(text).join(' ').match(/Available Leases \((\d+) products?\)/i);
  return { leases, expected: (m ? Number(m[1]) : avail.length) - skipped.length, statedAvailable: m ? Number(m[1]) : null, productsAvailable: avail.length, skipped };
}

export function check(r) {
  const bad = r.leases.filter(l => !l.acres && !l.auction || !l.state);
  r.ok = r.leases.length === r.expected && bad.length === 0 && (r.statedAvailable == null || r.statedAvailable === r.productsAvailable);
  if (!r.ok) r.problem = `read ${r.leases.length}, page shows ${r.expected}` + (bad.length ? `; ${bad.length} missing acres/state: ${bad.map(b => b.id).join(', ')}` : '') + (r.statedAvailable != null && r.statedAvailable !== r.productsAvailable ? `; page says ${r.statedAvailable} available, product feed has ${r.productsAvailable}` : '');
  return r;
}
