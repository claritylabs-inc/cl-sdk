import type { PageAssignment } from "../prompts/coordinator/page-map";
import type { ReviewResult } from "../prompts/coordinator/review";
import type { BaseQualityIssue, QualityArtifact, QualityGateStatus, QualityRound, UnifiedQualityReport } from "../core/quality";
import { evaluateQualityGate } from "../core/quality";
import type { FormInventoryEntry as ExtractedFormInventoryEntry } from "../prompts/coordinator/form-inventory";

export interface FormInventoryEntry {
  formNumber: string;
  title?: string;
  pageStart?: number;
  pageEnd?: number;
  sources: string[];
}

export interface QualityIssue extends BaseQualityIssue {
  message: string;
  extractorName?: string;
  pageNumber?: number;
  formNumber?: string;
  itemName?: string;
}

export interface ReviewRoundRecord {
  round: number;
  complete: boolean;
  missingFields: string[];
  qualityIssues: string[];
  additionalTasks: Array<{
    extractorName: string;
    startPage: number;
    endPage: number;
    description: string;
  }>;
}

export interface ExtractionReviewReport extends UnifiedQualityReport<QualityIssue> {
  reviewRoundRecords: ReviewRoundRecord[];
  formInventory: FormInventoryEntry[];
  qualityGateStatus: QualityGateStatus;
}

