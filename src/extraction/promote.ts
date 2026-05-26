import type { InsuranceDocument } from "../schemas/document";

// ── Helpers ──

type DeclField = { field: string; value: string; section?: string };
type RawRecord = Record<string, unknown>;
type RawFieldPromotion = { from: string; to: string };
type DeclarationLookup = {
  rawKey?: string;
  patterns: string[];
  reject?: (field: DeclField) => boolean;
};

function getDeclarationFields(doc: InsuranceDocument): DeclField[] {
  const decl = doc.declarations as { fields?: DeclField[] } | undefined;
  return Array.isArray(decl?.fields) ? decl.fields : [];
}

/** Case-insensitive match against any of the given patterns. */
function fieldMatches(fieldName: string, patterns: string[]): boolean {
  const lower = normalizeFieldName(fieldName);
  return patterns.some((p) => lower === normalizeFieldName(p));
}

function normalizeFieldName(fieldName: string): string {
  return fieldName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findFieldValue(
  fields: DeclField[],
  patterns: string[],
  reject?: (field: DeclField) => boolean,
): string | undefined {
  const match = fields.find((f) => fieldMatches(f.field, patterns) && !reject?.(f));
  return match?.value;
}

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

function findRawOrDeclarationValue(
  raw: RawRecord,
  fields: DeclField[],
  lookup: DeclarationLookup,
): string | undefined {
  return (lookup.rawKey ? raw[lookup.rawKey] as string : undefined)
    || findFieldValue(fields, lookup.patterns, lookup.reject);
}

function promoteRawOrDeclarationString(
  raw: RawRecord,
  fields: DeclField[],
  targetKey: string,
  rawKeys: string[],
  lookup: DeclarationLookup,
): void {
  if (raw[targetKey]) return;

  const value = findRawString(raw, rawKeys)
    ?? findFieldValue(fields, lookup.patterns, lookup.reject);
  if (value) raw[targetKey] = value;
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

// ── 2. Broker / producer promotion (issue 1) ──

const BROKER_NAME_PATTERNS = [
  "brokerName", "broker", "agentName", "agent", "producerName",
  "producerAgency", "agencyName", "brokerAgency",
];
const BROKER_CONTACT_PATTERNS = [
  "brokerContactName", "brokerContact", "agentContactName",
  "producerContactName", "producerContact",
];
const BROKER_LICENSE_PATTERNS = [
  "brokerLicenseNumber", "brokerNumber", "agentLicenseNumber",
  "producerLicenseNumber", "producerNumber", "agentNumber",
];
const BROKER_PHONE_PATTERNS = ["brokerPhone", "agentPhone", "producerPhone"];
const BROKER_EMAIL_PATTERNS = ["brokerEmail", "agentEmail", "producerEmail"];
const BROKER_ADDRESS_PATTERNS = ["brokerAddress", "agentAddress", "producerAddress"];

function promoteBroker(doc: InsuranceDocument): void {
  const raw = doc as RawRecord;
  const fields = getDeclarationFields(doc);

  // Carrier extractor may have set these directly
  const brokerAgency = findRawOrDeclarationValue(raw, fields, {
    rawKey: "brokerAgency",
    patterns: BROKER_NAME_PATTERNS,
  });
  const brokerContact = findRawOrDeclarationValue(raw, fields, {
    rawKey: "brokerContactName",
    patterns: BROKER_CONTACT_PATTERNS,
  });
  const brokerLicense = findRawOrDeclarationValue(raw, fields, {
    rawKey: "brokerLicenseNumber",
    patterns: BROKER_LICENSE_PATTERNS,
  });
  const brokerPhone = findRawOrDeclarationValue(raw, fields, { patterns: BROKER_PHONE_PATTERNS });
  const brokerEmail = findRawOrDeclarationValue(raw, fields, { patterns: BROKER_EMAIL_PATTERNS });
  const brokerAddress = findRawOrDeclarationValue(raw, fields, { patterns: BROKER_ADDRESS_PATTERNS });

  if (brokerAgency) raw.brokerAgency = brokerAgency;
  if (brokerContact) raw.brokerContactName = brokerContact;
  if (brokerLicense) raw.brokerLicenseNumber = brokerLicense;

  // Build structured producer object if we have data and it's not already set
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

// ── 3. Loss payees and mortgage holders (issue 2) ──

const LOSS_PAYEE_NAME_PATTERNS = [
  "lossPayeeName", "lossPayee", "lossPayeeHolder",
];
const LOSS_PAYEE_ADDRESS_PATTERNS = ["lossPayeeAddress"];
const MORTGAGE_HOLDER_NAME_PATTERNS = [
  "mortgagee", "mortgageHolder", "mortgageHolderName",
  "mortgageeName", "lienholder", "lienholderName",
];
const MORTGAGE_HOLDER_ADDRESS_PATTERNS = [
  "mortgageeAddress", "mortgageHolderAddress", "lienholderAddress",
];

function promoteLossPayees(doc: InsuranceDocument): void {
  const raw = doc as Record<string, unknown>;
  const fields = getDeclarationFields(doc);

  // Loss payees
  if (!raw.lossPayees || (Array.isArray(raw.lossPayees) && raw.lossPayees.length === 0)) {
    const name = findFieldValue(fields, LOSS_PAYEE_NAME_PATTERNS);
    if (name) {
      const address = findFieldValue(fields, LOSS_PAYEE_ADDRESS_PATTERNS);
      raw.lossPayees = [{
        name,
        role: "loss_payee" as const,
        ...(address ? { address: { street1: address } } : {}),
      }];
    }
  }

  // Mortgage holders
  if (!raw.mortgageHolders || (Array.isArray(raw.mortgageHolders) && raw.mortgageHolders.length === 0)) {
    const name = findFieldValue(fields, MORTGAGE_HOLDER_NAME_PATTERNS);
    if (name) {
      const address = findFieldValue(fields, MORTGAGE_HOLDER_ADDRESS_PATTERNS);
      raw.mortgageHolders = [{
        name,
        role: "mortgage_holder" as const,
        ...(address ? { address: { street1: address } } : {}),
      }];
    }
  }
}

// ── 4. Locations from declarations (issue 3) ──

/**
 * Group declaration fields by location/building number and promote to locations[].
 * Handles patterns like locationNumber, buildingNumber, construction, occupancy, etc.
 */
function promoteLocations(doc: InsuranceDocument): void {
  const raw = doc as Record<string, unknown>;

  // Don't overwrite existing locations
  if (Array.isArray(raw.locations) && raw.locations.length > 0) return;

  const fields = getDeclarationFields(doc);
  if (fields.length === 0) return;

  // Strategy: group fields by section, then look for location-like groups
  const locationGroups = new Map<string, Map<string, string>>();

  for (const f of fields) {
    const lower = f.field.toLowerCase().replace(/[\s_-]/g, "");

    // Detect location number field to create a group key
    if (lower.includes("locationnumber") || lower.includes("locnumber") || lower.includes("locno")) {
      const key = f.value;
      if (!locationGroups.has(key)) locationGroups.set(key, new Map());
      locationGroups.get(key)!.set("number", f.value);
      continue;
    }

    // For other location-related fields, try to associate with most recent location
    // or use section as grouping
    if (lower.includes("buildingnumber") || lower.includes("bldgnumber") || lower.includes("bldgno")) {
      const lastKey = [...locationGroups.keys()].pop();
      if (lastKey) locationGroups.get(lastKey)!.set("buildingNumber", f.value);
      continue;
    }

    // Heuristic: if the field is in a "Location" section, associate with the last location
    const section = (f.section ?? "").toLowerCase();
    const isLocationField = section.includes("location") || section.includes("building")
      || section.includes("premises") || section.includes("schedule of locations");

    if (!isLocationField) continue;

    // If no location group exists yet, create one with a default key
    if (locationGroups.size === 0) {
      locationGroups.set("1", new Map([["number", "1"]]));
    }

    const lastKey = [...locationGroups.keys()].pop()!;
    const group = locationGroups.get(lastKey)!;

    if (lower.includes("construction") || lower.includes("constructiontype")) {
      group.set("constructionType", f.value);
    } else if (lower.includes("occupancy") || lower.includes("occupancytype")) {
      group.set("occupancy", f.value);
    } else if (lower.includes("yearbuilt")) {
      group.set("yearBuilt", f.value);
    } else if (lower.includes("squarefootage") || lower.includes("sqft") || lower.includes("area")) {
      group.set("squareFootage", f.value);
    } else if (lower.includes("protectionclass") || lower.includes("fireprotection")) {
      group.set("protectionClass", f.value);
    } else if (lower.includes("sprinkler")) {
      group.set("sprinklered", f.value);
    } else if (lower.includes("buildingvalue") || lower.includes("buildingamt") || lower.includes("buildingcoverage")) {
      group.set("buildingValue", f.value);
    } else if (lower.includes("contentsvalue") || lower.includes("contentsamt") || lower.includes("contentscoverage")) {
      group.set("contentsValue", f.value);
    } else if (lower.includes("businessincome") || lower.includes("bivalue") || lower.includes("businessincomevalue")) {
      group.set("businessIncomeValue", f.value);
    } else if (lower.includes("description") || lower.includes("buildingdescription") || lower.includes("locationdescription")) {
      group.set("description", f.value);
    } else if (lower.includes("address") || lower.includes("industryaddress") || lower.includes("locationaddress") || lower.includes("premisesaddress")) {
      group.set("address", f.value);
    } else if (lower.includes("alarm") || lower.includes("alarmtype")) {
      group.set("alarmType", f.value);
    }
  }

  if (locationGroups.size === 0) return;

  const locations: Record<string, unknown>[] = [];
  for (const [, group] of locationGroups) {
    const num = parseInt(group.get("number") ?? "0", 10) || (locations.length + 1);
    const addressStr = group.get("address");

    locations.push({
      number: num,
      address: addressStr ? { street1: addressStr } : { street1: "See declarations" },
      ...(group.get("description") ? { description: group.get("description") } : {}),
      ...(group.get("constructionType") ? { constructionType: group.get("constructionType") } : {}),
      ...(group.get("occupancy") ? { occupancy: group.get("occupancy") } : {}),
      ...(group.get("yearBuilt") ? { yearBuilt: parseInt(group.get("yearBuilt")!, 10) || undefined } : {}),
      ...(group.get("squareFootage") ? { squareFootage: parseInt(group.get("squareFootage")!.replace(/[^0-9]/g, ""), 10) || undefined } : {}),
      ...(group.get("protectionClass") ? { protectionClass: group.get("protectionClass") } : {}),
      ...(group.get("sprinklered") ? { sprinklered: /yes|true/i.test(group.get("sprinklered")!) } : {}),
      ...(group.get("buildingValue") ? { buildingValue: group.get("buildingValue") } : {}),
      ...(group.get("contentsValue") ? { contentsValue: group.get("contentsValue") } : {}),
      ...(group.get("businessIncomeValue") ? { businessIncomeValue: group.get("businessIncomeValue") } : {}),
      ...(group.get("alarmType") ? { alarmType: group.get("alarmType") } : {}),
    });
  }

  if (locations.length > 0) {
    raw.locations = locations;
  }
}

// ── Public API ──

/**
 * Run all promotion passes on an assembled document, mutating it in place.
 * This fills in non-financial top-level fields from extracted declaration data.
 */
export function promoteExtractedFields(doc: InsuranceDocument): void {
  promoteCarrierFields(doc);
  promoteBroker(doc);
  promoteLossPayees(doc);
  promoteLocations(doc);
}

// Export individual functions for testing
export {
  promoteCarrierFields,
  promoteBroker,
  promoteLossPayees,
  promoteLocations,
};
