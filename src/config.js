import 'dotenv/config';

export function readConfig(env = process.env) {
  const required = ['DATABASE_URL'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  return {
    port: Number(env.PORT || 3000),
    databaseUrl: env.DATABASE_URL,
    corsOrigin: env.CORS_ORIGIN || 'http://localhost:3000',
  };
}
