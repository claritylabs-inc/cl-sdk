import type { InsuranceDocument } from "../schemas/document";

// ── Helpers ──

type DeclField = { field: string; value: string; section?: string };

function getDeclarationFields(doc: InsuranceDocument): DeclField[] {
  const decl = doc.declarations as { fields?: DeclField[] } | undefined;
  return Array.isArray(decl?.fields) ? decl.fields : [];
}

/** Case-insensitive match against any of the given patterns. */
function fieldMatches(fieldName: string, patterns: string[]): boolean {
  const lower = fieldName.toLowerCase().replace(/[\s_-]/g, "");
  return patterns.some((p) => lower === p.toLowerCase().replace(/[\s_-]/g, ""));
}

function findFieldValue(fields: DeclField[], patterns: string[]): string | undefined {
  const match = fields.find((f) => fieldMatches(f.field, patterns));
  return match?.value;
}

// ── 1. Carrier field name mapping (issue 7) ──

/**
 * The carrier_info extractor returns short names (naicNumber, admittedStatus, amBestRating)
 * but PolicyDocument expects prefixed names (carrierNaicNumber, carrierAdmittedStatus, etc.).
 * Promote the short names to canonical top-level names.
 */
function promoteCarrierFields(doc: InsuranceDocument): void {
  const raw = doc as Record<string, unknown>;

  // naicNumber → carrierNaicNumber
  if (!raw.carrierNaicNumber && raw.naicNumber) {
    raw.carrierNaicNumber = raw.naicNumber;
  }
  // amBestRating → carrierAmBestRating
  if (!raw.carrierAmBestRating && raw.amBestRating) {
    raw.carrierAmBestRating = raw.amBestRating;
  }
  // admittedStatus → carrierAdmittedStatus
  if (!raw.carrierAdmittedStatus && raw.admittedStatus) {
    raw.carrierAdmittedStatus = raw.admittedStatus;
  }

  // Clean up the short names so they don't leak into the output
  delete raw.naicNumber;
  delete raw.amBestRating;
  delete raw.admittedStatus;

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
  const raw = doc as Record<string, unknown>;
  const fields = getDeclarationFields(doc);

  // Carrier extractor may have set these directly
  const brokerAgency = (raw.brokerAgency as string) || findFieldValue(fields, BROKER_NAME_PATTERNS);
  const brokerContact = (raw.brokerContactName as string) || findFieldValue(fields, BROKER_CONTACT_PATTERNS);
  const brokerLicense = (raw.brokerLicenseNumber as string) || findFieldValue(fields, BROKER_LICENSE_PATTERNS);
  const brokerPhone = findFieldValue(fields, BROKER_PHONE_PATTERNS);
  const brokerEmail = findFieldValue(fields, BROKER_EMAIL_PATTERNS);
  const brokerAddress = findFieldValue(fields, BROKER_ADDRESS_PATTERNS);

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

// ── 5. Synthesize limits from coverages (issue 5) ──

interface CoverageRecord {
  name?: string;
  limit?: string;
  limitType?: string;
  deductible?: string;
  formNumber?: string;
}

/** Normalize coverage name for matching. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const LIMIT_COVERAGE_MAP: Array<[string[], string]> = [
  // GL standard
  [["eachoccurrence", "peroccurrence", "occurrencecombined"], "perOccurrence"],
  [["generalaggregate"], "generalAggregate"],
  [["productscompletedoperationsaggregate", "productscompletedopsaggregate", "prodcompopsagg"], "productsCompletedOpsAggregate"],
  [["personaladvertisinginjury", "personaladvinjury", "pai"], "personalAdvertisingInjury"],
  [["firedamage", "firedamagelegalliability", "damagetorentedpremises", "damagetopremisesrentedtoyou"], "fireDamage"],
  [["medicalexpense", "medexp", "medicalexpenseanypersonanyperson", "medicalexpenseanyone"], "medicalExpense"],
  // Auto
  [["combinedsingle", "combinedsinglelimit", "csl"], "combinedSingleLimit"],
  [["bodilyinjuryperperson", "biperperson"], "bodilyInjuryPerPerson"],
  [["bodilyinjuryperaccident", "biperaccident"], "bodilyInjuryPerAccident"],
  [["propertydamage", "pdperaccident"], "propertyDamage"],
  // Umbrella/Excess
  [["umbrellaoccurrence", "eachoccurrenceumbrella", "excessoccurrence", "excesseachoccurrence"], "eachOccurrenceUmbrella"],
  [["umbrellaaggregate", "excessaggregate"], "umbrellaAggregate"],
  [["umbrella retention", "selfinsuredretention", "sir", "excessretention"], "umbrellaRetention"],
];

function synthesizeLimits(doc: InsuranceDocument): void {
  const raw = doc as Record<string, unknown>;

  // Don't overwrite existing limits
  if (raw.limits && typeof raw.limits === "object" && Object.keys(raw.limits as object).length > 0) return;

  const coverages = doc.coverages;
  if (!coverages || coverages.length === 0) return;

  const limits: Record<string, string> = {};

  for (const cov of coverages as CoverageRecord[]) {
    if (!cov.name || !cov.limit) continue;
    const normalized = normalizeName(cov.name);

    for (const [patterns, fieldName] of LIMIT_COVERAGE_MAP) {
      if (patterns.some((p) => normalized.includes(p) || p.includes(normalized))) {
        // For aggregate fields, prefer aggregate limitType
        if (fieldName.includes("Aggregate") || fieldName.includes("aggregate")) {
          if (!cov.limitType || cov.limitType === "aggregate") {
            limits[fieldName] = cov.limit;
          }
        } else {
          if (!limits[fieldName]) {
            limits[fieldName] = cov.limit;
          }
        }
        break;
      }
    }
  }

  // Also check for statutory (workers comp)
  const hasStatutory = (coverages as CoverageRecord[]).some(
    (c) => c.limitType === "statutory" || normalizeName(c.name ?? "").includes("statutory"),
  );
  if (hasStatutory) {
    limits.statutory = "true";
  }

  // Extract employers liability from coverages
  const elCoverages = (coverages as CoverageRecord[]).filter(
    (c) => normalizeName(c.name ?? "").includes("employersliability"),
  );
  if (elCoverages.length > 0) {
    const el: Record<string, string> = {};
    for (const c of elCoverages) {
      if (!c.limit) continue;
      const n = normalizeName(c.name ?? "");
      if (n.includes("accident") || n.includes("eachaccident")) el.eachAccident = c.limit;
      else if (n.includes("diseasepolicy") || n.includes("diseasepolicylimit")) el.diseasePolicyLimit = c.limit;
      else if (n.includes("diseaseemployee") || n.includes("diseaseeachemployee")) el.diseaseEachEmployee = c.limit;
      else if (!el.eachAccident) el.eachAccident = c.limit; // fallback first match
    }
    if (Object.keys(el).length > 0) {
      (limits as Record<string, unknown>).employersLiability = el;
    }
  }

  if (Object.keys(limits).length > 0) {
    // Convert "true" back to boolean for statutory
    const result: Record<string, unknown> = { ...limits };
    if (result.statutory === "true") result.statutory = true;
    raw.limits = result;
  }
}

// ── 6. Synthesize deductibles from coverages (issue 5) ──

function synthesizeDeductibles(doc: InsuranceDocument): void {
  const raw = doc as Record<string, unknown>;

  // Don't overwrite existing deductibles
  if (raw.deductibles && typeof raw.deductibles === "object" && Object.keys(raw.deductibles as object).length > 0) return;

  const coverages = doc.coverages as CoverageRecord[] | undefined;
  if (!coverages || coverages.length === 0) return;

  // Collect all deductible values
  const deductibleValues = coverages
    .filter((c) => c.deductible && c.deductible.trim() !== "" && c.deductible !== "N/A" && c.deductible !== "None")
    .map((c) => c.deductible!);

  if (deductibleValues.length === 0) return;

  // Find the most common deductible (base deductible)
  const freq = new Map<string, number>();
  for (const d of deductibleValues) {
    freq.set(d, (freq.get(d) ?? 0) + 1);
  }

  let mostCommon = deductibleValues[0];
  let maxFreq = 0;
  for (const [val, count] of freq) {
    if (count > maxFreq) {
      mostCommon = val;
      maxFreq = count;
    }
  }

  const deductibles: Record<string, string> = {};

  // Check if any coverage has per-claim deductible type
  const hasPerClaim = coverages.some(
    (c) => c.deductible && normalizeName(c.name ?? "").includes("perclaim"),
  );

  if (hasPerClaim) {
    deductibles.perClaim = mostCommon;
  } else {
    deductibles.perOccurrence = mostCommon;
  }

  // Look for SIR
  const sirCoverage = coverages.find(
    (c) => c.deductible && (
      normalizeName(c.name ?? "").includes("selfinsuredretention")
      || normalizeName(c.name ?? "").includes("sir")
    ),
  );
  if (sirCoverage?.deductible) {
    deductibles.selfInsuredRetention = sirCoverage.deductible;
  }

  // Look for aggregate deductible
  const aggDed = coverages.find(
    (c) => c.deductible && normalizeName(c.name ?? "").includes("aggregatedeductible"),
  );
  if (aggDed?.deductible) {
    deductibles.aggregateDeductible = aggDed.deductible;
  }

  if (Object.keys(deductibles).length > 0) {
    raw.deductibles = deductibles;
  }
}

// ── 7. Premium from declarations (issue 4 supplement) ──

const PREMIUM_PATTERNS = ["premium", "totalPremium", "annualPremium", "policyPremium", "basePremium"];
const TOTAL_COST_PATTERNS = ["totalCost", "totalDue", "totalAmount", "totalPolicyPremium"];

function promotePremium(doc: InsuranceDocument): void {
  const raw = doc as Record<string, unknown>;
  const fields = getDeclarationFields(doc);

  if (!raw.premium) {
    const premium = findFieldValue(fields, PREMIUM_PATTERNS);
    if (premium) raw.premium = premium;
  }

  if (!raw.totalCost) {
    const totalCost = findFieldValue(fields, TOTAL_COST_PATTERNS);
    if (totalCost) raw.totalCost = totalCost;
  }
}

// ── Public API ──

/**
 * Run all promotion passes on an assembled document, mutating it in place.
 * This fills in top-level typed fields from declarations key-value pairs
 * and coverage arrays that the initial assembly spread didn't promote.
 */
export function promoteExtractedFields(doc: InsuranceDocument): void {
  promoteCarrierFields(doc);
  promoteBroker(doc);
  promoteLossPayees(doc);
  promoteLocations(doc);
  synthesizeLimits(doc);
  synthesizeDeductibles(doc);
  promotePremium(doc);
}

// Export individual functions for testing
export {
  promoteCarrierFields,
  promoteBroker,
  promoteLossPayees,
  promoteLocations,
  synthesizeLimits,
  synthesizeDeductibles,
  promotePremium,
};
