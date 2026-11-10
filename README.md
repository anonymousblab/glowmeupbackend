# GlowMeUp Backend

Node.js + Express API for GlowMeUp. Authentication, sessions, consent, and profile data are handled by this API. Supabase is used only as PostgreSQL.

## Railway deployment

Set these Railway variables:

```text
DATABASE_URL=your_supabase_postgresql_connection_string
PG_SSL_REJECT_UNAUTHORIZED=true
CORS_ORIGIN=https://your-flutter-web-domain
PORT=3000
```

Deploy command:

```text
npm start
```

After the first deploy, apply the database schema locally with `npm run db:migrate`, or run the contents of `supabase/schema.sql` in the Supabase SQL Editor.
