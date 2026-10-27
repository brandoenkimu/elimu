/**
 * Pure-logic checks that need no database: grading arithmetic and grade bands.
 *   yarn test:logic
 */
import assert from 'node:assert/strict';
import { toCsv } from '../src/common/csv';
import { weightedTotal } from '../src/common/grading';
import { letterFor, round2 } from '../src/common/types';

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log(`PASS  ${name}`); };

t('rounding avoids float noise', () => assert.equal(round2(0.1 + 0.2), 0.3));
t('grade bands', () => {
  assert.equal(letterFor(70), 'A'); assert.equal(letterFor(69.99), 'B'); assert.equal(letterFor(50), 'C');
  assert.equal(letterFor(40), 'D'); assert.equal(letterFor(39.99), 'E'); assert.equal(letterFor(0), 'E');
});
t('weighted total normalises over counted weights', () => {
  const r = weightedTotal([
    { score: 15, maxScore: 20, weight: 10 },  // 7.5
    { score: 24, maxScore: 30, weight: 20 },  // 16
  ]);
  assert.equal(r.earned, 23.5); assert.equal(r.weightTotal, 30); assert.equal(r.percent, 78.33); assert.equal(r.letter, 'A');
});
t('missing work counts as zero', () => {
  const r = weightedTotal([{ score: null, maxScore: 20, weight: 10 }, { score: 20, maxScore: 20, weight: 10 }]);
  assert.equal(r.percent, 50); assert.equal(r.letter, 'C');
});
t('zero-weight items are ignored', () => assert.equal(weightedTotal([{ score: 1, maxScore: 10, weight: 0 }]).percent, null));
t('scores are clamped to the maximum', () => assert.equal(weightedTotal([{ score: 50, maxScore: 20, weight: 10 }]).percent, 100));
t('csv escapes quotes, commas and formulas', () => {
  const csv = toCsv(['a', 'b'], [['=cmd()', 'He said "hi", ok']]);
  assert.ok(csv.includes("'=cmd()")); assert.ok(csv.includes('"He said ""hi"", ok"'));
});
console.log(`\n${n} checks passed.`);
