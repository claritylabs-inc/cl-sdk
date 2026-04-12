import type { EmbedText } from "../../core/types";
import type { DocumentStore } from "../interfaces";
import type { MemoryStore } from "../interfaces";
import { CREATE_TABLES } from "./migrations";
import { createSqliteDocumentStore } from "./document-store";
import { createSqliteMemoryStore } from "./memory-store";

export interface SqliteStoreOptions {
  path: string;
  embed: EmbedText;
}

export function createSqliteStore(options: SqliteStoreOptions): {
  documents: DocumentStore;
  memory: MemoryStore;
  close: () => void;
} {
  // Dynamic import to keep better-sqlite3 optional
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require("better-sqlite3");
  const db = new BetterSqlite3(options.path);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);

  return {
    documents: createSqliteDocumentStore(db),
    memory: createSqliteMemoryStore(db, options.embed),
    close: () => db.close(),
  };
}

export type { DocumentStore, MemoryStore } from "../interfaces";
