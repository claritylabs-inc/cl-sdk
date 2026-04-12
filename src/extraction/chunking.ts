// src/extraction/chunking.ts
import type { InsuranceDocument } from "../schemas/document";
import type { DocumentChunk } from "../storage/chunk-types";

/**
 * Break a validated document into retrieval-friendly chunks.
 * Each chunk has a deterministic ID, type tag, text for embedding, and metadata for filtering.
 */
export function chunkDocument(doc: InsuranceDocument): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const docId = doc.id;

  // Carrier info chunk
  chunks.push({
    id: `${docId}:carrier_info:0`,
    documentId: docId,
    type: "carrier_info",
    text: [
      `Carrier: ${doc.carrier}`,
      doc.carrierLegalName ? `Legal Name: ${doc.carrierLegalName}` : null,
      doc.carrierNaicNumber ? `NAIC: ${doc.carrierNaicNumber}` : null,
      doc.carrierAmBestRating ? `AM Best: ${doc.carrierAmBestRating}` : null,
      doc.mga ? `MGA: ${doc.mga}` : null,
    ].filter(Boolean).join("\n"),
    metadata: { carrier: doc.carrier, documentType: doc.type },
  });

  // Named insured chunk
  chunks.push({
    id: `${docId}:named_insured:0`,
    documentId: docId,
    type: "named_insured",
    text: [
      `Insured: ${doc.insuredName}`,
      doc.insuredDba ? `DBA: ${doc.insuredDba}` : null,
      doc.insuredFein ? `FEIN: ${doc.insuredFein}` : null,
      doc.insuredAddress ? `Address: ${doc.insuredAddress.street1}, ${doc.insuredAddress.city}, ${doc.insuredAddress.state} ${doc.insuredAddress.zip}` : null,
    ].filter(Boolean).join("\n"),
    metadata: { insuredName: doc.insuredName, documentType: doc.type },
  });

  // Coverage chunks — one per coverage
  doc.coverages.forEach((cov, i) => {
    chunks.push({
      id: `${docId}:coverage:${i}`,
      documentId: docId,
      type: "coverage",
      text: `Coverage: ${cov.name}\nLimit: ${cov.limit}${cov.deductible ? `\nDeductible: ${cov.deductible}` : ""}`,
      metadata: { coverageName: cov.name, limit: cov.limit, documentType: doc.type },
    });
  });

  // Endorsement chunks
  doc.endorsements?.forEach((end, i) => {
    chunks.push({
      id: `${docId}:endorsement:${i}`,
      documentId: docId,
      type: "endorsement",
      text: `Endorsement: ${end.title}\n${end.content}`.trim(),
      metadata: { endorsementType: end.endorsementType, formNumber: end.formNumber, documentType: doc.type },
    });
  });

  // Exclusion chunks
  doc.exclusions?.forEach((exc, i) => {
    chunks.push({
      id: `${docId}:exclusion:${i}`,
      documentId: docId,
      type: "exclusion",
      text: `Exclusion: ${exc.name}\n${exc.content}`.trim(),
      metadata: { documentType: doc.type },
    });
  });

  // Section chunks
  doc.sections?.forEach((sec, i) => {
    chunks.push({
      id: `${docId}:section:${i}`,
      documentId: docId,
      type: "section",
      text: `Section: ${sec.title}\n${sec.content}`,
      metadata: { sectionType: sec.type, documentType: doc.type },
    });
  });

  // Premium chunk
  if (doc.premium) {
    chunks.push({
      id: `${docId}:premium:0`,
      documentId: docId,
      type: "premium",
      text: `Premium: ${doc.premium}${doc.totalCost ? `\nTotal Cost: ${doc.totalCost}` : ""}`,
      metadata: { premium: doc.premium, documentType: doc.type },
    });
  }

  return chunks;
}
