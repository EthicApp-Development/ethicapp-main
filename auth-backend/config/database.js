const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || process.env.POSTGRES_DB,

  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT || 2000),

  ssl: isProduction
    ? {
        rejectUnauthorized: false
      }
    : false
});

// Logging de errores del pool (MUY importante en producción)
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

// Función helper opcional
async function query(text, params) {
  const start = Date.now();

  try {
    const res = await pool.query(text, params);

    if (process.env.DEBUG_SQL === 'true') {
      const duration = Date.now() - start;
      console.log('SQL:', { text, duration, rows: res.rowCount });
    }

    return res;
  } catch (err) {
    console.error('SQL ERROR:', {
      text,
      params,
      message: err.message
    });
    throw err;
  }
}

module.exports = {
  pool,
  query
};