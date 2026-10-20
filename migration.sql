PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS guests (
 id TEXT PRIMARY KEY, credential_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 xp INTEGER NOT NULL DEFAULT 0, crates INTEGER NOT NULL DEFAULT 0,
 coins INTEGER NOT NULL DEFAULT 150,
 outfit TEXT NOT NULL DEFAULT 'survivor', owned TEXT NOT NULL DEFAULT '["survivor"]',
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rewards (
 match_id TEXT NOT NULL, guest_id TEXT NOT NULL, xp INTEGER NOT NULL,
 extracted INTEGER NOT NULL, kills INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(match_id, guest_id), FOREIGN KEY(guest_id) REFERENCES guests(id)
);
CREATE TABLE IF NOT EXISTS purchases (
 id TEXT PRIMARY KEY, guest_id TEXT NOT NULL, cosmetic_id TEXT NOT NULL,
 cost INTEGER NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(guest_id, cosmetic_id)
);
