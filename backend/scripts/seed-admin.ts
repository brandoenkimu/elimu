import 'dotenv/config';
import { Client } from 'pg';
import { generateTempPassword, hashPassword } from '../src/common/password';

/**
 * Creates the first administrator.
 *
 *   yarn seed:admin you@university.ac.ke "Your Name"
 *
 * A temporary password is generated and printed once; you must change it at first sign-in.
 * Running it again for an email that already exists promotes that account to administrator
 * and prints a fresh temporary password.
 */
async function main(): Promise<void> {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ').trim() || 'Administrator';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Usage: yarn seed:admin <email> "<Full Name>"');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }
  const temp = generateTempPassword();
  const hash = await hashPassword(temp);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (email, display_name, password_hash, role, status, must_change_password)
       VALUES ($1, $2, $3, 'admin', 'active', true)
       ON CONFLICT (email) DO UPDATE
         SET role = 'admin', status = 'active', password_hash = EXCLUDED.password_hash, must_change_password = true`,
      [email.toLowerCase(), name, hash],
    );
    await client.query(
      `DELETE FROM refresh_tokens WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email.toLowerCase()],
    );
  } finally {
    await client.end();
  }
  console.log(`\nAdministrator ready.\n  Email:              ${email.toLowerCase()}\n  Temporary password: ${temp}\n\nSign in and you will be asked to choose a new password.\n`);
}

main().catch((err: Error) => {
  console.error(`Could not create the administrator: ${err.message}`);
  process.exit(1);
});
