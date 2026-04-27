import pg from 'pg';

const { Pool } = pg;

const useSsl = process.env.PGSSLMODE === 'require';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || process.env.POSTGRES_DB,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT || 2000),
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

pool.on('error', (error) => {
  console.error('Unexpected error on idle PostgreSQL client', error);
});

export async function query(text, params) {
  return pool.query(text, params);
}

export { pool };
