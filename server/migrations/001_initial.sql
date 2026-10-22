CREATE TABLE IF NOT EXISTS nod_users (
  id text PRIMARY KEY,
  account_id text NOT NULL UNIQUE,
  account_name text NOT NULL DEFAULT '',
  default_library_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS nod_pairings (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES nod_users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'consumed', 'expired', 'cancelled')),
  expires_at bigint NOT NULL,
  created_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS nod_libraries (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES nod_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  countdown_seconds integer,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS nod_words (
  id text PRIMARY KEY,
  library_id text NOT NULL REFERENCES nod_libraries(id) ON DELETE CASCADE,
  position integer NOT NULL,
  text text NOT NULL,
  hint text NOT NULL DEFAULT '',
  language text NOT NULL DEFAULT 'auto',
  rate double precision NOT NULL DEFAULT 0.72
);

CREATE INDEX IF NOT EXISTS nod_pairings_active_code_idx ON nod_pairings(code_hash, status);
CREATE INDEX IF NOT EXISTS nod_libraries_user_idx ON nod_libraries(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS nod_words_position_idx ON nod_words(library_id, position);
