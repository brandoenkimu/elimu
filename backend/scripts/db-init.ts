import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Applies every file in db/migrations in order, once each.
 * Applied files are remembered in the schema_migrations table, so running this
 * again only applies what is new. Safe on a database created by an older version.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  const dir = join(__dirname, '..', 'db', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      process.stdout.write(`Applying ${file} ... `);
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log('done');
        applied++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.log('FAILED');
        throw err;
      }
    }
    console.log(applied === 0 ? 'Database is already up to date.' : `Applied ${applied} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err: Error) => {
  console.error(`Could not apply migrations: ${err.message}`);
  process.exit(1);
});
