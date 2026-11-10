import pg from 'pg';

export function createPool(connectionString) {
  return new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' },
    max: 5,
  });
}
