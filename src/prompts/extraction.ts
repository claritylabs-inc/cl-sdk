/**
 * Extraction prompt for insurance policy documents.
 * Single source of truth — used by extractPolicy, retryExtraction, and reExtractFromFile.
 */

/**
 * @deprecated No longer used for new extractions. Kept for backward compatibility
 * with rawExtractionResponse reparse (older extractions may have used this format).
 * New extractions use two-pass flow: METADATA_PROMPT (Sonnet) + buildSectionsPrompt (Haiku).
 */
export const EXTRACTION_PROMPT = `You are an expert insurance document analyst. Extract comprehensive structured data from this insurance document. Preserve original language verbatim — do not summarize or paraphrase section content.

Respond with JSON only. The JSON must follow this exact structure:

{
  "metadata": {
    "carrier": "primary insurance company name (for display purposes)",
    "security": "insurer or underwriter entity providing coverage, e.g. 'Lloyd's Underwriters' — the legal entity on risk",
    "underwriter": "named individual underwriter if listed, or null",
    "mga": "Managing General Agent or Program Administrator name if applicable (e.g. 'CFC Underwriting'), or null",
    "broker": "insurance broker name if identifiable, or null",
    "policyNumber": "policy or quote reference number",
    "documentType": "policy" or "quote",
    "policyTypes": ["general_liability", "commercial_property", "commercial_auto", "non_owned_auto", "workers_comp", "umbrella", "excess_liability", "professional_liability", "cyber", "epli", "directors_officers", "fiduciary_liability", "crime_fidelity", "inland_marine", "builders_risk", "environmental", "ocean_marine", "surety", "product_liability", "bop", "management_liability_package", "property", "other"],
    "policyYear": number,
    "effectiveDate": "MM/DD/YYYY",
    "expirationDate": "MM/DD/YYYY",
    "isRenewal": boolean,
    "premium": "$X,XXX",
    "insuredName": "name of insured party",
    "summary": "1-2 sentence summary of the document"
  },
  "metadataSource": {
    "carrierPage": number or null,
    "policyNumberPage": number or null,
    "premiumPage": number or null,
    "effectiveDatePage": number or null
  },
  "coverages": [
    {
      "name": "coverage name",
      "limit": "$X,XXX,XXX",
      "deductible": "$X,XXX or null",
      "pageNumber": number,
      "sectionRef": "section number reference or null"
    }
  ],
  "document": {
    "sections": [
      {
        "title": "section title",
        "sectionNumber": "e.g. 'I', '1.1', 'A' — or null if unnumbered",
        "pageStart": number,
        "pageEnd": number or null,
        "type": "one of: declarations, insuring_agreement, exclusion, condition, definition, endorsement, schedule, subjectivity, warranty, notice, regulatory, other",
        "coverageType": "links to policyTypes value if section is coverage-specific, or null",
        "content": "full verbatim text of the section",
        "subsections": [
          {
            "title": "subsection title",
            "sectionNumber": "subsection number or null",
            "pageNumber": number or null,
            "content": "full verbatim text"
          }
        ]
      }
    ],
    "regulatoryContext": {
      "content": "all regulatory context, governing law, jurisdiction clauses — verbatim",
      "pageNumber": number
    },
    "complaintContact": {
      "content": "complaint contact information and instructions — verbatim",
      "pageNumber": number
    },
    "costsAndFees": {
      "content": "other costs, fees, surcharges, and charges — verbatim",
      "pageNumber": number
    }
  },
  "totalPages": number
}

IMPORTANT INSTRUCTIONS:
- policyTypes should include ALL coverage types found in the document
- documentType should be "quote" if this is a quote/proposal, "policy" if it is a bound policy
- For carrier, use the primary company name. For security, use the full legal entity providing coverage
- Extract EVERY section, clause, endorsement, and schedule from the document as a separate entry in document.sections
- Preserve the original language exactly as written in the document — do not summarize
- Include accurate page numbers for every section and data point
- Classify each section by type (declarations, insuring_agreement, exclusion, condition, etc.)
- If a section relates to a specific coverage type, set coverageType to match the policyTypes value
- For regulatoryContext, complaintContact, and costsAndFees: set to null if not found in the document
- subsections within a section are optional — only include if the section has clearly defined subsections`;

