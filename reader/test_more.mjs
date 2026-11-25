// Offline tests for more.mjs against placeholder copies of the page layouts (reader/fixtures).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as M from './more.mjs';
import { check } from './sources.mjs';
const F = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const src = (id, name, url) => ({ id, name, url });
const by = (r, id) => r.leases.find(l => l.id === id);

let r = check(M.parseAfm(src('afm', 'American Forest Management', 'u'), F('afm.txt')));
assert.equal(r.ok, true, r.problem); assert.equal(r.leases.length, 2); assert.deepEqual(r.skipped, ['100003 (Camp Lease)']);
assert.deepEqual(['state', 'county', 'acres', 'price'].map(k => by(r, 'afm:100001')[k]), ['PA', 'Cameron', 289.59, 3115.98]);
assert.deepEqual(['state', 'county', 'acres', 'price'].map(k => by(r, 'afm:100002')[k]), ['LA', 'Beauregard', 169.13, 1139.94]);
r = check(M.parseAfm(src('afm', 'AFM', 'u'), 'Available Properties\nLoading'));
assert.equal(r.ok, false);
console.log('all new-reader tests passed');
