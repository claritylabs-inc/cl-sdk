// src/extraction/chunking.ts
import type { InsuranceDocument, PolicyDocument, QuoteDocument } from "../schemas/document";
import type { DocumentChunk } from "../storage/chunk-types";

function formatAddress(addr: { street1: string; street2?: string; city: string; state: string; zip: string; country?: string }): string {
  const parts = [addr.street1, addr.street2, addr.city, addr.state, addr.zip, addr.country].filter(Boolean);
  return parts.join(", ");
}

/**
 * Break a validated document into retrieval-friendly chunks.
 * Each chunk has a deterministic ID, type tag, text for embedding, and metadata for filtering.
 */
export function chunkDocument(doc: InsuranceDocument): DocumentChunk[] {
  const ensureArray = (v: unknown) => (Array.isArray(v) ? v : []);
  doc = {
    ...doc,
    taxesAndFees: ensureArray(doc.taxesAndFees),
    ratingBasis: ensureArray(doc.ratingBasis),
    claimsContacts: ensureArray(doc.claimsContacts),
    regulatoryContacts: ensureArray(doc.regulatoryContacts),
    thirdPartyAdministrators: ensureArray(doc.thirdPartyAdministrators),
  };
  const chunks: DocumentChunk[] = [];
  const docId = doc.id;
  const policyTypesStr = doc.policyTypes?.length ? doc.policyTypes.join(",") : undefined;

  function stringMetadata(entries: Record<string, string | number | boolean | undefined | null>): Record<string, string> {
    const base = Object.fromEntries(
      Object.entries(entries)
        .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
        .map(([key, value]) => [key, String(value)]),
    );
    if (policyTypesStr) base.policyTypes = policyTypesStr;
    return base;
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
      doc.carrierAdmittedStatus ? `Admitted Status: ${doc.carrierAdmittedStatus}` : null,
      doc.mga ? `MGA: ${doc.mga}` : null,
      doc.underwriter ? `Underwriter: ${doc.underwriter}` : null,
      doc.brokerAgency ? `Broker: ${doc.brokerAgency}` : null,
      doc.brokerContactName ? `Broker Contact: ${doc.brokerContactName}` : null,
      doc.brokerLicenseNumber ? `Broker License: ${doc.brokerLicenseNumber}` : null,
      doc.programName ? `Program: ${doc.programName}` : null,
      doc.priorPolicyNumber ? `Prior Policy: ${doc.priorPolicyNumber}` : null,
      doc.isRenewal != null ? `Renewal: ${doc.isRenewal ? "Yes" : "No"}` : null,
      doc.isPackage != null ? `Package: ${doc.isPackage ? "Yes" : "No"}` : null,
      doc.security ? `Security: ${doc.security}` : null,
      doc.policyTypes?.length ? `Policy Types: ${doc.policyTypes.join(", ")}` : null,
    ].filter(Boolean).join("\n"),
    metadata: stringMetadata({ carrier: doc.carrier, documentType: doc.type }),
  });

  // Summary chunk
  if (doc.summary) {
    chunks.push({
      id: `${docId}:declaration:summary`,
      documentId: docId,
      type: "declaration",
      text: `Policy Summary: ${doc.summary}`,
      metadata: stringMetadata({ documentType: doc.type }),
    });
  }

  // Policy/quote identification chunk
  if (doc.type === "policy") {
    const pol = doc as PolicyDocument;
    chunks.push({
      id: `${docId}:declaration:policy_details`,
      documentId: docId,
      type: "declaration",
      text: [
        `Policy Number: ${pol.policyNumber}`,
        `Effective Date: ${pol.effectiveDate}`,
        pol.expirationDate ? `Expiration Date: ${pol.expirationDate}` : null,
        pol.policyTermType ? `Term Type: ${pol.policyTermType}` : null,
        pol.effectiveTime ? `Effective Time: ${pol.effectiveTime}` : null,
        pol.nextReviewDate ? `Next Review Date: ${pol.nextReviewDate}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({
        policyNumber: pol.policyNumber,
        effectiveDate: pol.effectiveDate,
        expirationDate: pol.expirationDate,
        documentType: doc.type,
      }),
    });
  } else {
    const quote = doc as QuoteDocument;
    chunks.push({
      id: `${docId}:declaration:quote_details`,
      documentId: docId,
      type: "declaration",
      text: [
        `Quote Number: ${quote.quoteNumber}`,
        quote.proposedEffectiveDate ? `Proposed Effective Date: ${quote.proposedEffectiveDate}` : null,
        quote.proposedExpirationDate ? `Proposed Expiration Date: ${quote.proposedExpirationDate}` : null,
        quote.quoteExpirationDate ? `Quote Expiration Date: ${quote.quoteExpirationDate}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({
        quoteNumber: quote.quoteNumber,
        documentType: doc.type,
      }),
    });
  }

  // Insurer info chunk (structured party data)
  if (doc.insurer) {
    chunks.push({
      id: `${docId}:party:insurer`,
      documentId: docId,
      type: "party",
      text: [
        `Insurer: ${doc.insurer.legalName}`,
        doc.insurer.naicNumber ? `NAIC: ${doc.insurer.naicNumber}` : null,
        doc.insurer.amBestRating ? `AM Best Rating: ${doc.insurer.amBestRating}` : null,
        doc.insurer.amBestNumber ? `AM Best Number: ${doc.insurer.amBestNumber}` : null,
        doc.insurer.admittedStatus ? `Admitted Status: ${doc.insurer.admittedStatus}` : null,
        doc.insurer.stateOfDomicile ? `State of Domicile: ${doc.insurer.stateOfDomicile}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({ partyRole: "insurer", partyName: doc.insurer.legalName, documentType: doc.type }),
    });
  }

  // Producer/broker info chunk
  if (doc.producer) {
    chunks.push({
      id: `${docId}:party:producer`,
      documentId: docId,
      type: "party",
      text: [
        `Producer/Broker: ${doc.producer.agencyName}`,
        doc.producer.contactName ? `Contact: ${doc.producer.contactName}` : null,
        doc.producer.licenseNumber ? `License: ${doc.producer.licenseNumber}` : null,
        doc.producer.phone ? `Phone: ${doc.producer.phone}` : null,
        doc.producer.email ? `Email: ${doc.producer.email}` : null,
        doc.producer.address ? `Address: ${formatAddress(doc.producer.address)}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({ partyRole: "producer", partyName: doc.producer.agencyName, documentType: doc.type }),
    });
  }

  // Named insured chunk
  chunks.push({
    id: `${docId}:named_insured:0`,
    documentId: docId,
    type: "named_insured",
    text: [
      `Insured: ${doc.insuredName}`,
      doc.insuredDba ? `DBA: ${doc.insuredDba}` : null,
      doc.insuredEntityType ? `Entity Type: ${doc.insuredEntityType}` : null,
      doc.insuredFein ? `FEIN: ${doc.insuredFein}` : null,
      doc.insuredSicCode ? `SIC: ${doc.insuredSicCode}` : null,
      doc.insuredNaicsCode ? `NAICS: ${doc.insuredNaicsCode}` : null,
      doc.insuredAddress ? `Address: ${formatAddress(doc.insuredAddress)}` : null,
    ].filter(Boolean).join("\n"),
    metadata: stringMetadata({ insuredName: doc.insuredName, documentType: doc.type }),
  });

  // Additional named insureds — one per insured
  doc.additionalNamedInsureds?.forEach((insured, i) => {
    chunks.push({
      id: `${docId}:named_insured:${i + 1}`,
      documentId: docId,
      type: "named_insured",
      text: [
        `Additional Named Insured: ${insured.name}`,
        insured.address ? `Address: ${formatAddress(insured.address)}` : null,
        insured.relationship ? `Relationship: ${insured.relationship}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({ insuredName: insured.name, role: "additional_named_insured", documentType: doc.type }),
    });
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

  // Enriched coverages — one per coverage (richer detail than basic coverages)
  doc.enrichedCoverages?.forEach((cov, i) => {
    chunks.push({
      id: `${docId}:coverage:enriched:${i}`,
      documentId: docId,
      type: "coverage",
      text: [
        `Coverage: ${cov.name}`,
        cov.coverageCode ? `Code: ${cov.coverageCode}` : null,
        `Limit: ${cov.limit}`,
        cov.limitType ? `Limit Type: ${cov.limitType}` : null,
        cov.deductible ? `Deductible: ${cov.deductible}` : null,
        cov.deductibleType ? `Deductible Type: ${cov.deductibleType}` : null,
        cov.sir ? `SIR: ${cov.sir}` : null,
        cov.sublimit ? `Sublimit: ${cov.sublimit}` : null,
        cov.coinsurance ? `Coinsurance: ${cov.coinsurance}` : null,
        cov.valuation ? `Valuation: ${cov.valuation}` : null,
        cov.territory ? `Territory: ${cov.territory}` : null,
        cov.trigger ? `Trigger: ${cov.trigger}` : null,
        cov.retroactiveDate ? `Retroactive Date: ${cov.retroactiveDate}` : null,
        `Included: ${cov.included ? "Yes" : "No"}`,
        cov.premium ? `Premium: ${cov.premium}` : null,
        cov.originalContent ? `Source: ${cov.originalContent}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({
        coverageName: cov.name,
        coverageCode: cov.coverageCode,
        limit: cov.limit,
        deductible: cov.deductible,
        formNumber: cov.formNumber,
        pageNumber: cov.pageNumber,
        included: cov.included,
        documentType: doc.type,
      }),
    });
  });

  // Limit schedule chunk
  if (doc.limits) {
    const limitLines: string[] = ["Limit Schedule"];
    const lim = doc.limits;
    if (lim.perOccurrence) limitLines.push(`Per Occurrence: ${lim.perOccurrence}`);
    if (lim.generalAggregate) limitLines.push(`General Aggregate: ${lim.generalAggregate}`);
    if (lim.productsCompletedOpsAggregate) limitLines.push(`Products/Completed Ops Aggregate: ${lim.productsCompletedOpsAggregate}`);
    if (lim.personalAdvertisingInjury) limitLines.push(`Personal & Advertising Injury: ${lim.personalAdvertisingInjury}`);
    if (lim.eachEmployee) limitLines.push(`Each Employee: ${lim.eachEmployee}`);
    if (lim.fireDamage) limitLines.push(`Fire Damage: ${lim.fireDamage}`);
    if (lim.medicalExpense) limitLines.push(`Medical Expense: ${lim.medicalExpense}`);
    if (lim.combinedSingleLimit) limitLines.push(`Combined Single Limit: ${lim.combinedSingleLimit}`);
    if (lim.bodilyInjuryPerPerson) limitLines.push(`Bodily Injury Per Person: ${lim.bodilyInjuryPerPerson}`);
    if (lim.bodilyInjuryPerAccident) limitLines.push(`Bodily Injury Per Accident: ${lim.bodilyInjuryPerAccident}`);
    if (lim.propertyDamage) limitLines.push(`Property Damage: ${lim.propertyDamage}`);
    if (lim.eachOccurrenceUmbrella) limitLines.push(`Umbrella Each Occurrence: ${lim.eachOccurrenceUmbrella}`);
    if (lim.umbrellaAggregate) limitLines.push(`Umbrella Aggregate: ${lim.umbrellaAggregate}`);
    if (lim.umbrellaRetention) limitLines.push(`Umbrella Retention: ${lim.umbrellaRetention}`);
    if (lim.statutory) limitLines.push(`Statutory: Yes`);
    if (lim.employersLiability) {
      limitLines.push(`Employers Liability — Each Accident: ${lim.employersLiability.eachAccident}, Disease Policy Limit: ${lim.employersLiability.diseasePolicyLimit}, Disease Each Employee: ${lim.employersLiability.diseaseEachEmployee}`);
    }
    if (lim.defenseCostTreatment) limitLines.push(`Defense Cost Treatment: ${lim.defenseCostTreatment}`);

    chunks.push({
      id: `${docId}:coverage:limit_schedule`,
      documentId: docId,
      type: "coverage",
      text: limitLines.join("\n"),
      metadata: stringMetadata({ coverageName: "limit_schedule", documentType: doc.type }),
    });

    // Sublimits — one per sublimit for precise retrieval
    lim.sublimits?.forEach((sub, i) => {
      chunks.push({
        id: `${docId}:coverage:sublimit:${i}`,
        documentId: docId,
        type: "coverage",
        text: [
          `Sublimit: ${sub.name}`,
          `Limit: ${sub.limit}`,
          sub.appliesTo ? `Applies To: ${sub.appliesTo}` : null,
          sub.deductible ? `Deductible: ${sub.deductible}` : null,
        ].filter(Boolean).join("\n"),
        metadata: stringMetadata({ coverageName: sub.name, limit: sub.limit, documentType: doc.type }),
      });
    });

    // Shared limits — one per shared limit
    lim.sharedLimits?.forEach((sl, i) => {
      chunks.push({
        id: `${docId}:coverage:shared_limit:${i}`,
        documentId: docId,
        type: "coverage",
        text: [
          `Shared Limit: ${sl.description}`,
          `Limit: ${sl.limit}`,
          `Coverage Parts: ${sl.coverageParts.join(", ")}`,
        ].join("\n"),
        metadata: stringMetadata({ coverageName: sl.description, limit: sl.limit, documentType: doc.type }),
      });
    });
  }

  // Deductible schedule chunk
  if (doc.deductibles) {
    const dedLines: string[] = ["Deductible Schedule"];
    const ded = doc.deductibles;
    if (ded.perClaim) dedLines.push(`Per Claim: ${ded.perClaim}`);
    if (ded.perOccurrence) dedLines.push(`Per Occurrence: ${ded.perOccurrence}`);
    if (ded.aggregateDeductible) dedLines.push(`Aggregate: ${ded.aggregateDeductible}`);
    if (ded.selfInsuredRetention) dedLines.push(`Self-Insured Retention: ${ded.selfInsuredRetention}`);
    if (ded.corridorDeductible) dedLines.push(`Corridor: ${ded.corridorDeductible}`);
    if (ded.waitingPeriod) dedLines.push(`Waiting Period: ${ded.waitingPeriod}`);
    if (ded.appliesTo) dedLines.push(`Applies To: ${ded.appliesTo}`);

    if (dedLines.length > 1) {
      chunks.push({
        id: `${docId}:coverage:deductible_schedule`,
        documentId: docId,
        type: "coverage",
        text: dedLines.join("\n"),
        metadata: stringMetadata({ coverageName: "deductible_schedule", documentType: doc.type }),
      });
    }
  }

  // Coverage form, retroactive date, extended reporting period
  const claimsMadeLines = [
    doc.coverageForm ? `Coverage Form: ${doc.coverageForm}` : null,
    doc.retroactiveDate ? `Retroactive Date: ${doc.retroactiveDate}` : null,
    doc.extendedReportingPeriod?.basicDays ? `Extended Reporting Period (Basic): ${doc.extendedReportingPeriod.basicDays} days` : null,
    doc.extendedReportingPeriod?.supplementalYears ? `Extended Reporting Period (Supplemental): ${doc.extendedReportingPeriod.supplementalYears} years` : null,
    doc.extendedReportingPeriod?.supplementalPremium ? `Extended Reporting Period Premium: ${doc.extendedReportingPeriod.supplementalPremium}` : null,
  ].filter(Boolean) as string[];

  if (claimsMadeLines.length > 0) {
    chunks.push({
      id: `${docId}:coverage:claims_made_details`,
      documentId: docId,
      type: "coverage",
      text: claimsMadeLines.join("\n"),
      metadata: stringMetadata({ coverageName: "claims_made_details", documentType: doc.type }),
    });
  }

  // Form inventory — one per form
  doc.formInventory?.forEach((form, i) => {
    chunks.push({
      id: `${docId}:declaration:form:${i}`,
      documentId: docId,
      type: "declaration",
      text: [
        `Form: ${form.formNumber}`,
        form.title ? `Title: ${form.title}` : null,
        `Type: ${form.formType}`,
        form.editionDate ? `Edition: ${form.editionDate}` : null,
        form.pageStart ? `Pages: ${form.pageStart}${form.pageEnd ? `-${form.pageEnd}` : ""}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({
        formNumber: form.formNumber,
        formType: form.formType,
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

  // Condition chunks — one per condition
  doc.conditions?.forEach((cond, i) => {
    chunks.push({
      id: `${docId}:condition:${i}`,
      documentId: docId,
      type: "condition",
      text: [
        `Condition: ${cond.name}`,
        `Type: ${cond.conditionType}`,
        cond.content,
        ...(cond.keyValues?.map((kv) => `${kv.key}: ${kv.value}`) ?? []),
      ].join("\n"),
      metadata: stringMetadata({
        conditionName: cond.name,
        conditionType: cond.conditionType,
        pageNumber: cond.pageNumber,
        documentType: doc.type,
      }),
    });
  });

  // Declaration chunks — group fields by subject for cohesive retrieval
  if (doc.declarations) {
    const decl = doc.declarations as Record<string, unknown>;
    const declLines: string[] = [];
    for (const [key, value] of Object.entries(decl)) {
      if (value && typeof value === "string") {
        declLines.push(`${key}: ${value}`);
      }
    }
    if (declLines.length > 0) {
      const declMeta: Record<string, string | undefined> = { documentType: doc.type };
      if (typeof decl.formType === "string") declMeta.formType = decl.formType;
      if (typeof decl.line === "string") declMeta.declarationLine = decl.line;
      chunks.push({
        id: `${docId}:declaration:0`,
        documentId: docId,
        type: "declaration",
        text: `Declarations\n${declLines.join("\n")}`,
        metadata: stringMetadata(declMeta),
      });
    }
  }

  // Section chunks — split large sections into subsections
  doc.sections?.forEach((sec, i) => {
    const hasSubsections = sec.subsections && sec.subsections.length > 0;
    const contentLength = sec.content.length;

    if (hasSubsections) {
      // Parent section chunk with just the title and overview
      chunks.push({
        id: `${docId}:section:${i}`,
        documentId: docId,
        type: "section",
        text: `Section: ${sec.title}\n${sec.content}`,
        metadata: stringMetadata({
          sectionType: sec.type,
          sectionNumber: sec.sectionNumber,
          pageStart: sec.pageStart,
          pageEnd: sec.pageEnd,
          documentType: doc.type,
          hasSubsections: "true",
        }),
      });

      // Individual subsection chunks
      sec.subsections!.forEach((sub, j) => {
        chunks.push({
          id: `${docId}:section:${i}:sub:${j}`,
          documentId: docId,
          type: "section",
          text: `${sec.title} > ${sub.title}\n${sub.content}`,
          metadata: stringMetadata({
            sectionType: sec.type,
            parentSection: sec.title,
            sectionNumber: sub.sectionNumber,
            pageNumber: sub.pageNumber,
            documentType: doc.type,
          }),
        });
      });
    } else if (contentLength > 2000) {
      // Split long sections into ~1000 char chunks at paragraph boundaries
      const paragraphs = sec.content.split(/\n\n+/);
      let currentChunk = "";
      let chunkIndex = 0;

      for (const para of paragraphs) {
        if (currentChunk.length + para.length > 1000 && currentChunk.length > 0) {
          chunks.push({
            id: `${docId}:section:${i}:part:${chunkIndex}`,
            documentId: docId,
            type: "section",
            text: `Section: ${sec.title} (part ${chunkIndex + 1})\n${currentChunk.trim()}`,
            metadata: stringMetadata({
              sectionType: sec.type,
              sectionNumber: sec.sectionNumber,
              pageStart: sec.pageStart,
              pageEnd: sec.pageEnd,
              documentType: doc.type,
              partIndex: chunkIndex,
            }),
          });
          currentChunk = "";
          chunkIndex++;
        }
        currentChunk += (currentChunk ? "\n\n" : "") + para;
      }

      // Emit remaining content
      if (currentChunk.trim()) {
        chunks.push({
          id: `${docId}:section:${i}:part:${chunkIndex}`,
          documentId: docId,
          type: "section",
          text: `Section: ${sec.title} (part ${chunkIndex + 1})\n${currentChunk.trim()}`,
          metadata: stringMetadata({
            sectionType: sec.type,
            sectionNumber: sec.sectionNumber,
            pageStart: sec.pageStart,
            pageEnd: sec.pageEnd,
            documentType: doc.type,
            partIndex: chunkIndex,
          }),
        });
      }
    } else {
      chunks.push({
        id: `${docId}:section:${i}`,
        documentId: docId,
        type: "section",
        text: `Section: ${sec.title}\n${sec.content}`,
        metadata: stringMetadata({
          sectionType: sec.type,
          sectionNumber: sec.sectionNumber,
          pageStart: sec.pageStart,
          pageEnd: sec.pageEnd,
          documentType: doc.type,
        }),
      });
    }
  });

  // Location chunks — one per insured location
  doc.locations?.forEach((loc, i) => {
    chunks.push({
      id: `${docId}:location:${i}`,
      documentId: docId,
      type: "location",
      text: [
        `Location ${loc.number}: ${formatAddress(loc.address)}`,
        loc.description ? `Description: ${loc.description}` : null,
        loc.occupancy ? `Occupancy: ${loc.occupancy}` : null,
        loc.constructionType ? `Construction: ${loc.constructionType}` : null,
        loc.yearBuilt ? `Year Built: ${loc.yearBuilt}` : null,
        loc.squareFootage ? `Square Footage: ${loc.squareFootage}` : null,
        loc.protectionClass ? `Protection Class: ${loc.protectionClass}` : null,
        loc.sprinklered != null ? `Sprinklered: ${loc.sprinklered ? "Yes" : "No"}` : null,
        loc.alarmType ? `Alarm: ${loc.alarmType}` : null,
        loc.buildingValue ? `Building Value: ${loc.buildingValue}` : null,
        loc.contentsValue ? `Contents Value: ${loc.contentsValue}` : null,
        loc.businessIncomeValue ? `Business Income Value: ${loc.businessIncomeValue}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({
        locationNumber: loc.number,
        occupancy: loc.occupancy,
        constructionType: loc.constructionType,
        documentType: doc.type,
      }),
    });
  });

  // Vehicle chunks — one per insured vehicle
  doc.vehicles?.forEach((veh, i) => {
    const vehicleDesc = `${veh.year} ${veh.make} ${veh.model}`;
    chunks.push({
      id: `${docId}:vehicle:${i}`,
      documentId: docId,
      type: "vehicle",
      text: [
        `Vehicle ${veh.number}: ${vehicleDesc}`,
        `VIN: ${veh.vin}`,
        veh.vehicleType ? `Type: ${veh.vehicleType}` : null,
        veh.costNew ? `Cost New: ${veh.costNew}` : null,
        veh.statedValue ? `Stated Value: ${veh.statedValue}` : null,
        veh.garageLocation ? `Garage Location: ${veh.garageLocation}` : null,
        veh.radius ? `Radius: ${veh.radius}` : null,
        ...(veh.coverages?.map((vc) =>
          `${vc.type}: ${[vc.limit && `Limit ${vc.limit}`, vc.deductible && `Ded ${vc.deductible}`, vc.included ? "Included" : "Excluded"].filter(Boolean).join(", ")}`,
        ) ?? []),
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({
        vehicleNumber: veh.number,
        vehicleYear: veh.year,
        vehicleMake: veh.make,
        vehicleModel: veh.model,
        vin: veh.vin,
        documentType: doc.type,
      }),
    });
  });

  // Classification chunks — one per class code
  doc.classifications?.forEach((cls, i) => {
    chunks.push({
      id: `${docId}:classification:${i}`,
      documentId: docId,
      type: "classification",
      text: [
        `Classification: ${cls.code} — ${cls.description}`,
        `Premium Basis: ${cls.premiumBasis}`,
        cls.basisAmount ? `Basis Amount: ${cls.basisAmount}` : null,
        cls.rate ? `Rate: ${cls.rate}` : null,
        cls.premium ? `Premium: ${cls.premium}` : null,
        cls.locationNumber ? `Location: ${cls.locationNumber}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({
        classCode: cls.code,
        classDescription: cls.description,
        locationNumber: cls.locationNumber,
        documentType: doc.type,
      }),
    });
  });

  // Additional insureds — one per party
  doc.additionalInsureds?.forEach((party, i) => {
    chunks.push({
      id: `${docId}:party:additional_insured:${i}`,
      documentId: docId,
      type: "party",
      text: [
        `Additional Insured: ${party.name}`,
        `Role: ${party.role}`,
        party.relationship ? `Relationship: ${party.relationship}` : null,
        party.scope ? `Scope: ${party.scope}` : null,
        party.address ? `Address: ${formatAddress(party.address)}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({ partyRole: "additional_insured", partyName: party.name, documentType: doc.type }),
    });
  });

  // Loss payees — one per party
  doc.lossPayees?.forEach((party, i) => {
    chunks.push({
      id: `${docId}:party:loss_payee:${i}`,
      documentId: docId,
      type: "party",
      text: [
        `Loss Payee: ${party.name}`,
        party.relationship ? `Relationship: ${party.relationship}` : null,
        party.scope ? `Scope: ${party.scope}` : null,
        party.address ? `Address: ${formatAddress(party.address)}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({ partyRole: "loss_payee", partyName: party.name, documentType: doc.type }),
    });
  });

  // Mortgage holders — one per party
  doc.mortgageHolders?.forEach((party, i) => {
    chunks.push({
      id: `${docId}:party:mortgage_holder:${i}`,
      documentId: docId,
      type: "party",
      text: [
        `Mortgage Holder: ${party.name}`,
        party.relationship ? `Relationship: ${party.relationship}` : null,
        party.scope ? `Scope: ${party.scope}` : null,
        party.address ? `Address: ${formatAddress(party.address)}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({ partyRole: "mortgage_holder", partyName: party.name, documentType: doc.type }),
    });
  });

  // Premium chunk — enriched with breakdown details
  if (doc.premium) {
    const premiumLines = [
      `Premium: ${doc.premium}`,
      doc.totalCost ? `Total Cost: ${doc.totalCost}` : null,
      doc.minimumPremium ? `Minimum Premium: ${doc.minimumPremium}` : null,
      doc.depositPremium ? `Deposit Premium: ${doc.depositPremium}` : null,
      doc.auditType ? `Audit Type: ${doc.auditType}` : null,
    ].filter(Boolean);

    chunks.push({
      id: `${docId}:premium:0`,
      documentId: docId,
      type: "premium",
      text: premiumLines.join("\n"),
      metadata: stringMetadata({ premium: doc.premium, documentType: doc.type }),
    });
  }

  // Taxes and fees — one chunk for all (usually queried together)
  if (doc.taxesAndFees?.length) {
    chunks.push({
      id: `${docId}:financial:taxes_fees`,
      documentId: docId,
      type: "financial",
      text: doc.taxesAndFees.map((item) =>
        [
          `${item.type ? `[${item.type}] ` : ""}${item.name}: ${item.amount}`,
          item.description ? `  ${item.description}` : null,
        ].filter(Boolean).join("\n"),
      ).join("\n"),
      metadata: stringMetadata({ financialCategory: "taxes_fees", documentType: doc.type }),
    });
  }

  // Payment plan
  if (doc.paymentPlan?.installments?.length) {
    chunks.push({
      id: `${docId}:financial:payment_plan`,
      documentId: docId,
      type: "financial",
      text: [
        "Payment Plan:",
        ...doc.paymentPlan.installments.map((inst) =>
          `${inst.dueDate}: ${inst.amount}${inst.description ? ` (${inst.description})` : ""}`,
        ),
        doc.paymentPlan.financeCharge ? `Finance Charge: ${doc.paymentPlan.financeCharge}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({ financialCategory: "payment_plan", documentType: doc.type }),
    });
  }

  // Premium by location — one per location
  doc.premiumByLocation?.forEach((lp, i) => {
    chunks.push({
      id: `${docId}:financial:location_premium:${i}`,
      documentId: docId,
      type: "financial",
      text: [
        `Location ${lp.locationNumber} Premium: ${lp.premium}`,
        lp.description ? `Description: ${lp.description}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({
        financialCategory: "location_premium",
        locationNumber: lp.locationNumber,
        documentType: doc.type,
      }),
    });
  });

  // Rating basis
  if (doc.ratingBasis?.length) {
    chunks.push({
      id: `${docId}:financial:rating_basis`,
      documentId: docId,
      type: "financial",
      text: doc.ratingBasis.map((rb) =>
        [
          `Rating Basis: ${rb.type}`,
          rb.amount ? `Amount: ${rb.amount}` : null,
          rb.description ? `Description: ${rb.description}` : null,
        ].filter(Boolean).join(" | "),
      ).join("\n"),
      metadata: stringMetadata({ financialCategory: "rating_basis", documentType: doc.type }),
    });
  }

  // Loss history — summary chunk
  if (doc.lossSummary) {
    chunks.push({
      id: `${docId}:loss_history:summary`,
      documentId: docId,
      type: "loss_history",
      text: [
        "Loss Summary",
        doc.lossSummary.period ? `Period: ${doc.lossSummary.period}` : null,
        doc.lossSummary.totalClaims != null ? `Total Claims: ${doc.lossSummary.totalClaims}` : null,
        doc.lossSummary.totalIncurred ? `Total Incurred: ${doc.lossSummary.totalIncurred}` : null,
        doc.lossSummary.totalPaid ? `Total Paid: ${doc.lossSummary.totalPaid}` : null,
        doc.lossSummary.totalReserved ? `Total Reserved: ${doc.lossSummary.totalReserved}` : null,
        doc.lossSummary.lossRatio ? `Loss Ratio: ${doc.lossSummary.lossRatio}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({ lossHistoryCategory: "summary", documentType: doc.type }),
    });
  }

  // Individual claims — one per claim
  doc.individualClaims?.forEach((claim, i) => {
    chunks.push({
      id: `${docId}:loss_history:claim:${i}`,
      documentId: docId,
      type: "loss_history",
      text: [
        `Claim: ${claim.dateOfLoss}`,
        claim.claimNumber ? `Claim #: ${claim.claimNumber}` : null,
        `Description: ${claim.description}`,
        `Status: ${claim.status}`,
        claim.claimant ? `Claimant: ${claim.claimant}` : null,
        claim.coverageLine ? `Coverage Line: ${claim.coverageLine}` : null,
        claim.paid ? `Paid: ${claim.paid}` : null,
        claim.reserved ? `Reserved: ${claim.reserved}` : null,
        claim.incurred ? `Incurred: ${claim.incurred}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({
        lossHistoryCategory: "claim",
        claimNumber: claim.claimNumber,
        claimStatus: claim.status,
        dateOfLoss: claim.dateOfLoss,
        documentType: doc.type,
      }),
    });
  });

  // Experience modification
  if (doc.experienceMod) {
    chunks.push({
      id: `${docId}:loss_history:experience_mod`,
      documentId: docId,
      type: "loss_history",
      text: [
        `Experience Modification Factor: ${doc.experienceMod.factor}`,
        doc.experienceMod.effectiveDate ? `Effective Date: ${doc.experienceMod.effectiveDate}` : null,
        doc.experienceMod.state ? `State: ${doc.experienceMod.state}` : null,
      ].filter(Boolean).join("\n"),
      metadata: stringMetadata({ lossHistoryCategory: "experience_mod", documentType: doc.type }),
    });
  }

  // Quote-specific chunks
  if (doc.type === "quote") {
    const quote = doc as QuoteDocument;

    // Subjectivities — one per item
    const subjectivities = quote.enrichedSubjectivities ?? quote.subjectivities;
    subjectivities?.forEach((sub, i) => {
      const enriched = sub as Record<string, unknown>;
      chunks.push({
        id: `${docId}:subjectivity:${i}`,
        documentId: docId,
        type: "subjectivity",
        text: [
          `Subjectivity: ${sub.description}`,
          sub.category ? `Category: ${sub.category}` : null,
          enriched.dueDate ? `Due Date: ${enriched.dueDate}` : null,
          enriched.status ? `Status: ${enriched.status}` : null,
        ].filter(Boolean).join("\n"),
        metadata: stringMetadata({
          category: sub.category,
          status: enriched.status as string | undefined,
          documentType: doc.type,
        }),
      });
    });

    // Underwriting conditions — one per item
    const uwConditions = quote.enrichedUnderwritingConditions ?? quote.underwritingConditions;
    uwConditions?.forEach((cond, i) => {
      const enriched = cond as Record<string, unknown>;
      chunks.push({
        id: `${docId}:underwriting_condition:${i}`,
        documentId: docId,
        type: "underwriting_condition",
        text: [
          `Underwriting Condition: ${cond.description}`,
          enriched.category ? `Category: ${enriched.category}` : null,
        ].filter(Boolean).join("\n"),
        metadata: stringMetadata({ documentType: doc.type }),
      });
    });

    // Premium breakdown
    if (quote.premiumBreakdown?.length) {
      chunks.push({
        id: `${docId}:financial:premium_breakdown`,
        documentId: docId,
        type: "financial",
        text: quote.premiumBreakdown.map((line) => `${line.line}: ${line.amount}`).join("\n"),
        metadata: stringMetadata({ financialCategory: "premium_breakdown", documentType: doc.type }),
      });
    }

    // Binding authority
    if (quote.bindingAuthority) {
      chunks.push({
        id: `${docId}:financial:binding_authority`,
        documentId: docId,
        type: "financial",
        text: [
          "Binding Authority",
          quote.bindingAuthority.authorizedBy ? `Authorized By: ${quote.bindingAuthority.authorizedBy}` : null,
          quote.bindingAuthority.method ? `Method: ${quote.bindingAuthority.method}` : null,
          quote.bindingAuthority.expiration ? `Expiration: ${quote.bindingAuthority.expiration}` : null,
          ...(quote.bindingAuthority.conditions?.map((c) => `Condition: ${c}`) ?? []),
        ].filter(Boolean).join("\n"),
        metadata: stringMetadata({ financialCategory: "binding_authority", documentType: doc.type }),
      });
    }

    // Warranty requirements
    if (quote.warrantyRequirements?.length) {
      quote.warrantyRequirements.forEach((req, i) => {
        chunks.push({
          id: `${docId}:underwriting_condition:warranty:${i}`,
          documentId: docId,
          type: "underwriting_condition",
          text: `Warranty Requirement: ${req}`,
          metadata: stringMetadata({ conditionCategory: "warranty", documentType: doc.type }),
        });
      });
    }

    // Loss control recommendations
    if (quote.lossControlRecommendations?.length) {
      quote.lossControlRecommendations.forEach((rec, i) => {
        chunks.push({
          id: `${docId}:underwriting_condition:loss_control:${i}`,
          documentId: docId,
          type: "underwriting_condition",
          text: `Loss Control Recommendation: ${rec}`,
          metadata: stringMetadata({ conditionCategory: "loss_control", documentType: doc.type }),
        });
      });
    }
  }

  // Supplementary chunks — split by category for better RAG retrieval
  let supplementaryIndex = 0;

  // Claims contacts
  if (doc.claimsContacts?.length) {
    chunks.push({
      id: `${docId}:supplementary:${supplementaryIndex++}`,
      documentId: docId,
      type: "supplementary",
      text: doc.claimsContacts.map((contact) => `Claims Contact: ${[
        contact.name,
        contact.phone,
        contact.email,
        contact.hours,
      ].filter(Boolean).join(" | ")}`).join("\n"),
      metadata: stringMetadata({ documentType: doc.type, supplementaryCategory: "claims_contacts" }),
    });
  }

  // Regulatory contacts
  if (doc.regulatoryContacts?.length) {
    chunks.push({
      id: `${docId}:supplementary:${supplementaryIndex++}`,
      documentId: docId,
      type: "supplementary",
      text: doc.regulatoryContacts.map((contact) => `Regulatory Contact: ${[
        contact.name,
        contact.phone,
        contact.email,
      ].filter(Boolean).join(" | ")}`).join("\n"),
      metadata: stringMetadata({ documentType: doc.type, supplementaryCategory: "regulatory_contacts" }),
    });
  }

  // Third-party administrators
  if (doc.thirdPartyAdministrators?.length) {
    chunks.push({
      id: `${docId}:supplementary:${supplementaryIndex++}`,
      documentId: docId,
      type: "supplementary",
      text: doc.thirdPartyAdministrators.map((contact) => `TPA: ${[
        contact.name,
        contact.phone,
        contact.email,
      ].filter(Boolean).join(" | ")}`).join("\n"),
      metadata: stringMetadata({ documentType: doc.type, supplementaryCategory: "third_party_administrators" }),
    });
  }

  // Notice periods
  const noticePeriodLines = [
    doc.cancellationNoticeDays != null ? `Cancellation Notice Days: ${doc.cancellationNoticeDays}` : null,
    doc.nonrenewalNoticeDays != null ? `Nonrenewal Notice Days: ${doc.nonrenewalNoticeDays}` : null,
  ].filter((line): line is string => Boolean(line));

  if (noticePeriodLines.length > 0) {
    chunks.push({
      id: `${docId}:supplementary:${supplementaryIndex++}`,
      documentId: docId,
      type: "supplementary",
      text: noticePeriodLines.join("\n"),
      metadata: stringMetadata({ documentType: doc.type, supplementaryCategory: "notice_periods" }),
    });
  }

  // Auxiliary facts — one chunk per fact for precise retrieval
  if (doc.supplementaryFacts?.length) {
    for (const fact of doc.supplementaryFacts) {
      chunks.push({
        id: `${docId}:supplementary:${supplementaryIndex++}`,
        documentId: docId,
        type: "supplementary",
        text: [
          fact.subject ? `Subject: ${fact.subject}` : null,
          `${fact.key}: ${fact.value}`,
          fact.context ? `Context: ${fact.context}` : null,
        ].filter(Boolean).join(" | "),
        metadata: stringMetadata({
          documentType: doc.type,
          supplementaryCategory: "auxiliary_fact",
          factKey: fact.key,
          factSubject: fact.subject,
        }),
      });
    }
  }

  return chunks;
}