/**
 * Pass 0: Document classification prompt (Haiku).
 * Quick classification to determine if a document is a policy or a quote.
 */
export const CLASSIFY_DOCUMENT_PROMPT = `You are an expert insurance document analyst. Classify this document as either a bound insurance POLICY or a QUOTE/PROPOSAL.

Respond with JSON only:

{
  "documentType": "policy" or "quote",
  "confidence": number between 0 and 1,
  "signals": ["signal 1", "signal 2"]
}

CLASSIFICATION SIGNALS:
- POLICY signals: declarations page, ISO form numbers (e.g. CG 00 01), binding language ("This policy is issued to"), endorsement schedules, "Certificate of Insurance"
- QUOTE signals: "quote", "proposal", "indication" wording, subjectivities, "subject to" conditions, quote expiration date, "proposed premium", "terms and conditions may vary"

If uncertain, lean toward "policy" for documents with declarations pages and binding language, "quote" for everything else.`;

/**
 * Chunked extraction: metadata-only prompt for the first pass on long documents.
 * Used for both policy and quote extractions (documentType already known from pass 0).
 */
export const METADATA_PROMPT = `You are an expert insurance document analyst. Extract the high-level metadata AND structured declarations data from this insurance document. Do NOT extract full section content — that will be done in a separate pass.

Respond with JSON only:

{
  "metadata": {
    "carrier": "primary insurance company name",
    "carrierLegalName": "legal entity name of insurer, or null",
    "carrierNaicNumber": "NAIC company code, or null",
    "carrierAmBestRating": "AM Best rating (e.g. 'A+ XV'), or null",
    "carrierAdmittedStatus": "admitted" or "non_admitted" or "surplus_lines" or null,
    "security": "insurer or underwriter entity providing coverage, or null",
    "underwriter": "named individual underwriter, or null",
    "mga": "MGA or Program Administrator, or null",
    "broker": "insurance broker agency name, or null",
    "brokerContactName": "individual producer name, or null",
    "brokerLicenseNumber": "producer license number, or null",
    "policyNumber": "policy number",
    "priorPolicyNumber": "previous policy number if renewal, or null",
    "documentType": "policy" or "quote",
    "policyTypes": ["general_liability", "commercial_property", "commercial_auto", "non_owned_auto", "workers_comp", "umbrella", "excess_liability", "professional_liability", "cyber", "epli", "directors_officers", "fiduciary_liability", "crime_fidelity", "inland_marine", "builders_risk", "environmental", "ocean_marine", "surety", "product_liability", "bop", "management_liability_package", "property", "other"],
    "coverageForm": "occurrence" or "claims_made" or "accident" or null,
    "policyYear": number,
    "effectiveDate": "MM/DD/YYYY",
    "expirationDate": "MM/DD/YYYY",
    "effectiveTime": "e.g. 12:01 AM, or null",
    "retroactiveDate": "MM/DD/YYYY for claims-made policies, or null",
    "isRenewal": boolean,
    "isPackage": boolean,
    "programName": "named program, or null",
    "premium": "$X,XXX",
    "insuredName": "name of primary named insured",
    "insuredDba": "doing-business-as name, or null",
    "insuredAddress": { "street1": "", "city": "", "state": "", "zip": "" } or null,
    "insuredEntityType": "corporation" or "llc" or "partnership" or "sole_proprietor" or "joint_venture" or "trust" or "nonprofit" or "municipality" or "other" or null,
    "insuredFein": "FEIN, or null",
    "summary": "1-2 sentence summary"
  },
  "metadataSource": {
    "carrierPage": number or null,
    "policyNumberPage": number or null,
    "premiumPage": number or null,
    "effectiveDatePage": number or null
  },
  "additionalNamedInsureds": [
    { "name": "insured name", "relationship": "subsidiary, affiliate, etc., or null" }
  ],
  "coverages": [
    { "name": "coverage name", "limit": "$X,XXX,XXX", "deductible": "$X,XXX or null", "pageNumber": number, "sectionRef": "section ref or null" }
  ],
  "limits": {
    "perOccurrence": "$X,XXX,XXX or null",
    "generalAggregate": "$X,XXX,XXX or null",
    "productsCompletedOpsAggregate": "or null",
    "personalAdvertisingInjury": "or null",
    "fireDamage": "or null",
    "medicalExpense": "or null",
    "combinedSingleLimit": "or null",
    "bodilyInjuryPerPerson": "or null",
    "bodilyInjuryPerAccident": "or null",
    "propertyDamage": "or null",
    "eachOccurrenceUmbrella": "or null",
    "umbrellaAggregate": "or null",
    "umbrellaRetention": "or null",
    "statutory": boolean or null,
    "employersLiability": { "eachAccident": "", "diseasePolicyLimit": "", "diseaseEachEmployee": "" } or null,
    "defenseCostTreatment": "inside_limits" or "outside_limits" or "supplementary" or null
  },
  "deductibles": {
    "perClaim": "or null",
    "perOccurrence": "or null",
    "selfInsuredRetention": "or null",
    "waitingPeriod": "or null"
  },
  "locations": [
    { "number": 1, "address": { "street1": "", "city": "", "state": "", "zip": "" }, "description": "or null", "buildingValue": "or null", "contentsValue": "or null" }
  ],
  "vehicles": [
    { "number": 1, "year": 2024, "make": "", "model": "", "vin": "", "vehicleType": "or null" }
  ],
  "classifications": [
    { "code": "12345", "description": "class description", "premiumBasis": "payroll or revenue or area", "basisAmount": "or null", "rate": "or null", "premium": "or null" }
  ],
  "formInventory": [
    { "formNumber": "CG 00 01", "editionDate": "04 13", "title": "or null", "formType": "coverage or endorsement or declarations or application or notice or other" }
  ],
  "taxesAndFees": [
    { "name": "fee name", "amount": "$X,XXX", "type": "tax or fee or surcharge or assessment or null" }
  ],
  "totalPages": number,
  "tableOfContents": [
    { "title": "section title", "pageStart": number, "pageEnd": number }
  ]
}

IMPORTANT:
- policyTypes should include ALL coverage types found in the document
- coverageForm is the primary trigger type: "occurrence" for occurrence-based, "claims_made" for claims-made, "accident" for auto/WC
- isPackage is true if this is a Commercial Package Policy (CPP) with multiple coverage parts
- Extract locations ONLY if a location/premises schedule is visible on the declarations
- Extract vehicles ONLY if a vehicle schedule is visible
- Extract classifications ONLY if a classification/rating schedule is visible
- formInventory: list ALL form numbers found in any forms schedule or endorsement schedule
- For limits, extract the standard limit fields that appear on the declarations page
- For deductibles, extract from the declarations or deductible schedule`;

