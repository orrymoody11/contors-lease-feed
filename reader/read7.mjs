// Live run of the seven non-Orbis readers. Visits each page once with an ordinary browser,
// parses it, checks the count against the page itself, and writes out/feed7.json + out/report7.json.
import { chromium } from 'playwright';
import fs from 'node:fs';
import * as S from './sources.mjs';
import * as M from './more.mjs';
import * as P from './pageload.mjs';

const SOURCES = [
  { id: 'forecon', name: 'FORECON', url: 'https://www.foreconinc.com/services/huntlease/available-huntlease-listings', parse: (s, p) => S.parseForecon(s, p.text, p.links) },
  { id: 'bullcreek', name: 'Bull Creek Leasing', url: 'https://sites.google.com/view/bullcreekleasing/available-leases', parse: (s, p) => S.parseBullCreek(s, p.text) },
  { id: 'afoa', name: "Alabama Forest Owners' Association", url: 'https://afoa.org/hunt/', parse: (s, p) => S.parseAfoa(s, p.text) },
  { id: 'larson', name: 'Larson & McGowin', url: 'https://larsonmcgowin.com/properties/', parse: (s, p) => S.parseLarson(s, p.text, p.links) },
  { id: 'nebraska', name: 'Nebraska Board of Educational Lands and Funds', url: 'https://belf.nebraska.gov/recleases.html', parse: (s, p) => S.parseNebraska(s, p.text, p.links) },
  { id: 'growingassets', name: 'Growing Assets', url: 'https://growingassetsllc.com/hunting-leases/', parse: (s, p) => S.parseGrowingAssets(s, p.text, p.links) },
  { id: 'afm', name: 'American Forest Management', url: 'https://afmhuntportal.com/huntersportal', parse: (s, p) => M.parseAfm(s, p.text) },
  { id: 'bluesky', name: 'Blue Sky Real Estate', url: 'https://www.blueskyparealestate.com/hunting-properties-2/', parse: (s, p) => M.parseBlueSky(s, p.text, p.links) },
  { id: 'redrock', name: 'Red Rock Wildlife', url: 'https://redrockwildlife.com/hunting-leases/', parse: (s, p) => M.parseRedRock(s, p.text) },
  { id: 'martinranch', name: 'Martin Ranch Management', url: 'https://www.martinranch.com/leases/', parse: (s, p) => M.parseMartinRanch(s, p.text, p.links) },
  { id: 'ushunts', name: 'US Hunts', url: 'https://ushunts.com/collections/available-leases', parse: (s, p) => S.parseUsHunts(s, p.text, p.products, p.states) },
];

async function grab(ctx, url, detail = false) {
  const page = await ctx.newPage();
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  // every source: load every listing (scroll, "Load more", "Next" pages) and run the photo check
  const all = await P.loadAll(page, detail ? { photos: false, maxPages: 1 } : {});
  return { page, http: resp ? resp.status() : null, text: all.texts[0] || '', texts: all.texts, links: all.links, imgs: all.imgs, stamps: all.stamps, photoCheck: all.photoCheck };
}

const started = new Date().toISOString();
const results = [];
let fatal = null;
try {
  const browser = await chromium.launch();
  for (const s of SOURCES) {
    const ctx = await browser.newContext();
    const r = { id: s.id, name: s.name, url: s.url, ok: false, leases: [] };
    for (let attempt = 1; attempt <= 2; attempt++) {
    r.leases = []; r.problem = null; r.ok = false;
    try {
      const p = await grab(ctx, s.url);
      r.http = p.http; r.pageTitle = await p.page.title().catch(() => null);
      if (s.id === 'ushunts') {
        const j = await p.page.request.get('https://ushunts.com/collections/available-leases/products.json?limit=250');
        if (!j.ok()) throw new Error('product feed HTTP ' + j.status());
        p.products = (await j.json()).products;
        // The site's own State filter says which state each listing is in; read it rather than guess.
        p.states = {};
        const opts = await p.page.$$eval('input[name^="filter."]', is => is.map(i => ({ name: i.name, value: i.value })));
        for (const o of opts.filter(o => /^[A-Za-z ]+$/.test(o.value) && /(^|\W)state/i.test(o.name))) {
          const f = await ctx.newPage();
          await f.goto(`${s.url}?${encodeURIComponent(o.name)}=${encodeURIComponent(o.value)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await f.waitForTimeout(2500);
          for (const h of await f.$$eval('a[href*="/products/"]', as => as.map(a => a.href.split('/products/')[1].split(/[?#]/)[0]))) p.states[h] = o.value;
          await f.close();
        }
        r.stateFilter = opts.filter(o => /state/i.test(o.name)).map(o => o.name + '=' + o.value);
      }
      Object.assign(r, P.soldFilter(P.parsePages(t => s.parse(s, { ...p, text: t }), p.texts.length ? p.texts : [p.text]), p.stamps));
      if (r.pageProblem) r.problem = r.pageProblem;
      r.photoCheck = p.photoCheck; r.pages = p.texts.length;
      if (s.id === 'nebraska') {
        for (const l of r.leases) {
          if (l.url === s.url) continue;
          try { const d = await grab(ctx, l.url, true); const x = S.parseNebraskaDetail(d.text); await d.page.close();
            if (x.price) { l.price = x.price; l.priceText = x.priceText; }
            if (x.acres) l.acres = x.acres;
          } catch (e) { l.detailError = String(e.message || e).slice(0, 120); }
          await new Promise(z => setTimeout(z, 1500));
        }
      }
      if (s.id === 'bluesky') {
        for (const l of r.leases) {
          try { const d = await grab(ctx, l.url, true); l.price = M.parseBlueSkyDetail(d.text); l.priceText = l.price ? `$${l.price} annual fee` : null; await d.page.close(); }
          catch (e) { l.detailError = String(e.message || e).slice(0, 120); }
          await new Promise(z => setTimeout(z, 1500));
        }
      }
      S.check(r);
    } catch (e) { r.problem = 'Error: ' + String(e.message || e).slice(0, 300); }
    r.attempts = attempt;
    if (r.ok || attempt === 2) break;
    await new Promise(z => setTimeout(z, 20000)); // one retry after a pause: a page that failed to load once often loads the second time
    }
    await ctx.close();
    results.push(r);
    await new Promise(z => setTimeout(z, 3000));
  }
  await browser.close();
} catch (e) { fatal = String(e.message || e).slice(0, 500); }

fs.mkdirSync('out', { recursive: true });
const finished = new Date().toISOString();
fs.writeFileSync('out/report7.json', JSON.stringify({ fatal, started, finished, sources: results.map(r => ({ id: r.id, name: r.name, ok: r.ok, http: r.http, count: r.leases.length, expected: r.expected, problem: r.problem || null, skipped: r.skipped || [], stateFilter: r.stateFilter, attempts: r.attempts, seen: r.seen || null, pages: r.pages || null, photoCheck: r.photoCheck || null, pageTitle: r.pageTitle || null })) }, null, 1));
fs.writeFileSync('out/feed7.json', JSON.stringify({ updated: finished, leases: results.flatMap(r => r.leases) }, null, 1));
console.log(JSON.stringify(results.map(r => [r.id, r.ok, r.leases.length, r.expected, r.problem || '']), null, 1));
