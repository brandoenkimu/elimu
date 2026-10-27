export type Role = 'student' | 'lecturer' | 'admin';
export type AccountStatus = 'active' | 'pending' | 'suspended';

/** The signed-in user as every guarded request sees them (loaded fresh from the database each time). */
export interface AuthUser {
  id: string;
  role: Role;
  status: AccountStatus;
  displayName: string;
  mustChangePassword: boolean;
}

/** Letter grades. Adjust the bands here to match your institution's grading policy. */
export const GRADE_BANDS: { min: number; letter: string; label: string }[] = [
  { min: 70, letter: 'A', label: 'Distinction' },
  { min: 60, letter: 'B', label: 'Credit' },
  { min: 50, letter: 'C', label: 'Pass' },
  { min: 40, letter: 'D', label: 'Marginal pass' },
  { min: 0, letter: 'E', label: 'Fail' },
];

export const letterFor = (percent: number): string =>
  (GRADE_BANDS.find((b) => percent >= b.min) ?? GRADE_BANDS[GRADE_BANDS.length - 1]).letter;

/** Round to two decimals without floating-point surprises such as 0.1 + 0.2. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