/**
 * Quote-specific metadata prompt (Sonnet).
 * Extracts quote-specific fields like subjectivities, underwriting conditions, premium breakdown.
 */
export const QUOTE_METADATA_PROMPT = `You are an expert insurance document analyst. Extract the high-level metadata AND structured data from this insurance QUOTE or PROPOSAL. Do NOT extract full section content — that will be done in a separate pass.

Respond with JSON only:

{
  "metadata": {
    "carrier": "primary insurance company name",
    "carrierLegalName": "legal entity name, or null",
    "carrierNaicNumber": "NAIC code, or null",
    "carrierAdmittedStatus": "admitted or non_admitted or surplus_lines, or null",
    "security": "insurer or underwriter entity, or null",
    "underwriter": "named individual underwriter, or null",
    "mga": "MGA or Program Administrator, or null",
    "broker": "insurance broker, or null",
    "brokerContactName": "individual producer, or null",
    "quoteNumber": "quote or proposal reference number",
    "policyTypes": ["general_liability", "commercial_property", "commercial_auto", "non_owned_auto", "workers_comp", "umbrella", "excess_liability", "professional_liability", "cyber", "epli", "directors_officers", "fiduciary_liability", "crime_fidelity", "inland_marine", "builders_risk", "environmental", "ocean_marine", "surety", "product_liability", "bop", "management_liability_package", "property", "other"],
    "coverageForm": "occurrence or claims_made or accident, or null",
    "quoteYear": number,
    "proposedEffectiveDate": "MM/DD/YYYY or null",
    "proposedExpirationDate": "MM/DD/YYYY or null",
    "quoteExpirationDate": "MM/DD/YYYY — when this quote offer expires, or null",
    "retroactiveDate": "MM/DD/YYYY for claims-made, or null",
    "isRenewal": boolean,
    "premium": "$X,XXX — total proposed premium",
    "insuredName": "name of insured party",
    "insuredAddress": { "street1": "", "city": "", "state": "", "zip": "" } or null,
    "summary": "1-2 sentence summary of the quote"
  },
  "metadataSource": {
    "carrierPage": number or null,
    "quoteNumberPage": number or null,
    "premiumPage": number or null,
    "effectiveDatePage": number or null
  },
  "coverages": [
    { "name": "coverage name", "proposedLimit": "$X,XXX,XXX", "proposedDeductible": "$X,XXX or null", "pageNumber": number, "sectionRef": "or null" }
  ],
  "limits": {
    "perOccurrence": "or null",
    "generalAggregate": "or null",
    "defenseCostTreatment": "inside_limits or outside_limits or supplementary, or null"
  },
  "deductibles": {
    "perClaim": "or null",
    "perOccurrence": "or null",
    "selfInsuredRetention": "or null",
    "waitingPeriod": "or null"
  },
  "premiumBreakdown": [
    { "line": "coverage line name", "amount": "$X,XXX" }
  ],
  "subjectivities": [
    { "description": "subjectivity description", "category": "pre_binding or post_binding or information, or null", "dueDate": "or null", "pageNumber": number or null }
  ],
  "underwritingConditions": [
    { "description": "condition description", "category": "or null", "pageNumber": number or null }
  ],
  "warrantyRequirements": ["warranty text"],
  "taxesAndFees": [
    { "name": "fee name", "amount": "$X,XXX", "type": "tax or fee or surcharge, or null" }
  ],
  "totalPages": number,
  "tableOfContents": [
    { "title": "section title", "pageStart": number, "pageEnd": number }
  ]
}

IMPORTANT:
- quoteExpirationDate is when the quote offer itself expires (not the proposed policy period)
- subjectivities are conditions that must be met before or after binding
- premiumBreakdown should list each coverage line's individual premium if available
- warrantyRequirements: extract any warranty provisions required for coverage
- For limits and deductibles, extract the proposed structure from the quote`;

