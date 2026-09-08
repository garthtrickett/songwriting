import { Pool } from 'pg';
import { PostgresStore } from '@mastra/pg';
export function database(connectionString: string) {
  const pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
  const storage = new PostgresStore({ id: 'songwriting-agent', pool, schemaName: 'songwriting_mastra', disableInit: true });
  return { pool, storage };
}
export async function migrate(connectionString: string) {
  const { pool } = database(connectionString);
  const storage = new PostgresStore({ id: 'songwriting-migration', pool, schemaName: 'songwriting_mastra' });
  try {
    await storage.init();
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS songwriting_agent;
      CREATE TABLE IF NOT EXISTS songwriting_agent.tasks (
        id uuid PRIMARY KEY, owner_id text NOT NULL, workspace_id text NOT NULL,
        request_id uuid NOT NULL, record jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id, request_id)
      );
      CREATE INDEX IF NOT EXISTS tasks_owner_workspace ON songwriting_agent.tasks(owner_id,workspace_id);
      CREATE TABLE IF NOT EXISTS songwriting_agent.usage (
        owner_id text NOT NULL, day date NOT NULL, reserved_usd numeric NOT NULL DEFAULT 0,
        calls integer NOT NULL DEFAULT 0, PRIMARY KEY(owner_id,day)
      );
      CREATE TABLE IF NOT EXISTS songwriting_agent.charges (
        id uuid PRIMARY KEY, task_id uuid NOT NULL, owner_id text NOT NULL,
        day date NOT NULL DEFAULT CURRENT_DATE, reserved_usd numeric NOT NULL,
        actual_usd numeric
      );
      REVOKE ALL ON SCHEMA songwriting_agent FROM PUBLIC;
      REVOKE ALL ON SCHEMA songwriting_mastra FROM PUBLIC;
    `);
  } finally { await pool.end(); }
}
