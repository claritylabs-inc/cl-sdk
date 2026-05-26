import type { InsuranceDocument } from "../schemas/document";

// ── Helpers ──

type RawRecord = Record<string, unknown>;
type RawFieldPromotion = { from: string; to: string };

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function findRawString(raw: RawRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(raw[key]);
    if (value) return value;
  }
  return undefined;
}

function promoteRawFields(raw: RawRecord, mappings: RawFieldPromotion[]): void {
  for (const { from, to } of mappings) {
    if (!raw[to] && raw[from]) {
      raw[to] = raw[from];
    }
    delete raw[from];
  }
}

// ── 1. Carrier field name mapping (issue 7) ──

/**
 * The carrier_info extractor returns short names (naicNumber, admittedStatus, amBestRating)
 * but PolicyDocument expects prefixed names (carrierNaicNumber, carrierAdmittedStatus, etc.).
 * Promote the short names to canonical top-level names.
 */
function promoteCarrierFields(doc: InsuranceDocument): void {
  const raw = doc as RawRecord;

  promoteRawFields(raw, [
    { from: "naicNumber", to: "carrierNaicNumber" },
    { from: "amBestRating", to: "carrierAmBestRating" },
    { from: "admittedStatus", to: "carrierAdmittedStatus" },
  ]);

  // Also build the structured insurer sub-object if we have legal name
  if (!raw.insurer && raw.carrierLegalName) {
    raw.insurer = {
      legalName: raw.carrierLegalName,
      ...(raw.carrierNaicNumber ? { naicNumber: raw.carrierNaicNumber } : {}),
      ...(raw.carrierAmBestRating ? { amBestRating: raw.carrierAmBestRating } : {}),
      ...(raw.carrierAdmittedStatus ? { admittedStatus: raw.carrierAdmittedStatus } : {}),
    };
  }
}

// ── 2. Broker / producer structural mapping (issue 1) ──

function promoteBroker(doc: InsuranceDocument): void {
  const raw = doc as RawRecord;
  const brokerAgency = findRawString(raw, ["brokerAgency"]);
  const brokerContact = findRawString(raw, ["brokerContactName"]);
  const brokerLicense = findRawString(raw, ["brokerLicenseNumber"]);
  const brokerPhone = findRawString(raw, ["brokerPhone"]);
  const brokerEmail = findRawString(raw, ["brokerEmail"]);
  const brokerAddress = findRawString(raw, ["brokerAddress"]);

  if (!raw.producer && brokerAgency) {
    raw.producer = {
      agencyName: brokerAgency,
      ...(brokerContact ? { contactName: brokerContact } : {}),
      ...(brokerLicense ? { licenseNumber: brokerLicense } : {}),
      ...(brokerPhone ? { phone: brokerPhone } : {}),
      ...(brokerEmail ? { email: brokerEmail } : {}),
      ...(brokerAddress ? { address: { street1: brokerAddress } } : {}),
    };
  }
}

// ── Public API ──

/**
 * Run structural compatibility passes on an assembled document, mutating it in place.
 * These passes only move model-extracted top-level fields into canonical shapes.
 */
export function promoteExtractedFields(doc: InsuranceDocument): void {
  promoteCarrierFields(doc);
  promoteBroker(doc);
}

// Export individual functions for testing
export {
  promoteCarrierFields,
  promoteBroker,
};