function normalizeFormNumber(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function addFormEntry(
  inventory: Map<string, FormInventoryEntry>,
  formNumber: string | undefined,
  source: string,
  extra?: Partial<FormInventoryEntry>,
) {
  if (!formNumber) return;
  const existing = inventory.get(formNumber);
  if (existing) {
    if (!existing.title && extra?.title) existing.title = extra.title;
    if (!existing.pageStart && extra?.pageStart) existing.pageStart = extra.pageStart;
    if (!existing.pageEnd && extra?.pageEnd) existing.pageEnd = extra.pageEnd;
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return;
  }

  inventory.set(formNumber, {
    formNumber,
    title: extra?.title,
    pageStart: extra?.pageStart,
    pageEnd: extra?.pageEnd,
    sources: [source],
  });
}

function looksReferential(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return normalized.includes("shown in the declarations")
    || normalized.includes("shown in declarations")
    || normalized.includes("shown in the schedule")
    || normalized.includes("as stated")
    || normalized.includes("if applicable");
}

function looksTocArtifact(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /\.{4,}\d{1,3}$/.test(value.trim()) || /^\d+\.\s+[A-Z][\s\S]*\.{3,}\d{1,3}$/.test(value.trim());
}

function sourcePrecedence(sectionRef: unknown): number {
  if (typeof sectionRef !== "string") return 0;
  const normalized = sectionRef.toLowerCase();
  if (normalized.includes("declaration") || normalized.includes("scheduled coverages") || normalized.includes("schedule")) return 4;
  if (normalized.includes("endorsement")) return 3;
  if (normalized.includes("additional coverages")) return 2;
  if (normalized.includes("coverage form") || normalized.includes("policy form")) return 1;
  return 0;
}

export function buildExtractionReviewReport(params: {
  memory: Map<string, unknown>;
  pageAssignments: PageAssignment[];
  reviewRounds: ReviewRoundRecord[];
}): ExtractionReviewReport {
  const { memory, reviewRounds } = params;
  const deterministicIssues: QualityIssue[] = [];
  const inventory = new Map<string, FormInventoryEntry>();

  const extractedFormInventory = (memory.get("form_inventory") as { forms?: ExtractedFormInventoryEntry[] } | undefined)?.forms ?? [];
  const coverages = (memory.get("coverage_limits") as { coverages?: Array<Record<string, unknown>> } | undefined)?.coverages ?? [];
  const endorsements = (memory.get("endorsements") as { endorsements?: Array<Record<string, unknown>> } | undefined)?.endorsements ?? [];
  const exclusions = (memory.get("exclusions") as { exclusions?: Array<Record<string, unknown>> } | undefined)?.exclusions ?? [];
  const conditions = (memory.get("conditions") as { conditions?: Array<Record<string, unknown>> } | undefined)?.conditions ?? [];
  const sections = (memory.get("sections") as { sections?: Array<Record<string, unknown>> } | undefined)?.sections ?? [];

  for (const form of extractedFormInventory) {
    addFormEntry(
      inventory,
      normalizeFormNumber(form.formNumber),
      "form_inventory",
      {
        title: form.title,
        pageStart: form.pageStart,
        pageEnd: form.pageEnd,
      },
    );
  }

  for (const endorsement of endorsements) {
    addFormEntry(
      inventory,
      normalizeFormNumber(endorsement.formNumber),
      "endorsements",
      {
        title: typeof endorsement.title === "string" ? endorsement.title : undefined,
        pageStart: typeof endorsement.pageStart === "number" ? endorsement.pageStart : undefined,
        pageEnd: typeof endorsement.pageEnd === "number" ? endorsement.pageEnd : undefined,
      },
    );

    if (typeof endorsement.formNumber !== "string" || !endorsement.formNumber.trim()) {
      deterministicIssues.push({
        code: "endorsement_missing_form_number",
        severity: "blocking",
        message: "Endorsement is missing formNumber.",
        extractorName: "endorsements",
        pageNumber: typeof endorsement.pageStart === "number" ? endorsement.pageStart : undefined,
        itemName: typeof endorsement.title === "string" ? endorsement.title : undefined,
      });
    }

    const endorsementFormNumber = normalizeFormNumber(endorsement.formNumber);
    if (endorsementFormNumber && !inventory.has(endorsementFormNumber)) {
      deterministicIssues.push({
        code: "endorsement_form_missing_from_inventory",
        severity: "warning",
        message: `Endorsement "${String(endorsement.title ?? endorsementFormNumber)}" is not present in form inventory.`,
        extractorName: "endorsements",
        formNumber: endorsementFormNumber,
        pageNumber: typeof endorsement.pageStart === "number" ? endorsement.pageStart : undefined,
        itemName: typeof endorsement.title === "string" ? endorsement.title : undefined,
      });
    }
  }

  for (const coverage of coverages) {
    const formNumber = normalizeFormNumber(coverage.formNumber);
    addFormEntry(inventory, formNumber, "coverage_limits", {
      title: typeof coverage.name === "string" ? coverage.name : undefined,
      pageStart: typeof coverage.pageNumber === "number" ? coverage.pageNumber : undefined,
      pageEnd: typeof coverage.pageNumber === "number" ? coverage.pageNumber : undefined,
    });

    if (typeof coverage.name === "string" && /coverage form$/i.test(coverage.name.trim())) {
      deterministicIssues.push({
        code: "generic_form_row_as_coverage",
        severity: "blocking",
        message: `Coverage "${coverage.name}" looks like a form header rather than a real coverage row.`,
        extractorName: "coverage_limits",
        formNumber,
        pageNumber: typeof coverage.pageNumber === "number" ? coverage.pageNumber : undefined,
        itemName: coverage.name,
      });
    }

    if (typeof coverage.pageNumber !== "number") {
      deterministicIssues.push({
        code: "coverage_missing_page_number",
        severity: "warning",
        message: `Coverage "${String(coverage.name ?? "unknown")}" is missing pageNumber provenance.`,
        extractorName: "coverage_limits",
        formNumber,
        itemName: typeof coverage.name === "string" ? coverage.name : undefined,
      });
    }

    if (typeof coverage.sectionRef !== "string" || !coverage.sectionRef.trim()) {
      deterministicIssues.push({
        code: "coverage_missing_section_ref",
        severity: "warning",
        message: `Coverage "${String(coverage.name ?? "unknown")}" is missing sectionRef provenance.`,
        extractorName: "coverage_limits",
        formNumber,
        pageNumber: typeof coverage.pageNumber === "number" ? coverage.pageNumber : undefined,
        itemName: typeof coverage.name === "string" ? coverage.name : undefined,
      });
    }

    if (typeof coverage.originalContent !== "string" || !coverage.originalContent.trim()) {
      deterministicIssues.push({
        code: "coverage_missing_original_content",
        severity: "warning",
        message: `Coverage "${String(coverage.name ?? "unknown")}" is missing originalContent source text.`,
        extractorName: "coverage_limits",
        formNumber,
        pageNumber: typeof coverage.pageNumber === "number" ? coverage.pageNumber : undefined,
        itemName: typeof coverage.name === "string" ? coverage.name : undefined,
      });
    }

    if (looksReferential(coverage.limit) || looksReferential(coverage.deductible)) {
      deterministicIssues.push({
        code: "coverage_referential_value",
        severity: "warning",
        message: `Coverage "${String(coverage.name ?? "unknown")}" contains referential language instead of a concrete scheduled term.`,
        extractorName: "coverage_limits",
        formNumber,
        pageNumber: typeof coverage.pageNumber === "number" ? coverage.pageNumber : undefined,
        itemName: typeof coverage.name === "string" ? coverage.name : undefined,
      });
    }

    if (formNumber && !inventory.has(formNumber)) {
      deterministicIssues.push({
        code: "coverage_form_missing_from_inventory",
        severity: "warning",
        message: `Coverage "${String(coverage.name ?? "unknown")}" references form "${formNumber}" that is missing from form inventory.`,
        extractorName: "coverage_limits",
        formNumber,
        pageNumber: typeof coverage.pageNumber === "number" ? coverage.pageNumber : undefined,
        itemName: typeof coverage.name === "string" ? coverage.name : undefined,
      });
    }
  }

  const coverageGroups = new Map<string, Array<Record<string, unknown>>>();
  for (const coverage of coverages) {
    const key = [
      String(coverage.name ?? "").toLowerCase(),
      String(coverage.formNumber ?? "").toLowerCase(),
    ].join("|");
    coverageGroups.set(key, [...(coverageGroups.get(key) ?? []), coverage]);
  }

  for (const [key, groupedCoverages] of coverageGroups.entries()) {
    if (groupedCoverages.length < 2) continue;

    const sorted = [...groupedCoverages].sort((a, b) => sourcePrecedence(b.sectionRef) - sourcePrecedence(a.sectionRef));
    const highest = sorted[0];

    for (const lower of sorted.slice(1)) {
      const highestLimit = String(highest.limit ?? "").trim();
      const lowerLimit = String(lower.limit ?? "").trim();
      const highestDeductible = String(highest.deductible ?? "").trim();
      const lowerDeductible = String(lower.deductible ?? "").trim();

      if ((highestLimit && lowerLimit && highestLimit !== lowerLimit) || (highestDeductible && lowerDeductible && highestDeductible !== lowerDeductible)) {
        deterministicIssues.push({
          code: "coverage_precedence_conflict",
          severity: "warning",
          message: `Coverage "${String(highest.name ?? key)}" has conflicting extracted terms across sources with different precedence.`,
          extractorName: "coverage_limits",
          formNumber: normalizeFormNumber(highest.formNumber) ?? normalizeFormNumber(lower.formNumber),
          pageNumber: typeof lower.pageNumber === "number" ? lower.pageNumber : undefined,
          itemName: typeof highest.name === "string" ? highest.name : undefined,
        });
      }
    }
  }

  for (const exclusion of exclusions) {
    addFormEntry(inventory, normalizeFormNumber(exclusion.formNumber), "exclusions", {
      title: typeof exclusion.name === "string" ? exclusion.name : undefined,
      pageStart: typeof exclusion.pageNumber === "number" ? exclusion.pageNumber : undefined,
      pageEnd: typeof exclusion.pageNumber === "number" ? exclusion.pageNumber : undefined,
    });

    if (typeof exclusion.pageNumber !== "number") {
      deterministicIssues.push({
        code: "exclusion_missing_page_number",
        severity: "warning",
        message: `Exclusion "${String(exclusion.name ?? "unknown")}" is missing pageNumber provenance.`,
        extractorName: "exclusions",
        formNumber: normalizeFormNumber(exclusion.formNumber),
        itemName: typeof exclusion.name === "string" ? exclusion.name : undefined,
      });
    }

    if (looksTocArtifact(exclusion.content)) {
      deterministicIssues.push({
        code: "exclusion_toc_artifact",
        severity: "blocking",
        message: `Exclusion "${String(exclusion.name ?? "unknown")}" appears to be a table-of-contents artifact.`,
        extractorName: "exclusions",
        pageNumber: typeof exclusion.pageNumber === "number" ? exclusion.pageNumber : undefined,
        itemName: typeof exclusion.name === "string" ? exclusion.name : undefined,
      });
    }
  }

  for (const condition of conditions) {
    if (typeof condition.pageNumber !== "number") {
      deterministicIssues.push({
        code: "condition_missing_page_number",
        severity: "warning",
        message: `Condition "${String(condition.name ?? "unknown")}" is missing pageNumber provenance.`,
        extractorName: "conditions",
        itemName: typeof condition.name === "string" ? condition.name : undefined,
      });
    }

    if (looksTocArtifact(condition.content)) {
      deterministicIssues.push({
        code: "condition_toc_artifact",
        severity: "blocking",
        message: `Condition "${String(condition.name ?? "unknown")}" appears to be a table-of-contents artifact.`,
        extractorName: "conditions",
        pageNumber: typeof condition.pageNumber === "number" ? condition.pageNumber : undefined,
        itemName: typeof condition.name === "string" ? condition.name : undefined,
      });
    }
  }

  for (const section of sections) {
    if (
      typeof section.content === "string"
      && section.content.trim().length < 120
      && typeof section.pageStart === "number"
      && (!("pageEnd" in section) || section.pageEnd === section.pageStart || section.pageEnd === undefined)
    ) {
      deterministicIssues.push({
        code: "section_short_fragment",
        severity: "warning",
        message: `Section "${String(section.title ?? "unknown")}" may be an orphan continuation fragment.`,
        extractorName: "sections",
        pageNumber: typeof section.pageStart === "number" ? section.pageStart : undefined,
        itemName: typeof section.title === "string" ? section.title : undefined,
      });
    }
  }

  const formInventory = [...inventory.values()].sort((a, b) => a.formNumber.localeCompare(b.formNumber));
  const rounds: QualityRound[] = reviewRounds.map((round) => ({
    round: round.round,
    kind: "llm_review",
    status: round.complete && round.qualityIssues.length === 0 ? "passed" : "warning",
    summary: round.qualityIssues[0] ?? (round.complete ? "Review passed." : "Review requested follow-up extraction."),
  }));
  const artifacts: QualityArtifact[] = [
    { kind: "form_inventory", label: "Form Inventory", itemCount: formInventory.length },
    { kind: "page_map", label: "Page Map", itemCount: params.pageAssignments.length },
    { kind: "referential_resolution", label: "Referential Resolution", itemCount: coverages.filter((c: Record<string, unknown>) => c.limitValueType === "referential" || c.limitValueType === "as_stated" || c.deductibleValueType === "referential" || c.deductibleValueType === "as_stated").length },
  ];

  const qualityGateStatus = evaluateQualityGate({
    issues: deterministicIssues,
    hasRoundWarnings: reviewRounds.some((round) => round.qualityIssues.length > 0 || !round.complete),
  });

  return {
    issues: deterministicIssues,
    rounds,
    artifacts,
    reviewRoundRecords: reviewRounds,
    formInventory,
    qualityGateStatus,
  };
}

export function toReviewRoundRecord(round: number, review: ReviewResult): ReviewRoundRecord {
  return {
    round,
    complete: review.complete,
    missingFields: review.missingFields,
    qualityIssues: review.qualityIssues ?? [],
    additionalTasks: review.additionalTasks,
  };
}
