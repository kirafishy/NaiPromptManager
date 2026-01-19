
DROP TABLE IF EXISTS versions;
DROP TABLE IF EXISTS chains;
DROP TABLE IF EXISTS artists;
DROP TABLE IF EXISTS inspirations;

CREATE TABLE chains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT, -- JSON array string
  preview_image TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  base_prompt TEXT,
  negative_prompt TEXT,
  modules TEXT, -- JSON string
  params TEXT, -- JSON string
  created_at INTEGER,
  FOREIGN KEY(chain_id) REFERENCES chains(id) ON DELETE CASCADE
);

CREATE TABLE artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT
);

CREATE TABLE inspirations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  image_url TEXT,
  prompt TEXT,
  created_at INTEGER
);

CREATE INDEX idx_versions_chain_id ON versions(chain_id);