/**
 * Chunked extraction: sections prompt for a specific page range (policies).
 */
export function buildSectionsPrompt(pageStart: number, pageEnd: number): string {
  return `You are an expert insurance document analyst. Extract ALL sections, clauses, endorsements, and schedules found on pages ${pageStart} through ${pageEnd} of this document. Preserve the original language verbatim.

Respond with JSON only:

{
  "sections": [
    {
      "title": "section title",
      "sectionNumber": "section number or null",
      "pageStart": number,
      "pageEnd": number or null,
      "type": "one of: declarations, insuring_agreement, policy_form, endorsement, application, exclusion, condition, definition, schedule, notice, regulatory, other",
      "coverageType": "policyTypes value if coverage-specific, or null",
      "content": "full verbatim text of the section",
      "subsections": [
        { "title": "subsection title", "sectionNumber": "or null", "pageNumber": number, "content": "full verbatim text" }
      ]
    }
  ],
  "endorsements": [
    {
      "formNumber": "e.g. CG 21 47",
      "editionDate": "e.g. 12 07, or null",
      "title": "endorsement title",
      "coverageType": "policyTypes value if coverage-specific, or null",
      "pageStart": number,
      "effectType": "broadening or restrictive or informational or null",
      "additionalPremium": "$X,XXX or null",
      "content": "full verbatim text of the endorsement"
    }
  ],
  "exclusions": [
    {
      "title": "exclusion title or short description",
      "formNumber": "form number if part of a named endorsement, or null",
      "coverageType": "policyTypes value if coverage-specific, or null",
      "pageNumber": number,
      "content": "full verbatim exclusion text"
    }
  ],
  "conditions": [
    {
      "title": "condition title",
      "coverageType": "policyTypes value if coverage-specific, or null",
      "pageNumber": number,
      "content": "full verbatim condition text"
    }
  ],
  "regulatoryContext": { "content": "verbatim text", "pageNumber": number } or null,
  "complaintContact": { "content": "verbatim text", "pageNumber": number } or null,
  "costsAndFees": { "content": "verbatim text", "pageNumber": number } or null,
  "claimsContact": { "content": "verbatim text about how to report/file claims", "pageNumber": number } or null
}

SECTION TYPE GUIDANCE:
- "declarations" — the declarations page(s) listing named insured, policy period, limits, premiums
- "policy_form" — named ISO or proprietary forms (e.g. CG 00 01, IL 00 17). Sections within a named form should all be typed as "policy_form"
- "endorsement" — standalone endorsements modifying the base policy
- "application" — the insurance application or supplemental application
- "insuring_agreement" — the insuring agreement clause (only if standalone, not inside a policy_form)
- Other types for standalone sections only

ENDORSEMENT GUIDANCE:
- List every endorsement found in the page range in the "endorsements" array
- effectType: "broadening" adds or expands coverage; "restrictive" limits or excludes coverage; "informational" changes administrative terms only
- additionalPremium: extract if a premium charge or credit is shown on the endorsement

EXCLUSION GUIDANCE:
- List named exclusions from exclusion schedules or endorsements in the "exclusions" array
- Also capture exclusions embedded within insuring agreements or conditions as separate entries if clearly labeled
- Preserve the full verbatim exclusion text

CONDITION GUIDANCE:
- List policy conditions (duties after loss, cooperation clause, cancellation, etc.) in the "conditions" array

IMPORTANT: Only extract content from pages ${pageStart}-${pageEnd}. Preserve original language exactly.`;
}

