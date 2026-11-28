// Shared by every source in read7.mjs. Two jobs, the same for every site:
//
// 1. loadAll: get every listing onto the page before it is read. Scrolls the window and any
//    scrolling box to the end until nothing new appears, clicks "Load more"-style buttons, and
//    follows "Next" pages. Returns one text per page (a site with one page gives one text).
//    (A site that shows only the first 10 until you scroll is how American Forest Management's
//    Washington, New York and Oklahoma leases were missed, Nov 2026.)
//
// 2. Photo check: some listers mark a lease taken only by stamping SOLD or LEASED on its picture
//    while the text still says available (Martin Ranch, Nov 2026). Each sizable picture is read
//    with tesseract (grayscale, shown at 3x, which is what reads a white-on-red stamp reliably);
//    a stamped picture's own card text is kept, and soldFilter drops the lease that card
//    describes. If tesseract is not installed, nothing is dropped and the report says so.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MORE = /^(load|show|view|see)\s+more\b/i;
const NEXT = /^(next|next page|›|»|>)$/i;
export const STAMP = /\b(SOLD|LEASED|RENTED)\b/;

async function bodyText(page) { return page.innerText('body').catch(() => ''); }

async function scrollToEnd(page, { pause, maxRounds }) {
  let len = (await bodyText(page)).length, still = 0;
  for (let i = 0; i < maxRounds && still < 2; i++) {
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
      }
    });
    await page.waitForTimeout(pause);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // a visible "Load more" button counts as more to load (never a link to another page)
    let clicked = false;
    if (await mark(page, 'more', 0)) {
      await page.locator('[data-lzpick="more"]').first().click({ timeout: 5000 }).catch(() => {});
      clicked = true; await page.waitForTimeout(pause);
    }
    const n = (await bodyText(page)).length;
    if (n > len || clicked) { if (n > len) still = 0; else still++; len = Math.max(len, n); } else still++;
  }
}

// Marks (data-lzpick) the first visible control of a kind, in one pass inside the page:
//   'more' - a "Load more"/"Show more" button that stays on this page
//   'next' - a "Next" (or ›, ») control, or else the link for the next page number (pageNo + 1)
async function mark(page, kind, pageNo) {
  return page.evaluate(({ kind, pageNo, MORE, NEXT }) => {
    const more = new RegExp(MORE, 'i'), next = new RegExp(NEXT, 'i');
    document.querySelectorAll('[data-lzpick]').forEach(e => e.removeAttribute('data-lzpick'));
    const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const off = e => e.disabled || e.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/.test((e.className || '') + ' ' + (e.parentElement ? e.parentElement.className || '' : ''));
    const leaves = e => { const h = e.getAttribute('href') || ''; if (!h || h[0] === '#' || /^javascript:/i.test(h)) return false;
      try { const u = new URL(h, location.href); return u.pathname + u.search !== location.pathname + location.search; } catch (x) { return false; } };
    const all = [...document.querySelectorAll('a, button, [role=button]')].filter(e => vis(e) && !off(e));
    const txt = e => (e.innerText || '').trim(), al = e => (e.getAttribute('aria-label') || '').trim();
    let pick = null;
    if (kind === 'more') pick = all.find(e => more.test(txt(e)) && !leaves(e));
    else pick = all.find(e => next.test(txt(e)) || /^next( page)?$/i.test(al(e))) || all.find(e => txt(e) === String(pageNo + 1) && /(^|\D)1(\D|$)/.test((e.parentElement && e.parentElement.parentElement || document.body).innerText || ''));
    if (pick) pick.setAttribute('data-lzpick', kind);
    return !!pick;
  }, { kind, pageNo, MORE: MORE.source, NEXT: NEXT.source }).catch(() => false);
}

// Reads every sizable picture on the page; returns the card text around each one stamped SOLD/LEASED/RENTED.
export async function stampedCards(page, { maxImages = 120 } = {}) {
  if (!(await hasTesseract())) return { available: false, stamps: [], checked: 0 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lzocr-'));
  const handles = await page.$$('img');
  const seen = new Set(), stamps = [];
  let checked = 0;
  for (const h of handles) {
    if (checked >= maxImages) break;
    const info = await h.evaluate(img => {
      const r = img.getBoundingClientRect();
      return { src: img.currentSrc || img.src || '', w: r.width, h: r.height, vis: getComputedStyle(img).visibility !== 'hidden' && r.width > 0 };
    }).catch(() => null);
    if (!info || !info.vis || info.w < 120 || info.h < 80 || seen.has(info.src)) continue;
    seen.add(info.src); checked++;
    try {
      await h.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      // a picture that loads only when scrolled into view: wait for it (up to 4 s)
      await h.evaluate(img => img.complete && img.naturalWidth ? 0 : new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); setTimeout(r, 4000); })).catch(() => {});
      const shot = await h.screenshot({ timeout: 8000 });
      const file = path.join(dir, `i${checked}.png`);
      fs.writeFileSync(file, await enlargeGray(page, shot));
      const words = await ocr(file);
      if (STAMP.test(words)) {
        const card = await h.evaluate(img => {
          let e = img.parentElement;
          while (e && (e.innerText || '').trim().length < 15) e = e.parentElement;
          return e ? e.innerText.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
        });
        stamps.push({ src: info.src, card, word: (words.match(STAMP) || [])[1] });
      }
    } catch (e) { /* one unreadable picture never stops the read */ }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (_canvasPage && !_canvasPage.isClosed()) { await _canvasPage.close().catch(() => {}); _canvasPage = null; }
  return { available: true, stamps, checked };
}

