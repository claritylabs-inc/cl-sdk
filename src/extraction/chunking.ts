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

  function stringMetadata(entries: Record<string, string | number | undefined | null>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(entries)
        .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
        .map(([key, value]) => [key, String(value)]),
    );
  }

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
    metadata: stringMetadata({ carrier: doc.carrier, documentType: doc.type }),
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
    metadata: stringMetadata({ insuredName: doc.insuredName, documentType: doc.type }),
  });

  // Coverage chunks — one per coverage
  doc.coverages.forEach((cov, i) => {
    chunks.push({
      id: `${docId}:coverage:${i}`,
      documentId: docId,
      type: "coverage",
      text: [
        `Coverage: ${cov.name}`,
        `Limit: ${cov.limit}`,
        cov.limitValueType ? `Limit Type: ${cov.limitValueType}` : null,
        cov.deductible ? `Deductible: ${cov.deductible}` : null,
        cov.deductibleValueType ? `Deductible Type: ${cov.deductibleValueType}` : null,
        cov.originalContent ? `Source: ${cov.originalContent}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({
        coverageName: cov.name,
        limit: cov.limit,
        limitValueType: cov.limitValueType,
        deductible: cov.deductible,
        deductibleValueType: cov.deductibleValueType,
        formNumber: cov.formNumber,
        pageNumber: cov.pageNumber,
        sectionRef: cov.sectionRef,
        documentType: doc.type,
      }),
    });
  });

  // Endorsement chunks
  doc.endorsements?.forEach((end, i) => {
    chunks.push({
      id: `${docId}:endorsement:${i}`,
      documentId: docId,
      type: "endorsement",
      text: `Endorsement: ${end.title}\n${end.content}`.trim(),
      metadata: stringMetadata({
        endorsementType: end.endorsementType,
        formNumber: end.formNumber,
        pageStart: end.pageStart,
        pageEnd: end.pageEnd,
        documentType: doc.type,
      }),
    });
  });

  // Exclusion chunks
  doc.exclusions?.forEach((exc, i) => {
    chunks.push({
      id: `${docId}:exclusion:${i}`,
      documentId: docId,
      type: "exclusion",
      text: `Exclusion: ${exc.name}\n${exc.content}`.trim(),
      metadata: stringMetadata({ formNumber: exc.formNumber, pageNumber: exc.pageNumber, documentType: doc.type }),
    });
  });

  // Section chunks
  doc.sections?.forEach((sec, i) => {
    chunks.push({
      id: `${docId}:section:${i}`,
      documentId: docId,
      type: "section",
      text: `Section: ${sec.title}\n${sec.content}`,
      metadata: stringMetadata({ sectionType: sec.type, pageStart: sec.pageStart, pageEnd: sec.pageEnd, documentType: doc.type }),
    });
  });

  // Premium chunk
  if (doc.premium) {
    chunks.push({
      id: `${docId}:premium:0`,
      documentId: docId,
      type: "premium",
      text: `Premium: ${doc.premium}${doc.totalCost ? `\nTotal Cost: ${doc.totalCost}` : ""}`,
      metadata: stringMetadata({ premium: doc.premium, documentType: doc.type }),
    });
  }

  return chunks;
}