/** Alias for backward compatibility */
export const buildPolicySectionsPrompt = buildSectionsPrompt;

/**
 * Chunked extraction: sections prompt for quote documents.
 */
export function buildQuoteSectionsPrompt(pageStart: number, pageEnd: number): string {
  return `You are an expert insurance document analyst. Extract ALL sections found on pages ${pageStart} through ${pageEnd} of this insurance QUOTE or PROPOSAL. Preserve the original language verbatim.

Respond with JSON only:

{
  "sections": [
    {
      "title": "section title",
      "sectionNumber": "section number or null",
      "pageStart": number,
      "pageEnd": number or null,
      "type": "one of: terms_summary, premium_indication, underwriting_condition, subjectivity, coverage_summary, exclusion, other",
      "coverageType": "policyTypes value if coverage-specific, or null",
      "content": "full verbatim text of the section",
      "subsections": [
        { "title": "subsection title", "sectionNumber": "or null", "pageNumber": number, "content": "full verbatim text" }
      ]
    }
  ],
  "exclusions": [
    {
      "title": "exclusion title or short description",
      "coverageType": "policyTypes value if coverage-specific, or null",
      "pageNumber": number,
      "content": "full verbatim exclusion text"
    }
  ],
  "subjectivities": [
    { "description": "subjectivity text", "category": "pre_binding or post_binding or information, or null", "dueDate": "or null", "pageNumber": number or null }
  ],
  "underwritingConditions": [
    { "description": "condition text", "category": "or null", "pageNumber": number or null }
  ]
}

SECTION TYPE GUIDANCE:
- "terms_summary" — overview of proposed terms, key conditions
- "premium_indication" — premium tables, rate schedules, premium breakdown
- "underwriting_condition" — conditions that must be met for coverage
- "subjectivity" — items "subject to" that must be provided or completed
- "coverage_summary" — proposed coverage limits, deductibles, coverage descriptions
- "exclusion" — excluded coverages, limitations
- "other" — anything else

EXCLUSION GUIDANCE:
- List named exclusions from any exclusion schedule, endorsement, or coverage summary in the "exclusions" array
- Preserve the full verbatim exclusion text
- Set coverageType if the exclusion applies to a specific coverage line

IMPORTANT: Only extract content from pages ${pageStart}-${pageEnd}. Preserve original language exactly.`;
}

