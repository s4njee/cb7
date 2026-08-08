/**
 * @module
 * The Postgres Database Schema — server data model
 *
 * Architecture overview for Junior Devs:
 * This is the schema for the standalone server — originally translated from the
 * retired SQLite-era `SCHEMA` (whose column/type conventions it preserves so the
 * REST API's wire shapes stayed identical). It is applied with
 * `CREATE ... IF NOT EXISTS` on every startup, so running it against an existing
 * database is harmless.
 *
 * Translation choices worth knowing:
 *  - `INTEGER PRIMARY KEY AUTOINCREMENT` → `INTEGER GENERATED ALWAYS AS IDENTITY`.
 *  - `BLOB` → `BYTEA` (cover thumbnails live in the DB as bytes).
 *  - App-owned timestamps stay `TEXT` in the SQLite `YYYY-MM-DD HH:MM:SS` shape so
 *    the REST API emits identical strings; the default mirrors `datetime('now')`.
 *  - better-auth-owned tables (`users` dates, `session`, `account`,
 *    `verification`) use `timestamptz`, which is what better-auth's Postgres
 *    adapter reads/writes. `is_admin` / `email_verified` are real `BOOLEAN`s.
 *  - SQLite's FTS5 `comics_fts` virtual table + triggers become a single STORED
 *    generated `tsvector` column (`search_vector`) with a GIN index. Full-text
 *    queries use `search_vector @@ websearch_to_tsquery('english', $1)`.
 *  - `COLLATE NOCASE` (case-insensitive unique/sort) has no Postgres equivalent,
 *    so it becomes `lower(col)` expression indexes; the DAO layer matches/sorts
 *    with `lower(...)` to suit.
 */

/** Mirror of SQLite's `datetime('now')` — `YYYY-MM-DD HH:MM:SS` in UTC. */
const NOW_TEXT = `to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')`;

export const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS comics (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  file_size BIGINT NOT NULL,
  cover_thumbnail BYTEA,
  date_added TEXT NOT NULL DEFAULT ${NOW_TEXT},
  last_page INTEGER,
  last_location TEXT,
  last_percent INTEGER,
  last_read TEXT,
  media_type TEXT NOT NULL DEFAULT 'comic',
  series_name TEXT,
  volume_number DOUBLE PRECISION,
  chapter_number DOUBLE PRECISION,
  completed INTEGER NOT NULL DEFAULT 0,
  author TEXT,
  artist TEXT,
  genre TEXT,
  year INTEGER,
  summary TEXT,
  external_id TEXT,
  external_source TEXT,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(file_path, '') || ' ' ||
      coalesce(series_name, '') || ' ' || coalesce(author, '') || ' ' || coalesce(summary, ''))
  ) STORED
);
-- Backfill last_percent on comics tables created before it existed. Reflowable
-- formats (EPUB) persist whole-book progress here for shared/guest reading.
-- Postgres supports IF NOT EXISTS, so this is safe to re-run on every startup.
ALTER TABLE comics ADD COLUMN IF NOT EXISTS last_percent INTEGER;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT UNIQUE,
  display_username TEXT,
  password_hash TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  email TEXT UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  name TEXT,
  image TEXT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- better-auth tables.
CREATE TABLE IF NOT EXISTS session (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  password TEXT,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope TEXT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);
CREATE INDEX IF NOT EXISTS idx_session_token ON session(token);
CREATE INDEX IF NOT EXISTS idx_account_user ON account(user_id);
CREATE INDEX IF NOT EXISTS idx_account_provider ON account(provider_id, account_id);

CREATE TABLE IF NOT EXISTS user_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comic_id INTEGER NOT NULL REFERENCES comics(id) ON DELETE CASCADE,
  last_page INTEGER,
  last_location TEXT,
  -- Whole-book reading position as an integer percentage (0-100). Used for
  -- reflowable formats (EPUB) where there is no fixed page index to derive
  -- progress from; NULL for comics/PDFs, which track progress via last_page.
  last_percent INTEGER,
  last_read TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, comic_id)
);
-- Backfill the column on databases created before last_percent existed. Postgres
-- supports IF NOT EXISTS here, so this is safe to re-run on every startup.
ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS last_percent INTEGER;

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comic_id INTEGER NOT NULL REFERENCES comics(id) ON DELETE CASCADE,
  -- A bookmark is anchored by exactly one of page or location. Comics/PDFs use
  -- page (a fixed page index); reflowable formats (EPUB) have no page index and
  -- use location instead, so page is nullable.
  page INTEGER,
  -- EPUB CFI identifying the anchored spot in a reflowable book. NULL for
  -- comics/PDFs, which anchor via page. Same TEXT-CFI shape as
  -- user_progress.last_location.
  location TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW_TEXT}
);
-- Backfill for databases created before location existed, and relax the old
-- page NOT NULL so CFI-anchored bookmarks can be stored. Both forms are
-- idempotent in Postgres, so this is safe to re-run on every startup
-- (DROP NOT NULL on an already-nullable column is a no-op).
ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE bookmarks ALTER COLUMN page DROP NOT NULL;