// 3x larger and grayscale, drawn in a blank page of the same browser (no extra tools needed).
// This is what reads a white-on-red SOLD stamp reliably; at its on-screen size it is missed.
let _canvasPage = null;
async function enlargeGray(page, png) {
  if (!_canvasPage || _canvasPage.isClosed()) _canvasPage = await page.context().newPage();
  const url = 'data:image/png;base64,' + png.toString('base64');
  const out = await _canvasPage.evaluate(async (u) => {
    const im = new Image(); im.src = u; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width * 3; c.height = im.height * 3;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.filter = 'grayscale(1)';
    x.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/png').split(',')[1];
  }, url);
  return Buffer.from(out, 'base64');
}

let _tess = null;
export function hasTesseract() {
  if (_tess !== null) return Promise.resolve(_tess);
  return new Promise(res => execFile('tesseract', ['--version'], err => res(_tess = !err)));
}
function ocr(file) {
  return new Promise(res => execFile('tesseract', [file, '-', '--psm', '11'], { timeout: 20000 }, (err, out) => res(err ? '' : String(out))));
}

// Loads every listing (all scroll-loads, "Load more" clicks and "Next" pages). Returns
// { texts, links, imgs, stamps, photoCheck }.
export async function loadAll(page, { pause = 1500, maxRounds = 30, maxPages = 20, photos = true } = {}) {
  const texts = [], links = [], imgs = [], stamps = [];
  let photoCheck = photos ? null : 'off', pics = 0;
  for (let p = 0; p < maxPages; p++) {
    await scrollToEnd(page, { pause, maxRounds });
    const t = await bodyText(page);
    if (texts.includes(t)) break; // "Next" led back to a page already read
    texts.push(t);
    links.push(...await page.$$eval('a[href]', as => as.map(a => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 80) }))).catch(() => []));
    imgs.push(...await page.$$eval('img', is => is.map(i => ({ src: i.currentSrc || i.src || '', alt: (i.alt || '').trim().slice(0, 120) }))).catch(() => []));
    if (photos) {
      const s = await stampedCards(page);
      stamps.push(...s.stamps);
      pics += s.checked;
      photoCheck = s.available ? `${pics} pictures read, ${stamps.length} stamped` : 'tesseract not installed: photo check skipped';
    }
    if (p + 1 >= maxPages || !(await mark(page, 'next', p + 1))) break;
    await page.locator('[data-lzpick="next"]').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(pause);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }
  return { texts, links, imgs, stamps, photoCheck };
}

// Parses each page's text with the source's own reader, then merges by lease id. Each page must
// pass its own count check; the merged count is what was read across all pages.
export function parsePages(parse, texts) {
  const parts = texts.map(parse);
  if (parts.length === 1) return parts[0];
  const byId = new Map(), skipped = new Set();
  let bad = null;
  for (const r of parts) {
    if (r.expected == null || r.expected !== r.leases.length) bad = bad || `a page read ${r.leases.length}, page shows ${r.expected}`;
    for (const l of r.leases) if (!byId.has(l.id)) byId.set(l.id, l);
    for (const s of r.skipped || []) skipped.add(s);
  }
  const leases = [...byId.values()];
  return { ...parts[0], leases, skipped: [...skipped], expected: bad ? null : leases.length, pageProblem: bad, pages: parts.length };
}

// Drops a lease whose own card carries a SOLD/LEASED/RENTED stamp. The stamp's card must name the
// lease's acres (1351 or 1,351) and one more detail of it (county, place, name or unit), so a stamp
// on a nearby or unrelated picture never takes the wrong lease down.
export function soldFilter(r, stamps) {
  if (!stamps.length) return r;
  const keep = [], gone = [];
  for (const l of r.leases) {
    const hit = stamps.find(s => cardIsLease(s.card, l));
    if (hit) gone.push(`${l.id} (picture marked ${hit.word})`); else keep.push(l);
  }
  if (!gone.length) return r;
  return { ...r, leases: keep, skipped: [...(r.skipped || []), ...gone], expected: r.expected == null ? null : r.expected - gone.length };
}

export function cardIsLease(card, l) {
  const c = String(card || '').toLowerCase();
  if (!c || !l.acres) return false;
  const a = Math.round(Number(l.acres)), forms = [String(a), a.toLocaleString('en-US'), String(l.acres)];
  if (!forms.some(f => new RegExp('(^|[^\\d.,])' + f.replace(/[.,]/g, m => '\\' + m) + '([^\\d]|$)').test(c))) return false;
  const words = [l.county, l.name, String(l.id || '').split(':').slice(1).join(':'), (String(l.place || '').match(/^the (.+?) area/i) || [])[1]]
    .filter(Boolean).map(w => String(w).toLowerCase().replace(/\s+(county|parish)$/, '').trim()).filter(w => w.length >= 3);
  return words.some(w => c.includes(w));
}
