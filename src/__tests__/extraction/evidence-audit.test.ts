import { describe, it, expect, vi } from "vitest";
import {
  auditExtractionEvidence,
  parseExtractionEvidenceAudit,
  validateExtractionAuditBinding,
} from "../../extraction/evidence-audit";
import {
  buildSourceSpan,
  buildDocumentSourceTree,
  PolicyOperationalProfileSchema,
} from "../../source";
import { decisionTestConfig } from "../fixtures/decision-test-helpers";
import type { DecisionInput } from "../../core/decisions";

function fixture(
  text = "Policy ABC. Named insured Acme. CGL occurrence limit $1,000,000. Deductible $500.",
) {
  const sourceSpans = [
    buildSourceSpan(
      {
        documentId: "d",
        sourceKind: "policy_pdf",
        text,
        pageStart: 1,
        pageEnd: 1,
      },
      0,
    ),
  ];
  const profile = PolicyOperationalProfileSchema.parse({
    policyNumber: { value: "ABC", sourceSpanIds: [sourceSpans[0].id] },
    namedInsured: { value: "Acme", sourceSpanIds: [sourceSpans[0].id] },
    sourceSpanIds: [sourceSpans[0].id],
  });
  return {
    profile,
    sourceSpans,
    sourceTree: buildDocumentSourceTree(sourceSpans, "d"),
  };
}
const supported = (id: string) =>
  id.endsWith("category")
    ? "supported_class"
    : id.endsWith("supported") || id.endsWith("context")
      ? 1
      : 0;
const active = () => decisionTestConfig("extraction.audit", supported);

describe("bidirectional extraction evidence audit", () => {
  it("batches multiple atomic fields and source units in one request with exact snapshot binding", async () => {
    const binding = fixture();
    const config = active();
    const decide = vi.fn(config.decide!);
    const result = await auditExtractionEvidence({
      ...binding,
      decisions: { ...config, decide },
    });
    expect(result.audit.status).toBe("verified_text");
    expect(decide).toHaveBeenCalledOnce();
    const request = decide.mock.calls[0][0];
    expect(
      Object.keys(request.questions).filter((id) => id.startsWith("f")).length,
    ).toBeGreaterThan(3);
    expect(
      Object.keys(request.questions).some((id) => id.startsWith("s")),
    ).toBe(true);
    expect(result.audit.forward.verified).toBe(result.audit.forward.total);
    expect(result.audit.reverse.verified).toBe(1);
    expect(result.audit.visualCompleteness).toBe("not_assessed");
    expect(result.audit.acceptanceThreshold).toBe(0.99);
    expect(parseExtractionEvidenceAudit(result.audit, binding)).toEqual(
      result.audit,
    );
    expect(() =>
      validateExtractionAuditBinding(result.audit, {
        ...binding,
        profile: {
          ...binding.profile,
          policyNumber: { ...binding.profile.policyNumber!, value: "changed" },
        },
      }),
    ).toThrow();
  });

  it("ignores uncertainty only on unused speculative source branches", async () => {
    const binding = fixture();
    const config = decisionTestConfig("extraction.audit", (id) =>
      id === "s0_category"
        ? "non_fact"
        : id.startsWith("s")
          ? 0.5
          : supported(id),
    );
    const repair = vi.fn();
    const result = await auditExtractionEvidence({
      ...binding,
      decisions: config,
      repair,
    });
    expect(result.audit.status).toBe("verified_text");
    expect(repair).not.toHaveBeenCalled();
  });

  it("repairs consumed uncertainty once, reaudits the new snapshot, and remains unresolved on failure", async () => {
    const binding = fixture();
    const config = decisionTestConfig("extraction.audit", (id) =>
      id === "s0_omitted" ? 0.5 : supported(id),
    );
    const decide = vi.fn(config.decide!);
    const repair = vi.fn(async () => ({
      profile: {
        ...binding.profile,
        namedInsured: { ...binding.profile.namedInsured!, value: "Acme Corp" },
      },
    }));
    const result = await auditExtractionEvidence({
      ...binding,
      decisions: { ...config, decide },
      repair,
    });
    expect(result.audit.status).toBe("unresolved");
    expect(repair).toHaveBeenCalledOnce();
    expect(decide).toHaveBeenCalledTimes(2);
    expect(result.audit.repairRounds).toBe(1);
    expect(
      (decide.mock.calls[1][0].state as { resultFingerprint: string })
        .resultFingerprint,
    ).not.toBe(
      (decide.mock.calls[0][0].state as { resultFingerprint: string })
        .resultFingerprint,
    );
    validateExtractionAuditBinding(result.audit, {
      ...binding,
      profile: result.profile,
    });
  });

  it("reports oversized source units without truncating or certifying them", async () => {
    const binding = fixture("Long source " + "X".repeat(70_000));
    const config = active();
    const decide = vi.fn(config.decide!);
    const result = await auditExtractionEvidence({
      ...binding,
      decisions: { ...config, decide },
      options: { maxRepairRounds: 0 },
    });
    expect(result.audit.status).toBe("unresolved");
    expect(result.audit.reverse.verified).toBe(0);
    expect(
      result.audit.issues.some((issue) => issue.code === "oversized_context"),
    ).toBe(true);
    expect(decide).not.toHaveBeenCalled();
  });

  it("keeps normalization gaps sticky and rejects omission of the original input binding", async () => {
    const binding = fixture();
    const originalSourceSpans = [
      ...binding.sourceSpans,
      {
        ...binding.sourceSpans[0],
        id: "image",
        kind: "pdf_image" as const,
        text: "",
      },
    ];
    const full = { ...binding, originalSourceSpans };
    const result = await auditExtractionEvidence({
      ...full,
      decisions: active(),
      options: { maxRepairRounds: 0 },
    });
    expect(result.audit.status).toBe("unresolved");
    expect(result.audit.unrepresentedInputUnits).toBe(1);
    expect(result.audit.reverse.total).toBe(2);
    expect(() =>
      validateExtractionAuditBinding(result.audit, binding),
    ).toThrow();
    validateExtractionAuditBinding(result.audit, full);
  });

  it("does not invoke reasoning repair in shadow and cannot claim verification", async () => {
    const binding = fixture();
    const config = active();
    config.decisionPolicy!.families!["extraction.audit"].mode = "shadow";
    const repair = vi.fn();
    const result = await auditExtractionEvidence({
      ...binding,
      decisions: config,
      repair,
    });
    expect(result.profile).toBe(binding.profile);
    expect(result.audit.status).toBe("shadow");
    expect(result.audit.forward.verified).toBe(0);
    expect(repair).not.toHaveBeenCalled();
  });
});
