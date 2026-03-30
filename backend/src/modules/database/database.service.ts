import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  default_store_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_store_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS stores (
  id text PRIMARY KEY,
  owner_user_id uuid,
  name text DEFAULT 'Amboras Store',
  timezone text NOT NULL DEFAULT 'UTC',
  currency text NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stores ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS name text DEFAULT 'Amboras Store';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_owner_user_id
  ON stores (owner_user_id)
  WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_default_store_id
  ON users (default_store_id);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id text PRIMARY KEY,
  store_id text NOT NULL,
  event_type text NOT NULL,
  event_timestamp timestamptz NOT NULL,
  product_id text,
  amount_cents integer,
  currency text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_store_timestamp
  ON analytics_events (store_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_store_type_timestamp
  ON analytics_events (store_id, event_type, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_store_product_timestamp
  ON analytics_events (store_id, product_id, event_timestamp DESC)
  WHERE product_id IS NOT NULL;
`;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(private readonly configService: ConfigService) {
    this.pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
    });
  }

  async onModuleInit() {
    await this.pool.query(BOOTSTRAP_SQL);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query<T extends QueryResultRow>(text: string, params?: unknown[]) {
    return this.pool.query<T>(text, params);
  }

  async withClient<T>(callback: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();

    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
}
