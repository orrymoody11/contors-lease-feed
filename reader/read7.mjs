// Live run of the seven non-Orbis readers. Visits each page once with an ordinary browser,
// parses it, checks the count against the page itself, and writes out/feed7.json + out/report7.json.
import { chromium } from 'playwright';
import fs from 'node:fs';
import * as S from './sources.mjs';

const SOURCES = [
  { id: 'forecon', name: 'FORECON', url: 'https://www.foreconinc.com/services/huntlease/available-huntlease-listings', parse: (s, p) => S.parseForecon(s, p.text, p.links) },
  { id: 'bullcreek', name: 'Bull Creek Leasing', url: 'https://sites.google.com/view/bullcreekleasing/available-leases', parse: (s, p) => S.parseBullCreek(s, p.text) },
  { id: 'afoa', name: "Alabama Forest Owners' Association", url: 'https://afoa.org/hunt/', parse: (s, p) => S.parseAfoa(s, p.text) },
  { id: 'larson', name: 'Larson & McGowin', url: 'https://larsonmcgowin.com/properties/', parse: (s, p) => S.parseLarson(s, p.text, p.links) },
  { id: 'nebraska', name: 'Nebraska Board of Educational Lands and Funds', url: 'https://belf.nebraska.gov/recleases.html', parse: (s, p) => S.parseNebraska(s, p.text, p.links) },
  { id: 'growingassets', name: 'Growing Assets', url: 'https://growingassetsllc.com/hunting-leases/', parse: (s, p) => S.parseGrowingAssets(s, p.text, p.links) },
  { id: 'ushunts', name: 'US Hunts', url: 'https://ushunts.com/collections/available-leases', parse: (s, p) => S.parseUsHunts(s, p.text, p.products, p.states) },
];

async function grab(ctx, url) {
  const page = await ctx.newPage();
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  const text = await page.innerText('body');
  const links = await page.$$eval('a[href]', as => as.map(a => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 80) })));
  return { page, http: resp ? resp.status() : null, text, links };
}

const started = new Date().toISOString();
const results = [];
let fatal = null;
try {
  const browser = await chromium.launch();
  for (const s of SOURCES) {
    const ctx = await browser.newContext();
    const r = { id: s.id, name: s.name, url: s.url, ok: false, leases: [] };
    try {
      const p = await grab(ctx, s.url);
      r.http = p.http;
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
      Object.assign(r, s.parse(s, p));
      if (s.id === 'nebraska') {
        for (const l of r.leases) {
          if (l.url === s.url) continue;
          try { const d = await grab(ctx, l.url); const x = S.parseNebraskaDetail(d.text); await d.page.close();
            if (x.price) { l.price = x.price; l.priceText = x.priceText; }
            if (x.acres) l.acres = x.acres;
          } catch (e) { l.detailError = String(e.message || e).slice(0, 120); }
          await new Promise(z => setTimeout(z, 1500));
        }
      }
      S.check(r);
    } catch (e) { r.problem = 'Error: ' + String(e.message || e).slice(0, 300); }
    await ctx.close();
    results.push(r);
    await new Promise(z => setTimeout(z, 3000));
  }
  await browser.close();
} catch (e) { fatal = String(e.message || e).slice(0, 500); }

fs.mkdirSync('out', { recursive: true });
const finished = new Date().toISOString();
fs.writeFileSync('out/report7.json', JSON.stringify({ fatal, started, finished, sources: results.map(r => ({ id: r.id, ok: r.ok, http: r.http, count: r.leases.length, expected: r.expected, problem: r.problem || null, skipped: r.skipped || [], stateFilter: r.stateFilter })) }, null, 1));
fs.writeFileSync('out/feed7.json', JSON.stringify({ updated: finished, leases: results.flatMap(r => r.leases) }, null, 1));
console.log(JSON.stringify(results.map(r => [r.id, r.ok, r.leases.length, r.expected, r.problem || '']), null, 1));
