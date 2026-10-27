import { letterFor, round2 } from './types';

export interface GradeItem {
  /** Null when the work is missing or not yet marked; counts as zero. */
  score: number | null;
  maxScore: number;
  /** Share of the final unit mark, in percentage points. Items with weight 0 are practice and ignored. */
  weight: number;
}

export interface WeightedResult {
  /** Weighted points earned, out of `weightTotal`. */
  earned: number;
  weightTotal: number;
  percent: number | null;
  letter: string | null;
}

export function weightedTotal(items: GradeItem[]): WeightedResult {
  const counted = items.filter((i) => i.weight > 0 && i.maxScore > 0);
  const weightTotal = counted.reduce((n, i) => n + i.weight, 0);
  const earned = counted.reduce((n, i) => n + (Math.min(Math.max(i.score ?? 0, 0), i.maxScore) / i.maxScore) * i.weight, 0);
  if (weightTotal === 0) return { earned: 0, weightTotal: 0, percent: null, letter: null };
  const percent = round2((earned / weightTotal) * 100);
  return { earned: round2(earned), weightTotal: round2(weightTotal), percent, letter: letterFor(percent) };
}
