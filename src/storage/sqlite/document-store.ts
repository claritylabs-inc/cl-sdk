import type Database from "better-sqlite3";
import type { DocumentStore } from "../interfaces";
import type { InsuranceDocument } from "../../schemas/document";
import type { DocumentFilters } from "../chunk-types";

export function createSqliteDocumentStore(db: Database.Database): DocumentStore {
  return {
    async save(doc: InsuranceDocument): Promise<void> {
      db.prepare("INSERT OR REPLACE INTO documents (id, type, data) VALUES (?, ?, ?)").run(
        doc.id, doc.type, JSON.stringify(doc),
      );
    },

    async get(id: string): Promise<InsuranceDocument | null> {
      const row = db.prepare("SELECT data FROM documents WHERE id = ?").get(id) as { data: string } | undefined;
      return row ? JSON.parse(row.data) : null;
    },

    async query(filters: DocumentFilters): Promise<InsuranceDocument[]> {
      let sql = "SELECT data FROM documents WHERE 1=1";
      const params: unknown[] = [];

      if (filters.type) {
        sql += " AND type = ?";
        params.push(filters.type);
      }
      if (filters.carrier) {
        sql += " AND json_extract(data, '$.carrier') LIKE ?";
        params.push(`%${filters.carrier}%`);
      }
      if (filters.insuredName) {
        sql += " AND json_extract(data, '$.insuredName') LIKE ?";
        params.push(`%${filters.insuredName}%`);
      }
      if (filters.policyNumber) {
        sql += " AND json_extract(data, '$.policyNumber') = ?";
        params.push(filters.policyNumber);
      }
      if (filters.quoteNumber) {
        sql += " AND json_extract(data, '$.quoteNumber') = ?";
        params.push(filters.quoteNumber);
      }

      const rows = db.prepare(sql).all(...params) as { data: string }[];
      return rows.map((r) => JSON.parse(r.data));
    },

    async delete(id: string): Promise<void> {
      db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    },
  };
}
