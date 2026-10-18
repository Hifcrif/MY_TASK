"use strict";
// Database connection (Postgres) and table setup.
// On Vercel, connect a Neon database (Storage tab) and it sets DATABASE_URL / POSTGRES_URL for you.
const { Pool } = require("pg");

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let pool = null;

function getPool() {
  if (!url) {
    const err = new Error("No database is connected (DATABASE_URL is not set).");
    err.code = "NO_DB";
    throw err;
  }
  if (!pool) {
    // Hosted databases (Neon, Supabase...) need SSL. A database on this computer does not.
    const isLocal = /(localhost|127\.0\.0\.1|\[::1\])/.test(url) || /[?&]host=\//.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: process.env.PGSSLMODE !== "disable" && !isLocal ? { rejectUnauthorized: false } : false,
      max: process.env.VERCEL ? 3 : 5,   // keep connections few: free databases allow only a handful
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    });
    pool.on("error", err => console.error("Database pool error:", err.message));
  }
  return pool;
}

const query = (text, params) => getPool().query(text, params);

async function init() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id             BIGSERIAL PRIMARY KEY,
      username       TEXT NOT NULL,
      username_lower TEXT NOT NULL UNIQUE,
      password_hash  TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
    CREATE TABLE IF NOT EXISTS tasks (
      id         UUID PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      due        TEXT NOT NULL DEFAULT '',
      prio       TEXT NOT NULL DEFAULT 'medium',
      done       BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks (user_id);
    CREATE TABLE IF NOT EXISTS schedules (
      id         UUID PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      day        SMALLINT NOT NULL,
      start_time TEXT NOT NULL,
      end_time   TEXT NOT NULL,
      cat        TEXT NOT NULL DEFAULT 'main',
      notes      TEXT NOT NULL DEFAULT '',
      task_id    UUID REFERENCES tasks(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS schedules_user_idx ON schedules (user_id);
    CREATE TABLE IF NOT EXISTS rate_limits (
      k        TEXT PRIMARY KEY,
      hits     INTEGER NOT NULL,
      reset_at TIMESTAMPTZ NOT NULL
    );
  `);
}

// Create the tables once per server instance (safe to run again: IF NOT EXISTS).
let readyPromise = null;
const ready = () => readyPromise || (readyPromise = init().catch(err => { readyPromise = null; throw err; }));

module.exports = { query, ready, end: () => (pool ? pool.end() : Promise.resolve()) };
