// Readers for sources added after the first thirteen. Same contract as sources.mjs:
// each parser returns { leases, expected, skipped } and passes only if every listing on the page was read.
import { norm } from './sources.mjs';
const STATES = { ALABAMA:'AL', ARKANSAS:'AR', FLORIDA:'FL', GEORGIA:'GA', KENTUCKY:'KY', LOUISIANA:'LA', MISSISSIPPI:'MS', MISSOURI:'MO', 'NEW YORK':'NY', 'NORTH CAROLINA':'NC', OKLAHOMA:'OK', PENNSYLVANIA:'PA', 'SOUTH CAROLINA':'SC', TENNESSEE:'TN', TEXAS:'TX', VIRGINIA:'VA', 'WEST VIRGINIA':'WV', MAINE:'ME', MICHIGAN:'MI', WISCONSIN:'WI', OREGON:'OR', WASHINGTON:'WA', 'NEW HAMPSHIRE':'NH', VERMONT:'VT', OHIO:'OH', KANSAS:'KS', NEBRASKA:'NE', IOWA:'IA', ILLINOIS:'IL', INDIANA:'IN', MINNESOTA:'MN', IDAHO:'ID', MONTANA:'MT', CALIFORNIA:'CA', ARIZONA:'AZ', 'NEW MEXICO':'NM', COLORADO:'CO', MARYLAND:'MD', DELAWARE:'DE', 'NEW JERSEY':'NJ', CONNECTICUT:'CT', MASSACHUSETTS:'MA', 'RHODE ISLAND':'RI', 'SOUTH DAKOTA':'SD', 'NORTH DAKOTA':'ND', WYOMING:'WY', UTAH:'UT', NEVADA:'NV', ALASKA:'AK', HAWAII:'HI' };
const stateCode = (s) => s ? (STATES[s.trim().toUpperCase()] || (/^[A-Z]{2}$/.test(s.trim()) ? s.trim() : null)) : null;
const num = (s) => { if (s == null) return null; const n = Number(String(s).replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const cleanCounty = (s) => s ? s.replace(/\s+(county|parish|co\.?)$/i, '').trim().toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()) : null;
const lease = (src, o) => ({ id: `${src.id}:${o.unit}`, source: src.name, sourceId: src.id, url: o.url || src.url, name: o.name || null, state: o.state || null,
  county: o.county || null, acres: o.acres ?? null, price: o.price ?? null, priceText: o.priceText || null, per: o.per || null, term: o.term || null,
  posted: null, auction: null, lat: null, lng: null, note: o.note || null });

// ---------- American Forest Management (hunt portal, several states) ----------
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
      acres: ap ? num(ap[1]) : null, price: ap ? num(ap[2]) : null, per: 'year', priceText: ap ? `$${ap[2]}` : null }));
  });
  // a page that never showed its list must fail, not pass as "no leases"
  return { leases, expected: starts.length ? starts.length - skipped.length : null, skipped };
}
