// Offline test of the feed combiner and its guards.
import assert from 'node:assert/strict';
import { combine } from './combine.mjs';
const T0 = new Date('2026-11-25T12:00:00Z'), T1 = new Date('2026-11-26T00:00:00Z'), T5 = new Date('2026-11-30T00:00:00Z');
const orbisReport = (ok = true, n = 5) => ({ fatal: null, sources: [{ id: 'premier', name: 'Premier Hunting Leases', ok, count: n }, { id: 'kingwood', name: 'Kingwood Forestry', ok: true, count: 2 }, { id: 'bird', name: 'Bird Forestry', ok: true, count: 1 }] });
const prem = (n) => Array.from({ length: n }, (_, i) => ({ source: 'Premier Hunting Leases', unit: 'P' + i, acres: String(40 + i), place: 'Perquimans County, NC', term: '7/1/2026 to 6/30/2027', price: '$500.00' }));
const orbisFeed = (n = 5) => ({ leases: [...prem(n),
  { source: 'Kingwood Forestry', unit: 'MC-AR-3043-01', acres: '71', place: 'Ashley County, AR', term: '6/15/2026 to 6/14/2027', price: '$475.70' },
  { source: 'Kingwood Forestry', unit: 'MC-AR-3081-01', acres: '3', place: 'Ashley County, AR', term: '6/15/2026 to 6/14/2027', price: '$40.00' },
  { source: 'Kingwood Forestry', unit: 'K-ACC', acres: '20', place: 'Ashley County, AR', term: '6/15/2026 to 6/14/2027', price: '$200.00', ownAccess: true },
  { source: 'Bird Forestry', unit: '167', acres: '80', place: 'Bienville County, LA', term: '8/1/2026 to 7/31/2027', price: '$919.60' }] });
const feed7 = { leases: [
  { id: 'afoa:9-2-2026-tishomingo-80', sourceId: 'afoa', source: "Alabama Forest Owners' Association", url: 'https://afoa.org/hunt/', state: 'MS', county: 'Tishomingo', acres: 80, price: 493, priceText: '$493 /season including insurance', per: 'season', posted: '2026-09-02', note: 'Posted by Growing Assets.' },
  { id: 'growingassets:UNT05', sourceId: 'growingassets', source: 'Growing Assets', url: 'https://x/UNT05.pdf', name: 'Tract UNT05', state: 'MS', county: 'Tishomingo', acres: 80, price: 400, priceText: '$5.00/acre+insurance', per: 'year (per-acre rate)', term: '3 years' },
  { id: 'nebraska:loup', sourceId: 'nebraska', source: 'Nebraska Board of Educational Lands and Funds', url: 'u', state: 'NE', county: 'Loup', acres: null, price: 26048.68, priceText: '2027 rent listed', per: 'year', auction: { date: '2026-12-02' } },
  { id: 'larson:x', sourceId: 'larson', source: 'Larson & McGowin', url: 'u', state: 'NC', county: 'Greene', acres: 51, price: 431.46, per: 'year', term: 'July 1, 2026 thru June 30, 2027' },
  { id: 'bullcreek:88', sourceId: 'bullcreek', source: 'Bull Creek Leasing', url: 'u', state: 'LA', county: 'Caddo', acres: 88.5, price: 2700, per: 'year', lat: 32.9, lng: -94 }] };
const report7 = { fatal: null, sources: [{ id: 'larson', ok: true, count: 1 }, { id: 'afoa', ok: true, count: 1 }, { id: 'growingassets', ok: true, count: 1 }, { id: 'nebraska', ok: true, count: 1 }, { id: 'bullcreek', ok: true, count: 1 }] };

// first run
let { feed, report } = combine({ orbisFeed: orbisFeed(), orbisReport: orbisReport(), feed7, report7, prev: null, now: T0 });
assert.equal(report.ok, true, report.issues.join());
const id = (x) => feed.leases.find(l => l.id === x);
assert.ok(!id('kingwood:MC-AR-3081-01'), 'under 10 acres left out'); assert.ok(report.leftOutSmall[0].startsWith('kingwood:MC-AR-3081-01'));
assert.ok(!id('afoa:9-2-2026-tishomingo-80'), 'aggregator copy dropped'); assert.ok(id('growingassets:UNT05'));
assert.ok(id('nebraska:loup'), 'auction kept without acres'); assert.equal(id('nebraska:loup').per, 'auction');
assert.equal(id('bird:167').county, 'Bienville Parish'); assert.equal(id('bird:167').term, 'August 1, 2026 to July 31, 2027');
assert.equal(id('bullcreek:88').county, 'Caddo Parish'); assert.equal(id('premier:P0').county, 'Perquimans County');
assert.equal(id('growingassets:UNT05').pricePerAcre, 5); assert.equal(id('kingwood:MC-AR-3043-01').pricePerAcre, 6.7);
assert.match(id('kingwood:K-ACC').note, /^The lister says you must arrange your own access\./); assert.doesNotMatch(id('kingwood:MC-AR-3043-01').note, /access/);
assert.equal(feed.count, 5 + 2 + 1 + 1 + 1 + 1 + 1); assert.deepEqual(feed.states, ['AR', 'LA', 'MS', 'NC', 'NE']);
assert.equal(id('larson:x').term, 'July 1, 2026 to June 30, 2027');
assert.ok(feed.leases.every(l => l.firstSeen === T0.toISOString() && l.lastSeen === T0.toISOString()));
const first = feed;

// second run: Premier fails -> its 5 listings are kept with their old date; others refresh, firstSeen kept
({ feed, report } = combine({ orbisFeed: { leases: orbisFeed().leases.filter(l => !/Premier/.test(l.source)) }, orbisReport: orbisReport(false, 0), feed7, report7, prev: first, now: T1 }));
assert.equal(report.ok, false); assert.match(report.issues.join(), /premier/);
assert.equal(feed.leases.filter(l => l.sourceId === 'premier').length, 5);
assert.equal(feed.leases.find(l => l.sourceId === 'premier').lastSeen, T0.toISOString());
assert.equal(feed.leases.find(l => l.sourceId === 'bird').firstSeen, T0.toISOString()); assert.equal(feed.leases.find(l => l.sourceId === 'bird').lastSeen, T1.toISOString());
assert.equal(feed.sources.find(s => s.id === 'premier').lastGood, T0.toISOString());

// a sudden drop (5 -> 1) is treated as a failure, so the old 5 stay
({ feed, report } = combine({ orbisFeed: orbisFeed(1), orbisReport: orbisReport(true, 1), feed7, report7, prev: first, now: T1 }));
assert.equal(feed.leases.filter(l => l.sourceId === 'premier').length, 5); assert.match(report.issues.join(), /premier: count fell from 5 to 1/);

// a source that keeps failing drops off after 3 days
({ feed, report } = combine({ orbisFeed: { leases: [] }, orbisReport: orbisReport(false, 0), feed7, report7, prev: first, now: T5 }));
assert.equal(feed.leases.filter(l => l.sourceId === 'premier').length, 0);

// a reader that vanished from the run entirely is a failure, not "zero leases"
({ feed, report } = combine({ orbisFeed: orbisFeed(), orbisReport: orbisReport(), feed7: { leases: [] }, report7: { sources: [] }, prev: first, now: T1 }));
assert.match(report.issues.join(), /bullcreek: not in this run/); assert.ok(feed.leases.find(l => l.sourceId === 'bullcreek'));
console.log('all combine tests passed');
