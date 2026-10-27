import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane).
export const ARGON_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (password: string): Promise<string> => argon2.hash(password, ARGON_OPTIONS);

export const verifyPassword = (hash: string, password: string): Promise<boolean> =>
  argon2.verify(hash, password).catch(() => false);

const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';

/** A random temporary password with no look-alike characters (no 0/O, 1/l/I). */
export function generateTempPassword(): string {
  const chars: string[] = [];
  for (let i = 0; i < 10; i++) chars.push(LETTERS[randomInt(LETTERS.length)]);
  for (let i = 0; i < 3; i++) chars.push(DIGITS[randomInt(DIGITS.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
