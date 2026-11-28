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

// Shared page loader (pageload.mjs): pages merge by id; a stamped picture drops only the lease its card names
{ const P = await import('./pageload.mjs');
  const blk = (id, st, co, type) => `Property ID:${id}\n\nCounty: ${co}\nState: ${st}\nDistrict: X\nNumber of Tracts:1\n\n100.5 Acres / $1,000.00\nLease Type\n\n${type}\nView Details\n`;
  const s = { id: 'afm', name: 'American Forest Management', url: 'u' };
  // AFM's own Lease Type: permits are not leases
  const one = M.parseAfm(s, blk(1, 'Louisiana', 'Beauregard', 'Hunt Lease') + blk(2, 'Washington', 'Pacific', 'Hunt Permit - Drive-in'));
  assert.equal(one.leases.length, 1); assert.deepEqual(one.skipped, ['2 (Hunt Permit - Drive-in)']);
  // two pages, overlapping by one property
  const p1 = blk(1, 'Louisiana', 'Beauregard', 'Hunt Lease') + blk(3, 'Washington', 'Whatcom', 'Hunt Lease');
  const p2 = blk(3, 'Washington', 'Whatcom', 'Hunt Lease') + blk(4, 'New York', 'Cattaraugus', 'Hunt Lease');
  const m = check(P.parsePages(t => M.parseAfm(s, t), [p1, p2]));
  assert.equal(m.ok, true, m.problem); assert.deepEqual(m.leases.map(l => l.id).sort(), ['afm:1', 'afm:3', 'afm:4']);
  // a page that fails its own count fails the whole read
  const p2bad = blk(3, 'Washington', 'Whatcom', 'Hunt Lease') + blk(4, 'New York', 'Cattaraugus', 'Hunt Lease').replace('100.5 Acres / $1,000.00', 'garbled');
  const bad = check(P.parsePages(t => M.parseAfm(s, t), [p1, p2bad]));
  assert.equal(bad.ok, false);
  // stamp matching: acres AND one more detail of that lease
  const mr = { id: 'martinranch:rocksprings-1-351-acre-hunting-lease', acres: 1351, place: 'the Rocksprings area, Texas', state: 'TX' };
  assert.equal(P.cardIsLease('Rocksprings 1,351 Acre Hunting Lease', mr), true);
  assert.equal(P.cardIsLease('Carta Valley 1,351 Acre Hunting Lease', mr), false);   // same acres, other place
  assert.equal(P.cardIsLease('Rocksprings 3,000 Acre Easy Access', mr), false);      // same place, other acres
  assert.equal(P.cardIsLease('Rocksprings 11,351 Acre Ranch', mr), false);           // 1,351 inside a bigger number
  assert.equal(P.cardIsLease('Metal Heavy Duty, No Hunting Sign - 5pack', { id: 'ushunts:x', acres: 560, county: 'Hughes' }), false);
  const r = check(P.soldFilter({ leases: [mr, { id: 'martinranch:other', acres: 2000, place: 'the Carta Valley area, Texas', state: 'TX' }], expected: 2, skipped: [] },
    [{ card: 'Rocksprings 1,351 Acre Hunting Lease', word: 'SOLD' }]));
  assert.equal(r.ok, true, r.problem); assert.deepEqual(r.leases.map(l => l.id), ['martinranch:other']);
  assert.deepEqual(r.skipped, ['martinranch:rocksprings-1-351-acre-hunting-lease (picture marked SOLD)']);
  // no stamps: nothing changes
  assert.equal(P.soldFilter({ leases: [mr], expected: 1 }, []).leases.length, 1);
  assert.ok(P.STAMP.test('SOLD!') && P.STAMP.test('LEASED BY') && !P.STAMP.test('Hunting Lease') && !P.STAMP.test('soldier creek')); }
console.log('page loader tests passed');
