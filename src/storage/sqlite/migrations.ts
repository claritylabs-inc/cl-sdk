export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  embedding BLOB,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_result TEXT,
  timestamp INTEGER NOT NULL,
  embedding BLOB
);

CREATE TABLE IF NOT EXISTS source_spans (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  source_kind TEXT,
  chunk_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  hash TEXT NOT NULL,
  text_hash TEXT,
  page_start INTEGER,
  page_end INTEGER,
  section_id TEXT,
  form_number TEXT,
  location TEXT,
  bbox TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  embedding BLOB
);

CREATE TABLE IF NOT EXISTS source_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  source_span_ids TEXT NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(type);
CREATE INDEX IF NOT EXISTS idx_turns_conversation_id ON conversation_turns(conversation_id);
CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON conversation_turns(timestamp);
CREATE INDEX IF NOT EXISTS idx_source_spans_document_id ON source_spans(document_id);
CREATE INDEX IF NOT EXISTS idx_source_spans_chunk_id ON source_spans(chunk_id);
CREATE INDEX IF NOT EXISTS idx_source_chunks_document_id ON source_chunks(document_id);
`;
