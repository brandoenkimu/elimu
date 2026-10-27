/** Client-side checks that mirror the server's rules, so people see problems as they type. The server re-checks everything. */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface PasswordCheck {
  label: string;
  ok: boolean;
}

const COMMON = new Set(['password123', 'password1234', '1234567890', '12345678910', 'qwerty12345', 'qwertyuiop1', 'letmein1234', 'welcome1234', 'iloveyou123', 'admin12345', 'changeme123', 'abc1234567']);

export function passwordChecks(pw: string): PasswordCheck[] {
  return [
    { label: 'At least 10 characters', ok: pw.length >= 10 },
    { label: 'A letter and a number', ok: /[A-Za-z]/.test(pw) && /\d/.test(pw) },
    { label: 'Not a common password', ok: pw.length > 0 && !COMMON.has(pw.toLowerCase()) && new Set(pw).size > 3 },
  ];
}

export const passwordValid = (pw: string): boolean => passwordChecks(pw).every((c) => c.ok);

/** 0 (empty) to 4. Length and variety, not a promise of safety. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: '' };
  let points = 0;
  if (pw.length >= 10) points++;
  if (pw.length >= 14) points++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) points++;
  if (!passwordValid(pw)) points = Math.min(points, 1);
  const score = Math.max(1, Math.min(4, points)) as 1 | 2 | 3 | 4;
  return { score, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][score] };
}

export const NAME_RE = /^[\p{L}\p{N} .'\-]+$/u;
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9/\-_.]{2,30}$/;