/**
 * Pass 3: Supplementary field enrichment prompt.
 * Text-only (no PDF) — parses raw text blobs into structured data.
 */
export function buildSupplementaryEnrichmentPrompt(
  fields: {
    regulatoryContext?: string;
    complaintContact?: string;
    costsAndFees?: string;
    claimsContact?: string;
  },
): string {
  const parts: string[] = [];

  parts.push(`You are an expert insurance document analyst. Parse the following raw text excerpts from an insurance policy into structured data. Respond with JSON only.

{`);

  const fieldPrompts: string[] = [];

  if (fields.regulatoryContext) {
    fieldPrompts.push(`  "regulatoryContext": {
    "jurisdiction": "state or jurisdiction mentioned, or null",
    "regulatoryBody": "name of regulatory body/department, or null",
    "governingLaw": "governing law or statute cited, or null",
    "details": [{ "label": "descriptive label", "value": "extracted value" }]
  }`);
  }

  if (fields.complaintContact) {
    fieldPrompts.push(`  "complaintContact": {
    "contacts": [
      {
        "name": "organization or person name, or null",
        "type": "e.g. 'State Department of Insurance', 'Carrier', 'Ombudsman', or null",
        "phone": "phone number or null",
        "fax": "fax number or null",
        "email": "email address or null",
        "title": "job title or null",
        "address": "mailing address or null"
      }
    ]
  }`);
  }

  if (fields.costsAndFees) {
    fieldPrompts.push(`  "costsAndFees": {
    "fees": [
      {
        "name": "fee or charge name",
        "amount": "dollar amount or percentage, or null",
        "description": "brief description, or null",
        "type": "e.g. 'surcharge', 'tax', 'fee', 'assessment', or null"
      }
    ]
  }`);
  }

  if (fields.claimsContact) {
    fieldPrompts.push(`  "claimsContact": {
    "contacts": [
      {
        "name": "organization or person name, or null",
        "phone": "phone number or null",
        "fax": "fax number or null",
        "email": "email address or null",
        "address": "mailing address or null",
        "hours": "hours of operation or null"
      }
    ],
    "processSteps": ["step 1 description", "step 2 description"],
    "reportingTimeLimit": "time limit for reporting claims, or null"
  }`);
  }

  parts.push(fieldPrompts.join(",\n"));
  parts.push(`\n}`);

  parts.push(`\n\nIMPORTANT: Only include fields shown above. Extract all relevant structured data from the raw text. If a sub-field cannot be determined, use null.\n`);

  // Append raw text for each field
  parts.push(`\n--- RAW TEXT INPUTS ---\n`);

  if (fields.regulatoryContext) {
    parts.push(`\n[REGULATORY CONTEXT]\n${fields.regulatoryContext}\n`);
  }
  if (fields.complaintContact) {
    parts.push(`\n[COMPLAINT CONTACT]\n${fields.complaintContact}\n`);
  }
  if (fields.costsAndFees) {
    parts.push(`\n[COSTS AND FEES]\n${fields.costsAndFees}\n`);
  }
  if (fields.claimsContact) {
    parts.push(`\n[CLAIMS CONTACT]\n${fields.claimsContact}\n`);
  }

  return parts.join("");
}