CREATE TABLE IF NOT EXISTS reading_history (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comic_id INTEGER NOT NULL REFERENCES comics(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  page INTEGER,
  timestamp TEXT NOT NULL DEFAULT ${NOW_TEXT}
);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comic_id INTEGER NOT NULL REFERENCES comics(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW_TEXT},
  PRIMARY KEY (user_id, comic_id)
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_lower ON tags(lower(name));

CREATE TABLE IF NOT EXISTS comic_tags (
  comic_id INTEGER NOT NULL REFERENCES comics(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (comic_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_comics_file_path ON comics(file_path);
CREATE INDEX IF NOT EXISTS idx_comics_title ON comics(lower(title));
CREATE INDEX IF NOT EXISTS idx_comics_date_added ON comics(date_added);
CREATE INDEX IF NOT EXISTS idx_comics_file_size ON comics(file_size);
CREATE INDEX IF NOT EXISTS idx_comics_page_count ON comics(page_count);
CREATE INDEX IF NOT EXISTS idx_comics_search ON comics USING GIN (search_vector);
-- Shared recently-read / continue-reading shelves: ORDER BY last_read DESC on
-- rows that have been read at all. Partial keeps it tiny on large libraries.
CREATE INDEX IF NOT EXISTS idx_comics_last_read ON comics(last_read DESC) WHERE last_read IS NOT NULL;
-- Series rollups: getAllSeries groups/correlates on the raw column,
-- getSeriesComics + the hierarchy filters match on lower(series_name).
CREATE INDEX IF NOT EXISTS idx_comics_series_name ON comics(series_name);
CREATE INDEX IF NOT EXISTS idx_comics_series_lower ON comics(lower(series_name));
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_comic ON bookmarks(user_id, comic_id);
CREATE INDEX IF NOT EXISTS idx_history_user ON reading_history(user_id);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON reading_history(timestamp);
-- Per-user recently-read / continue-reading: WHERE user_id ORDER BY last_read
-- DESC LIMIT n straight off the index instead of sorting the user's rows.
CREATE INDEX IF NOT EXISTS idx_user_progress_user_lastread ON user_progress(user_id, last_read DESC);
-- Reverse lookup for the tag filter (tag -> comics). The PK only covers
-- comic-first access.
CREATE INDEX IF NOT EXISTS idx_comic_tags_tag ON comic_tags(tag_id);

CREATE TABLE IF NOT EXISTS libraries (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL DEFAULT 'comic',
  date_created TEXT NOT NULL DEFAULT ${NOW_TEXT}
);

CREATE TABLE IF NOT EXISTS library_comics (
  library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  comic_id INTEGER NOT NULL REFERENCES comics(id) ON DELETE CASCADE,
  PRIMARY KEY (library_id, comic_id)
);

CREATE INDEX IF NOT EXISTS idx_library_comics_library ON library_comics(library_id);
CREATE INDEX IF NOT EXISTS idx_library_comics_comic ON library_comics(comic_id);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  cover_comic_id INTEGER REFERENCES comics(id) ON DELETE SET NULL,
  date_created TEXT NOT NULL DEFAULT ${NOW_TEXT}
);

CREATE TABLE IF NOT EXISTS folder_comics (
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  comic_id INTEGER NOT NULL REFERENCES comics(id) ON DELETE CASCADE,
  PRIMARY KEY (folder_id, comic_id)
);

CREATE INDEX IF NOT EXISTS idx_folder_comics_folder ON folder_comics(folder_id);
CREATE INDEX IF NOT EXISTS idx_folder_comics_comic ON folder_comics(comic_id);

CREATE TABLE IF NOT EXISTS library_folders (
  library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  PRIMARY KEY (library_id, folder_id)
);

CREATE INDEX IF NOT EXISTS idx_library_folders_library ON library_folders(library_id);
CREATE INDEX IF NOT EXISTS idx_library_folders_folder ON library_folders(folder_id);

CREATE TABLE IF NOT EXISTS dismissed_paths (
  file_path TEXT PRIMARY KEY NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT ${NOW_TEXT}
);

-- Ebook search index (Phase 1 of "search by what's inside it"). Needs the
-- pgvector extension, which the Postgres image provides. The 1024-d vector
-- matches the embedding model (Qwen3-4B MRL-truncated, or bge-large natively).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS ebook_chunks (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  comic_id  INTEGER NOT NULL REFERENCES comics(id) ON DELETE CASCADE,
  chapter   TEXT,
  idx       INTEGER NOT NULL,
  content   TEXT NOT NULL,
  tsv       tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding vector(1024)
);

CREATE INDEX IF NOT EXISTS idx_ebook_chunks_comic ON ebook_chunks(comic_id);
CREATE INDEX IF NOT EXISTS idx_ebook_chunks_tsv ON ebook_chunks USING gin(tsv);
CREATE INDEX IF NOT EXISTS idx_ebook_chunks_vec ON ebook_chunks USING hnsw (embedding vector_cosine_ops);

-- Background-job progress mirror. The durable queue itself lives in pg-boss's
-- own \`pgboss\` schema; this is the human-facing row the web UI polls while a
-- scan/backfill runs in the worker. \`id\` is the pg-boss job id. Survives
-- restarts so progress is observable across deploys.
CREATE TABLE IF NOT EXISTS scan_jobs (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued',
  target_path  TEXT,
  folder_id    INTEGER,
  discovered   INTEGER NOT NULL DEFAULT 0,
  processed    INTEGER NOT NULL DEFAULT 0,
  added        INTEGER NOT NULL DEFAULT 0,
  current_file TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT ${NOW_TEXT},
  updated_at   TEXT NOT NULL DEFAULT ${NOW_TEXT}
);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_path ON scan_jobs(target_path);

-- Per-file ingest failures (corrupt archive, missing file, extract timeout, …).
-- Both processes share this table: the cb8-worker writes scan failures while the
-- API writes single-file upload / on-demand cover-recover failures, and the admin
-- "ingest errors" panel reads it. Previously each pod logged to its own JSONL on
-- a local emptyDir, so the panel never saw the worker's scan failures (the common
-- case at 40k comics). \`error_class\` is the classified category (see
-- classifyIngestError); the raw message is kept for triage. Rows are read newest
-- first via the monotonic \`id\`. \`job_id\` links a failure to the pg-boss scan
-- job that produced it (a UUID string, matching scan_jobs.id); NULL for API-side
-- single-file errors, so the scan UI can list which files a job failed on.
CREATE TABLE IF NOT EXISTS ingest_errors (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id      TEXT,
  file_path   TEXT NOT NULL,
  ext         TEXT NOT NULL,
  error_class TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Backfill the column on databases created before job_id existed. Postgres
-- supports IF NOT EXISTS, so this is safe to re-run on every startup.
ALTER TABLE ingest_errors ADD COLUMN IF NOT EXISTS job_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ingest_errors_job ON ingest_errors(job_id);

-- QR device-pairing tokens (see reader/docs/CONTRACT.md "Pair tokens").
--
-- SECURITY: this table never holds the pairing token itself, only
-- \`sha256(token)\` as lowercase hex. The plaintext exists solely in the body of
-- the POST /api/auth/pair-token response that minted it; a database dump (or a
-- replica, or a backup) therefore yields nothing a phone could redeem. The
-- lookup on /api/auth/pair hashes the presented token and matches on
-- \`token_hash\`, so the "compare" is the UNIQUE index probe — there is no
-- byte-by-byte comparison of a secret in application code to leak timing.
--
-- Single-use is enforced by \`DELETE ... RETURNING user_id\` (see db/pairTokens.ts):
-- the row is the token, and Postgres will only let one concurrent DELETE return
-- it. A read-then-write check would race two scanners of the same QR.
CREATE TABLE IF NOT EXISTS pair_tokens (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- sha256 of the token, lowercase hex. UNIQUE both dedupes and gives the
  -- consume-side DELETE an index to land on.
  token_hash TEXT NOT NULL UNIQUE,
  -- The user the token signs in as. ON DELETE CASCADE means deleting an account
  -- also revokes any outstanding pairing code that would resurrect it.
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
-- Supports the opportunistic sweep of expired rows on every mint.
CREATE INDEX IF NOT EXISTS idx_pair_tokens_expires_at ON pair_tokens(expires_at);
`;
