import { randomUUID as secureRandomUUID } from 'node:crypto';

import { assertDefaultable, normalizeLibrary, normalizeWord } from './domain.js';

function iso(now) {
  return new Date(now).toISOString();
}

function timestamp(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    defaultLibraryId: row.default_library_id || null,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function mapWord(row) {
  return {
    id: row.id,
    text: row.text,
    hint: row.hint,
    language: row.language,
    rate: Number(row.rate),
  };
}

function mapLibrary(row, words = []) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    countdownSeconds: row.countdown_seconds == null ? null : Number(row.countdown_seconds),
    words,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

async function inTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function requireLibraryRow(client, userId, libraryId, { lock = false } = {}) {
  const result = await client.query(
    `SELECT * FROM nod_libraries WHERE id = $1 AND user_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [libraryId, userId],
  );
  if (!result.rowCount) throw new Error('library_not_found');
  return result.rows[0];
}

async function loadWords(client, libraryId) {
  const result = await client.query(
    'SELECT * FROM nod_words WHERE library_id = $1 ORDER BY position ASC',
    [libraryId],
  );
  return result.rows.map(mapWord);
}

async function loadLibrary(client, row) {
  return mapLibrary(row, await loadWords(client, row.id));
}

function mapPairing(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    codeHash: row.code_hash,
    status: row.status,
    expiresAt: Number(row.expires_at),
    createdAt: timestamp(row.created_at),
    consumedAt: timestamp(row.consumed_at),
  };
}

export function createStore({ pool, now = Date.now, randomUUID = secureRandomUUID } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new Error('database_pool_required');

  return {
    async health() {
      await pool.query('SELECT 1');
      return true;
    },

    async upsertUser(input) {
      const accountId = String(input?.accountId || '').trim();
      if (!accountId) throw new Error('account_required');
      const accountName = String(input?.accountName || '').trim().slice(0, 80);
      const currentTime = iso(now());
      return inTransaction(pool, async (client) => {
        const existing = await client.query(
          'SELECT * FROM nod_users WHERE account_id = $1 FOR UPDATE',
          [accountId],
        );
        if (!existing.rowCount) {
          const inserted = await client.query(
            `INSERT INTO nod_users
              (id, account_id, account_name, default_library_id, created_at, updated_at)
             VALUES ($1, $2, $3, NULL, $4, $4)
             RETURNING *`,
            [randomUUID(), accountId, accountName, currentTime],
          );
          return mapUser(inserted.rows[0]);
        }
        if (!accountName) return mapUser(existing.rows[0]);
        const updated = await client.query(
          'UPDATE nod_users SET account_name = $1, updated_at = $2 WHERE id = $3 RETURNING *',
          [accountName, currentTime, existing.rows[0].id],
        );
        return mapUser(updated.rows[0]);
      });
    },

    async getUserById(userId) {
      const result = await pool.query('SELECT * FROM nod_users WHERE id = $1', [userId]);
      return mapUser(result.rows[0]);
    },

    async getUserByAccount(accountId) {
      const result = await pool.query('SELECT * FROM nod_users WHERE account_id = $1', [accountId]);
      return mapUser(result.rows[0]);
    },

    async createPairing({ userId, codeHash, expiresAt }) {
      return inTransaction(pool, async (client) => {
        const currentTime = now();
        await client.query(
          "UPDATE nod_pairings SET status = 'expired' WHERE status = 'active' AND expires_at <= $1",
          [currentTime],
        );
        await client.query(
          "UPDATE nod_pairings SET status = 'cancelled' WHERE user_id = $1 AND status = 'active'",
          [userId],
        );
        const collision = await client.query(
          "SELECT 1 FROM nod_pairings WHERE code_hash = $1 AND status = 'active'",
          [String(codeHash)],
        );
        if (collision.rowCount) throw new Error('pairing_collision');
        const inserted = await client.query(
          `INSERT INTO nod_pairings
            (id, user_id, code_hash, status, expires_at, created_at, consumed_at)
           VALUES ($1, $2, $3, 'active', $4, $5, NULL)
           RETURNING *`,
          [randomUUID(), userId, String(codeHash), Number(expiresAt), iso(currentTime)],
        );
        return mapPairing(inserted.rows[0]);
      });
    },

    async readPairing({ id, userId }) {
      return inTransaction(pool, async (client) => {
        await client.query(
          "UPDATE nod_pairings SET status = 'expired' WHERE id = $1 AND user_id = $2 AND status = 'active' AND expires_at <= $3",
          [id, userId, now()],
        );
        const result = await client.query(
          'SELECT * FROM nod_pairings WHERE id = $1 AND user_id = $2',
          [id, userId],
        );
        return mapPairing(result.rows[0]);
      });
    },

    async consumePairing({ codeHash }) {
      return inTransaction(pool, async (client) => {
        const result = await client.query(
          "SELECT * FROM nod_pairings WHERE code_hash = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1 FOR UPDATE",
          [String(codeHash)],
        );
        if (!result.rowCount) return null;
        const row = result.rows[0];
        const currentTime = now();
        if (Number(row.expires_at) <= currentTime) {
          await client.query("UPDATE nod_pairings SET status = 'expired' WHERE id = $1", [row.id]);
          return null;
        }
        const consumedAt = iso(currentTime);
        const updated = await client.query(
          "UPDATE nod_pairings SET status = 'consumed', consumed_at = $1 WHERE id = $2 RETURNING *",
          [consumedAt, row.id],
        );
        return mapPairing(updated.rows[0]);
      });
    },

    async listLibraries(userId) {
      const result = await pool.query(
        'SELECT * FROM nod_libraries WHERE user_id = $1 ORDER BY created_at ASC',
        [userId],
      );
      const libraries = [];
      for (const row of result.rows) libraries.push(await loadLibrary(pool, row));
      return libraries;
    },

    async createLibrary(userId, input) {
      const normalized = normalizeLibrary(input);
      const currentTime = iso(now());
      const result = await pool.query(
        `INSERT INTO nod_libraries
          (id, user_id, name, countdown_seconds, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING *`,
        [randomUUID(), userId, normalized.name, normalized.countdownSeconds, currentTime],
      );
      return mapLibrary(result.rows[0], []);
    },

    async updateLibrary(userId, libraryId, input) {
      return inTransaction(pool, async (client) => {
        const current = await requireLibraryRow(client, userId, libraryId, { lock: true });
        const normalized = normalizeLibrary({
          name: input?.name ?? current.name,
          countdownSeconds: Object.hasOwn(input || {}, 'countdownSeconds')
            ? input.countdownSeconds
            : current.countdown_seconds,
        });
        const updated = await client.query(
          `UPDATE nod_libraries
           SET name = $1, countdown_seconds = $2, updated_at = $3
           WHERE id = $4 AND user_id = $5
           RETURNING *`,
          [normalized.name, normalized.countdownSeconds, iso(now()), libraryId, userId],
        );
        return loadLibrary(client, updated.rows[0]);
      });
    },

    async deleteLibrary(userId, libraryId) {
      return inTransaction(pool, async (client) => {
        const current = await requireLibraryRow(client, userId, libraryId, { lock: true });
        const removed = await loadLibrary(client, current);
        await client.query(
          'UPDATE nod_users SET default_library_id = NULL, updated_at = $1 WHERE id = $2 AND default_library_id = $3',
          [iso(now()), userId, libraryId],
        );
        await client.query('DELETE FROM nod_libraries WHERE id = $1 AND user_id = $2', [libraryId, userId]);
        return removed;
      });
    },

    async addWord(userId, libraryId, input) {
      const normalized = normalizeWord(input);
      return inTransaction(pool, async (client) => {
        await requireLibraryRow(client, userId, libraryId, { lock: true });
        const positionResult = await client.query(
          'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM nod_words WHERE library_id = $1',
          [libraryId],
        );
        const inserted = await client.query(
          `INSERT INTO nod_words
            (id, library_id, position, text, hint, language, rate)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            randomUUID(),
            libraryId,
            Number(positionResult.rows[0].next_position),
            normalized.text,
            normalized.hint,
            normalized.language,
            normalized.rate,
          ],
        );
        await client.query('UPDATE nod_libraries SET updated_at = $1 WHERE id = $2', [iso(now()), libraryId]);
        return mapWord(inserted.rows[0]);
      });
    },

    async deleteWord(userId, libraryId, wordId) {
      return inTransaction(pool, async (client) => {
        await requireLibraryRow(client, userId, libraryId, { lock: true });
        const deleted = await client.query(
          'DELETE FROM nod_words WHERE id = $1 AND library_id = $2 RETURNING *',
          [wordId, libraryId],
        );
        if (!deleted.rowCount) throw new Error('word_not_found');
        await client.query('UPDATE nod_libraries SET updated_at = $1 WHERE id = $2', [iso(now()), libraryId]);
        return mapWord(deleted.rows[0]);
      });
    },

    async setDefaultLibrary(userId, libraryId) {
      return inTransaction(pool, async (client) => {
        const row = await requireLibraryRow(client, userId, libraryId, { lock: true });
        const library = assertDefaultable(await loadLibrary(client, row));
        const updated = await client.query(
          'UPDATE nod_users SET default_library_id = $1, updated_at = $2 WHERE id = $3 RETURNING id',
          [libraryId, iso(now()), userId],
        );
        if (!updated.rowCount) throw new Error('user_not_found');
        return library;
      });
    },

    async getDefaultLibraryByAccount(accountId) {
      const result = await pool.query(
        `SELECT library.*
         FROM nod_users AS app_user
         JOIN nod_libraries AS library ON library.id = app_user.default_library_id
         WHERE app_user.account_id = $1 AND library.user_id = app_user.id`,
        [accountId],
      );
      return result.rowCount ? loadLibrary(pool, result.rows[0]) : null;
    },
  };
}
