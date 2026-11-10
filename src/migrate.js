import { readFile } from 'node:fs/promises';
import { readConfig } from './config.js';
import { createPool } from './database.js';

const pool = createPool(readConfig().databaseUrl);
try {
  const sql = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Database schema applied.');
} finally {
  await pool.end();
}
