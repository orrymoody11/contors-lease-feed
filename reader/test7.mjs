// Offline test of the seven readers against saved copies of the real pages (reader/fixtures).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as S from './sources.mjs';
const F = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const links = (n) => F(n).split('\n').filter(Boolean).map(l => ({ href: l.split('|')[0].trim(), text: (l.split('|')[1] || '').trim() }));
const src = (id, name, url) => ({ id, name, url });
const by = (r, pred) => r.leases.find(pred);

let r = S.check(S.parseForecon(src('forecon', 'FORECON', 'u'), F('forecon.txt'), links('forecon.links.txt')));
assert.equal(r.ok, true, r.problem); assert.equal(r.leases.length, 7);
let x = by(r, l => l.name === 'South Standing Rock Tract');
assert.deepEqual([x.acres, x.county, x.state, x.url], [2746.9, 'Clay', 'WV', 'https://www.foreconinc.com/huntleases/standing-rock-tract']);
x = by(r, l => l.name === 'Oxford Tract'); assert.deepEqual([x.acres, x.county, x.state, x.posted], [307, 'Chenango', 'NY', '2026-07-20']);
assert.equal(by(r, l => l.name === 'Red Mill Brook Tract').county, 'Mckean'.replace('Mckean', 'McKean'));

r = S.check(S.parseBullCreek(src('bullcreek', 'Bull Creek', 'u'), F('bullcreek.txt')));
assert.equal(r.ok, true, r.problem); assert.equal(r.leases.length, 5); assert.equal(r.skipped.length, 1);
x = by(r, l => l.acres === 459.5); assert.deepEqual([x.state, x.county, x.price, x.lat, x.lng], ['TX', 'Cass', 13800, 33.20934, -94.05907]);
x = by(r, l => l.acres === 200); assert.deepEqual([x.state, x.county, x.price], ['LA', 'Caddo', 6000]); assert.match(x.note, /2 tracts of 40 and 160 acres/);
assert.deepEqual([by(r, l => l.acres === 80).state, by(r, l => l.acres === 80).county], ['AR', 'Hempstead']);
assert.equal(by(r, l => l.acres === 240).county, 'Bienville');
assert.equal(by(r, l => l.acres === 88.5).county, 'Caddo');
assert.ok(r.leases.every(l => /^[A-Z][a-z]+$/.test(l.county)), r.leases.map(l => l.county).join());

r = S.check(S.parseAfoa(src('afoa', 'AFOA', 'u'), F('afoa.txt')));
assert.equal(r.ok, true, r.problem); assert.equal(r.leases.length, 2);
x = by(r, l => l.state === 'AL'); assert.deepEqual([x.county, x.acres, x.price, x.posted], ['Russell', 600, 6000, '2026-10-28']); assert.match(x.note, /Turkey season only/); assert.equal(x.per, 'season');
x = by(r, l => l.state === 'MS'); assert.deepEqual([x.county, x.acres, x.price, x.per, x.lat], ['Tishomingo', 80, 493, 'season', 34.744493]); assert.match(x.note, /Growing Assets/);

r = S.check(S.parseLarson(src('larson', 'Larson & McGowin', 'u'), F('larson.txt'), links('larson.links.txt')));
assert.equal(r.ok, true, r.problem); x = r.leases[0];
assert.deepEqual([x.acres, x.county, x.state, x.price, x.term], [51, 'Greene', 'NC', 431.46, 'July 1, 2026 thru June 30, 2027']);
assert.match(x.url, /51-acres-in-greene-county/);

r = S.check(S.parseNebraska(src('nebraska', 'Nebraska BELF', 'u'), F('nebraska.txt'), links('nebraska.links.txt'), new Date('2026-11-25T20:00:00Z')));
assert.equal(r.ok, true, r.problem); assert.equal(r.leases.length, 1); assert.equal(r.skipped.length, 4);
x = r.leases[0]; assert.deepEqual([x.county, x.state, x.auction.date, x.url], ['Loup', 'NE', '2026-12-02', 'https://belf.nebraska.gov/recleases/reclease-loup24.html']);
assert.deepEqual(S.parseNebraskaDetail('Legal 36-24N-19W\n2027 Rent - $26,048.68\nHunting and other recreational potential'), { price: 26048.68, priceText: '2027 rent listed: $26,048.68 (final rent set at auction)', acres: null });

r = S.check(S.parseGrowingAssets(src('growingassets', 'Growing Assets', 'u'), F('growingassets.txt'), links('growingassets.links.txt')));
assert.equal(r.ok, true, r.problem); assert.equal(r.leases.length, 2);
x = by(r, l => l.name === 'Tract HPT07'); assert.deepEqual([x.acres, x.county, x.state, x.price, x.term], [80, 'Tishomingo', 'MS', 560, '3 years']); assert.match(x.url, /HPT07-hunting-lease2026\.pdf$/);

// Without the site's state filter, two Woodward County listings name no state: the source must fail, not guess.
r = S.check(S.parseUsHunts(src('ushunts', 'US Hunts', 'u'), F('ushunts.txt'), JSON.parse(F('ushunts.json')).products));
assert.equal(r.ok, false); assert.match(r.problem, /2 missing acres\/state/);
const OK = Object.fromEntries(['275-acres-with-plenty-of-opportunity-in-woodward-county-arnies', 'all-you-could-want-on-320-acres-in-woodward-county-n-huffman'].map(h => [h, 'Oklahoma']));
r = S.check(S.parseUsHunts(src('ushunts', 'US Hunts', 'u'), F('ushunts.txt'), JSON.parse(F('ushunts.json')).products, OK));
assert.equal(by(r, l => /Huffman/.test(l.name)).state, 'OK');
assert.equal(r.ok, true, r.problem); assert.equal(r.leases.length, 7); assert.equal(r.skipped.length, 2);
x = by(r, l => /JMCN/.test(l.name)); assert.deepEqual([x.acres, x.county, x.state, x.price], [160, 'Washita', 'OK', 2563.67]);
x = by(r, l => /Apache/.test(l.name)); assert.deepEqual([x.acres, x.county, x.state], [40, 'Apache', 'AZ']);
x = by(r, l => /Neosho/.test(l.name)); assert.deepEqual([x.county, x.state, x.note], ['Neosho', 'KS', null]);
assert.ok(!r.leases.some(l => /Sold Out/.test(l.name)));

// A broken page must fail, not pass with fewer leases.
r = S.check(S.parseGrowingAssets(src('ga', 'GA', 'u'), F('growingassets.txt').replace('Acres:\n80\nLocation:\nTishomingo Co., MS\nCost:\n$5.00', 'Size:\n80\nWhere:\nTishomingo\nCost:\n$5.00'), []));
assert.equal(r.ok, false);
r = S.check(S.parseForecon(src('f', 'F', 'u'), F('forecon.txt').replace('787 ACRES', '787 AC'), links('forecon.links.txt')));
assert.equal(r.ok, false);
console.log('all reader tests passed');
