// Combines the platform readers (out/feed.json + out/report.json) and the seven other readers
// (out/feed7.json + out/report7.json) into ONE feed: out/leases.json.
// Guards: a failed source keeps its last good listings (up to 3 days); a sudden drop counts as a failure;
// tracts under 10 acres are left out (auctions excepted); an aggregator's copy of a lease is dropped
// when the lister's own page is also in the feed.
import fs from 'node:fs';

export const KIND = { premier: 'timber', greendiamond: 'timber', legacy: 'timber', kingwood: 'timber', ctc: 'timber', bird: 'timber', campbell: 'timber', tir: 'timber', afm: 'timber', bluesky: 'timber',
  forecon: 'timber', bullcreek: 'timber', larson: 'timber', growingassets: 'timber', afoa: 'market', ushunts: 'market', nebraska: 'public' };
export const ORBIS_URL = { premier: 'https://www.premierhuntingleases.com/AvailableAreas/SearchProperties.aspx', greendiamond: 'https://www.gdrecreation.com/AvailableAreas/SearchProperties.aspx',
  legacy: 'https://huntingleases.legacywildlife.com/AvailableAreas/SearchProperties.aspx', kingwood: 'https://hunt.kingwoodforestry.com/AvailableAreas/SearchProperties.aspx',
  ctc: 'https://ctchunting.com/AvailableAreas/SearchProperties.aspx', bird: 'https://hunt.birdforestry.com/AvailableAreas/SearchProperties.aspx',
  campbell: 'https://www.cglease.com/AvailableAreas/SearchProperties.aspx', tir: 'https://rlms.myoutdooragent.com/tir_HL/AvailableAreas/SearchProperties.aspx' };
