// Proof run: can a scheduled job read public hunting-lease listings?
// Visits each source once, like a person would, with an ordinary browser.
// It does not log in, does not solve challenges, and does not disguise itself.
import { chromium } from 'playwright';
import fs from 'node:fs';

const SOURCES = (process.env.SOURCES_JSON ? JSON.parse(process.env.SOURCES_JSON) : [
  { id: 'premier',  name: 'Premier Hunting Leases',       url: 'https://www.premierhuntingleases.com/AvailableAreas/SearchProperties.aspx' },
  { id: 'greendiamond', name: 'Green Diamond Recreation', url: 'https://www.gdrecreation.com/AvailableAreas/SearchProperties.aspx' },
  { id: 'legacy',   name: 'Legacy Wildlife Services',     url: 'https://huntingleases.legacywildlife.com/AvailableAreas/SearchProperties.aspx' },
  { id: 'kingwood', name: 'Kingwood Forestry',            url: 'https://hunt.kingwoodforestry.com/AvailableAreas/SearchProperties.aspx' },
  { id: 'ctc',      name: 'Coastal Timberlands Company',  url: 'https://ctchunting.com/AvailableAreas/SearchProperties.aspx' },
  { id: 'bird',     name: 'Bird Forestry',                url: 'https://hunt.birdforestry.com/AvailableAreas/SearchProperties.aspx' },
  { id: 'campbell', name: 'Campbell Global',              url: 'https://www.cglease.com/AvailableAreas/SearchProperties.aspx' },
  { id: 'tir',      name: 'TIR Hunting Leases',           url: 'https://rlms.myoutdooragent.com/tir_HL/AvailableAreas/SearchProperties.aspx' },
]);

export const ACCESS = /\b(obtain|arrange|secure|provide|get)\b[^.\n]{0,40}\baccess\b|\bno (legal |deeded |road )?access\b|\baccess (is )?not (provided|available|included)\b/i;
export function parseResults(text) {
  const out = [];
  const blocks = text.split(/RLU No:/).slice(1);
  for (const b of blocks) {
    const g = (re) => { const m = b.match(re); return m ? m[1].trim() : null; };
    out.push({
      unit:   g(/^\s*([^\s]+)/),
      acres:  g(/Acres:\s*([\d,.]+)/),
      // "Autauga County, AL" on most sites; Campbell Global writes "Dallas-AR"
      place:  (g(/Location:\s*([A-Za-z .']+(?:-[A-Za-z .']+)*?(?:,\s*|-)[A-Z]{2})\b/) || '').replace(/\s*-\s*([A-Z]{2})$/, ', $1') || null,
      term:   g(/Term:\s*(\d{1,2}\/\d{1,2}\/\d{4}\s*to\s*\d{1,2}\/\d{1,2}\/\d{4}|[A-Z][a-z]{2} \d{1,2}, \d{4}\s*to\s*[A-Z][a-z]{2} \d{1,2}, \d{4})/),
      price:  g(/Price:\s*(\$[\d,]+(?:\.\d+)?)/),
      // the lister's comment is not copied; only whether it says the hunter must arrange access
      ownAccess: ACCESS.test(g(/Comments:\s*([^\n]+)/) || ''),
    });
  }
  return out;
}

async function readOrbis(browser, src) {
  const r = { id: src.id, name: src.name, ok: false, stated: null, leases: [], pages: 0, note: '' };
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(src.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    r.http = resp ? resp.status() : null;
    r.title = await page.title();
    const btn = page.getByRole('button', { name: 'Show Property List' });
    if (!(await btn.count())) {
      r.note = 'Search form not found. First text on page: ' + (await page.innerText('body')).slice(0, 300).replace(/\s+/g, ' ');
      return r;
    }
    await Promise.all([page.waitForURL(/SearchResults/i, { timeout: 45000 }), btn.first().click()]);
    await page.waitForLoadState('domcontentloaded');
    const seen = new Set();
    for (let p = 0; p < 30; p++) {
      const text = await page.innerText('body');
      if (p === 0) {
        const m = text.match(/Properties found for the search criteria:\s*(\d+)/i);
        r.stated = m ? Number(m[1]) : null;
      }
      let added = 0;
      for (const l of parseResults(text)) { if (l.unit && !seen.has(l.unit)) { seen.add(l.unit); r.leases.push(l); added++; } }
      r.pages = p + 1;
      if (r.stated === null || r.leases.length >= r.stated || !added) break;
      const next = page.getByRole('link', { name: String(p + 2), exact: true });
      if (!(await next.count())) break;
      await next.first().click();
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }
    r.complete = r.stated !== null && r.leases.length === r.stated && r.leases.every(l => l.acres && l.place);
    r.ok = r.complete;
    if (!r.complete) r.note = 'Count mismatch or missing fields: site says ' + r.stated + ', read ' + r.leases.length;
  } catch (e) {
    r.note = 'Error: ' + String(e.message || e).slice(0, 300);
  } finally {
    await ctx.close();
  }
  return r;
}

const started = new Date().toISOString();
const results = [];
let fatal = null;
try {
  const browser = await chromium.launch();
  for (const s of SOURCES) { results.push(await readOrbis(browser, s)); await new Promise(z => setTimeout(z, 3000)); }
  await browser.close();
} catch (e) { fatal = String(e.message || e).slice(0, 500); }

fs.mkdirSync('out', { recursive: true });
const report = { fatal, started, finished: new Date().toISOString(), sources: results.map(r => ({ ...r, leases: undefined, count: r.leases.length, missing: r.leases.filter(l => !l.term || !l.price).length })) };
fs.writeFileSync('out/report.json', JSON.stringify(report, null, 1));
fs.writeFileSync('out/feed.json', JSON.stringify({ updated: report.finished, leases: results.flatMap(r => r.leases.map(l => ({ source: r.name, ...l }))) }, null, 1));
console.log(JSON.stringify(report.sources.map(s => [s.id, s.ok, s.stated, s.count, s.note]), null, 1));
