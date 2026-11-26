// Offline tests for more.mjs against placeholder copies of the page layouts (reader/fixtures).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as M from './more.mjs';
import { check } from './sources.mjs';
import { fromOther } from './combine.mjs';
const F = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const src = (id, name, url) => ({ id, name, url });
const by = (r, id) => r.leases.find(l => l.id === id);

let r = check(M.parseAfm(src('afm', 'American Forest Management', 'u'), F('afm.txt')));
assert.equal(r.ok, true, r.problem); assert.equal(r.leases.length, 2); assert.deepEqual(r.skipped, ['100003 (Camp Lease)']);
assert.deepEqual(['state', 'county', 'acres', 'price'].map(k => by(r, 'afm:100001')[k]), ['PA', 'Cameron', 289.59, 3115.98]);
assert.deepEqual(['state', 'county', 'acres', 'price'].map(k => by(r, 'afm:100002')[k]), ['LA', 'Beauregard', 169.13, 1139.94]);
r = check(M.parseAfm(src('afm', 'AFM', 'u'), 'Available Properties\nLoading'));
assert.equal(r.ok, false);
const links = (n) => F(n).split('\n').filter(Boolean).map(l => ({ href: l.split('|')[0], text: l.split('|')[1] }));
r = check(M.parseBlueSky(src('bluesky', 'Blue Sky Real Estate', 'u'), F('bluesky.txt'), links('bluesky.links.txt')));
assert.equal(r.ok, true, r.problem); assert.equal(r.leases.length, 3);
assert.deepEqual(r.leases.map(l => [l.acres, l.county, l.state, l.url.split('/')[4]]), [[60, 'Clearfield', 'PA', 'huston-60'], [19.5, 'Clearfield', 'PA', 'huston-19'], [20, 'McKean', 'PA', 'lafayette-20']]);
r = check(M.parseBlueSky(src('bluesky', 'B', 'u'), F('bluesky.txt'), links('bluesky.links.txt').slice(1)));
assert.equal(r.ok, false);
assert.equal(M.parseBlueSkyDetail('ADDRESS:\nANNUAL FEE: $2,280 – payable to X'), 2280);
assert.equal(M.parseBlueSkyDetail('no fee here'), null);
// billing period comes from the term, never assumed
import('./combine.mjs').then(({ fromOrbis, fromOther }) => {
  const row = { id: 'campbell', name: 'Campbell Global' }, o = (term) => fromOrbis({ unit: 'X', acres: '20', place: 'Autauga County, AL', term, price: '$150' }, row).per;
  assert.equal(o('5/1/2025 to 5/31/2027'), 'term'); assert.equal(o('11/1/2026 to 6/30/2027'), 'term');
  assert.equal(o('7/1/2026 to 6/30/2027'), 'year'); assert.equal(o('8/14/2026 to 8/13/2027'), 'year'); assert.equal(o(null), null);
  const a = check(M.parseAfm(src('afm', 'American Forest Management', 'u'), F('afm.txt'))).leases[0];
  assert.equal(fromOther({ ...a, sourceId: 'afm' }).per, null);
  console.log('all new-reader tests passed');
});

// Red Rock Wildlife: only "Available" cards, county or "the <town> area"
{ const t = fs.readFileSync(new URL('./fixtures/redrock.txt', import.meta.url), 'utf8');
  const r = M.parseRedRock({ id: 'redrock', name: 'Red Rock Wildlife', url: 'https://redrockwildlife.com/hunting-leases/' }, t);
  assert.equal(r.leases.length, 2); assert.equal(r.expected, 2);
  const h = r.leases.find(l => l.acres === 320); assert.equal(h.state, 'KS'); assert.equal(h.place, 'the Horton area, Kansas'); assert.equal(h.county, null);
  const o = r.leases.find(l => l.acres === 73); assert.equal(o.state, 'MO'); assert.equal(o.county, 'Holt');
  const c = fromOther(h); assert.equal(c.county, 'the Horton area, Kansas'); assert.equal(fromOther(o).county, 'Holt County');
  // a status button that is not in a well-formed card makes the read fail instead of guessing
  assert.equal(M.parseRedRock({ id: 'redrock', name: 'R' }, t + '\nAvailable').expected, null); }

// Martin Ranch: only the current-year group; an old year reads as none
{ const t = fs.readFileSync(new URL('./fixtures/martin.txt', import.meta.url), 'utf8'), src = { id: 'martinranch', name: 'Martin Ranch Management', url: 'https://www.martinranch.com/leases/' };
  const r = M.parseMartinRanch(src, t, [], new Date('2026-11-26T00:00:00Z'));
  assert.equal(r.leases.length, 1); assert.equal(r.expected, 1); assert.equal(r.leases[0].acres, 1351); assert.equal(r.leases[0].place, 'the Rocksprings area, Texas');
  const old = M.parseMartinRanch(src, t, [], new Date('2027-07-01T00:00:00Z')); assert.equal(old.leases.length, 0); assert.equal(old.expected, 0); }
console.log('red rock and martin ranch tests passed');