const MIN_ACRES = 10, STALE_DAYS = 3, DROP_SHARE = 0.5, DROP_MIN = 4;
const num = (s) => { if (s == null) return null; const n = Number(String(s).replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const dt = (s) => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
const nice = (iso) => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null;
export const countyName = (c, st) => !c ? null : /\b(County|Parish|Borough)$/.test(c) ? c.replace(/ County$/, st === 'LA' ? ' Parish' : ' County') : `${c} ${st === 'LA' ? 'Parish' : 'County'}`;

export function fromOrbis(l, srcRow) {
  const m = (l.place || '').match(/^(.+?),\s*([A-Z]{2})$/);
  const st = m ? m[2] : null;
  const t = (l.term || '').match(/(.+?)\s*to\s*(.+)/);
  const term = t ? `${nice(dt(t[1]))} to ${nice(dt(t[2]))}` : null;
  // the price covers the lease term: call it yearly only when the term is about a year
  const months = t && dt(t[1]) && dt(t[2]) ? (new Date(dt(t[2])) - new Date(dt(t[1]))) / 2.63e9 : null;
  const per = months == null ? null : months >= 10 && months <= 13.5 ? 'year' : 'term';
  return { id: `${srcRow.id}:${l.unit}`, sourceId: srcRow.id, source: srcRow.name, kind: KIND[srcRow.id] || 'timber', url: ORBIS_URL[srcRow.id] || null,
    unit: l.unit, name: `Unit ${l.unit}`, state: st, county: countyName(m ? m[1] : null, st), acres: num(l.acres), price: num(l.price), per,
    term, note: (l.ownAccess ? 'The lister says you must arrange your own access. ' : '') + 'Find it by unit number on the lister\'s search page.' };
}
export function fromOther(l) {
  const out = { id: l.id, sourceId: l.sourceId, source: l.source, kind: KIND[l.sourceId] || 'timber', url: l.url, unit: l.id.split(':').slice(1).join(':'), name: l.name,
    state: l.state, county: countyName(l.county, l.state), acres: l.acres, price: l.price, per: l.per && /season/.test(l.per) ? 'season' : l.per && /year/.test(l.per) ? 'year' : null,
    term: l.term ? l.term.replace(/\s+thru\s+/i, ' to ') : l.term, note: l.note };
  if (l.sourceId === 'growingassets' && /\/acre/i.test(l.priceText || '')) { out.pricePerAcre = num(l.priceText); out.per = 'year'; out.note = `$${out.pricePerAcre.toFixed(2)} an acre plus insurance; the lister does not say if it is billed yearly or by season.`; }
  if (l.sourceId === 'ushunts') out.note = l.note;
  if (l.sourceId === 'forecon') { out.note = 'Call or email the forester for the price.'; out.posted = l.posted; }
  if (l.sourceId === 'afoa') out.posted = l.posted;
  if (l.sourceId === 'afm') out.note = 'Find it by property ID on the lister\'s page.';
  if (l.sourceId === 'larson') out.name = `${l.acres} acres in ${out.county}`;
  if (l.sourceId === 'nebraska') { out.per = 'auction'; out.auction = l.auction; out.priceLabel = l.priceText; }
  if (l.lat != null) { out.lat = l.lat; out.lng = l.lng; }
  return out;
}

export function combine({ orbisFeed, orbisReport, feed7, report7, prev, now = new Date() }) {
  const nowIso = now.toISOString();
  const status = {};
  for (const s of orbisReport?.sources || []) status[s.id] = { id: s.id, name: s.name, ok: !!s.ok && !orbisReport.fatal, count: s.count, problem: s.note || null };
  for (const s of report7?.sources || []) status[s.id] = { id: s.id, name: s.name || null, ok: !!s.ok && !report7.fatal, count: s.count, problem: s.problem || null };
  const byName = Object.fromEntries((orbisReport?.sources || []).map(s => [s.name, s]));
  let fresh = [];
  for (const l of orbisFeed?.leases || []) { const s = byName[l.source]; if (s) fresh.push(fromOrbis(l, s)); }
  for (const l of feed7?.leases || []) { fresh.push(fromOther(l)); if (status[l.sourceId]) status[l.sourceId].name = l.source; }
  const prevById = Object.fromEntries((prev?.leases || []).map(l => [l.id, l]));
  const prevSrc = Object.fromEntries((prev?.sources || []).map(s => [s.id, s]));
  const issues = [];
  // sudden drop counts as a failure
  for (const s of Object.values(status)) {
    const p = prevSrc[s.id];
    if (s.ok && p && p.count >= DROP_MIN && s.count < p.count * DROP_SHARE) { s.ok = false; s.problem = `count fell from ${p.count} to ${s.count}`; }
    if (!s.ok) issues.push(`${s.id}: ${s.problem || 'failed'}`);
  }
  // a source missing from this run entirely (e.g. its reader crashed) is a failure too
  for (const p of prev?.sources || []) if (!status[p.id]) { status[p.id] = { id: p.id, name: p.name, ok: false, count: 0, problem: 'not in this run' }; issues.push(`${p.id}: not in this run`); }
  const leases = [];
  for (const l of fresh) if (status[l.sourceId]?.ok) leases.push({ ...l, firstSeen: prevById[l.id]?.firstSeen || nowIso, lastSeen: nowIso });
  // failed source: keep its last good listings until they are STALE_DAYS old
  for (const s of Object.values(status)) {
    if (s.ok) continue;
    const keep = (prev?.leases || []).filter(l => l.sourceId === s.id && (now - new Date(l.lastSeen)) / 864e5 <= STALE_DAYS);
    leases.push(...keep);
    s.count = keep.length; s.lastGood = prevSrc[s.id]?.lastGood || null; s.carried = keep.length;
  }
  for (const s of Object.values(status)) if (s.ok) s.lastGood = nowIso;
  // small tracts out (auctions have no acreage on the list)
  const small = leases.filter(l => l.per !== 'auction' && (l.acres == null || l.acres < MIN_ACRES));
  let out = leases.filter(l => !small.includes(l));
  // aggregator copy of a lease whose lister is also in the feed
  const dropped = [];
  out = out.filter(l => {
    const via = (l.note || '').match(/Posted by (.+?)\./);
    if (!via) return true;
    const lister = out.find(o => o !== l && o.source === via[1] && o.state === l.state && o.county === l.county && o.acres === l.acres);
    if (lister) { dropped.push(`${l.id} (same as ${lister.source})`); return false; }
    return true;
  });
  for (const l of out) {
    if (l.price && l.acres && l.per !== 'auction' && !l.pricePerAcre) l.pricePerAcre = Math.round(l.price / l.acres * 100) / 100;
  }
  // same tract under two listers (not an aggregator copy): keep both, but report it
  const seen = {};
  for (const l of out) { const k = [l.state, l.county, l.acres, l.price].join('|'); if (seen[k] && seen[k] !== l.sourceId) issues.push(`possible duplicate: ${l.id} and a ${seen[k]} lease`); seen[k] = l.sourceId; }
  out.sort((a, b) => a.state.localeCompare(b.state) || (a.county || '').localeCompare(b.county || '') || (b.acres || 0) - (a.acres || 0));
  const sources = Object.values(status).sort((a, b) => a.id.localeCompare(b.id)).map(s => ({ id: s.id, name: s.name || prevSrc[s.id]?.name || null, ok: s.ok, count: out.filter(l => l.sourceId === s.id).length, lastGood: s.lastGood || null, problem: s.ok ? null : s.problem }));
  for (const s of sources) if (s.ok && s.count === 0 && (prevSrc[s.id]?.count || 0) > 0) issues.push(`${s.id}: now shows no open leases`);
  return { feed: { version: 1, updated: nowIso, count: out.length, states: [...new Set(out.map(l => l.state))].sort(), sources, leases: out },
    report: { updated: nowIso, ok: sources.every(s => s.ok), issues, leftOutSmall: small.map(l => `${l.id} (${l.acres} acres)`), droppedCopies: dropped } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rd = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
  const { feed, report } = combine({ orbisFeed: rd('out/feed.json'), orbisReport: rd('out/report.json'), feed7: rd('out/feed7.json'), report7: rd('out/report7.json'), prev: rd('out/leases.json') });
  fs.writeFileSync('out/leases.json', JSON.stringify(feed));
  fs.writeFileSync('out/leases-report.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ count: feed.count, states: feed.states.length, ok: report.ok, issues: report.issues }, null, 1));
}
