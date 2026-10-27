import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow, types } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/app-config';

// COUNT(*) and bigint identity columns arrive as strings by default. Message
// sequence numbers stay far below 2^53, so plain numbers are safe and simpler.
types.setTypeParser(types.builtins.INT8, (value: string) => Number(value));
// numeric(…) columns (marks, weights) arrive as strings by default; they are small decimals, so numbers are safe.
types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number(value));

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly log = new Logger('Database');
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.pool = new Pool({
      connectionString: cfg.DATABASE_URL,
      max: cfg.DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
      statement_timeout: 5_000,
      application_name: `campusconnect-${cfg.NODE_ID}`,
    });
    // An idle client can error when PostgreSQL restarts. Without this handler
    // the process would crash on the unhandled 'error' event.
    this.pool.on('error', (err) => this.log.error(`Idle client error: ${err.message}`));
  }

  /** Always pass user input through $1, $2 ... parameters, never string concatenation. */
  query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
