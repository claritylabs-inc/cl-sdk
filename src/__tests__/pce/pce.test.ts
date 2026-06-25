import { describe, expect, it } from "vitest";
import { createPceAgent, selectPceExecutionMode, stablePolicyChangeItemId, validatePceItems } from "../../pce";
import type { GenerateObject } from "../../core/types";
import type { PceEvidenceSource } from "../../schemas/pce";
import { buildPageSourceSpans, MemorySourceStore } from "../../source";

const policyEvidence: PceEvidenceSource = {
  id: "src-policy-1",
  label: "Current policy declarations",
  documentId: "policy-1",
  page: 2,
  fieldPath: "insured.address",
  text: "Named insured mailing address: 10 Old St, Boston, MA 02110.",
};

function strictCitation(overrides: Record<string, unknown>) {
  return {
    sourceId: "src-policy-1",
    quote: "",
    page: null,
    fieldPath: null,
    ...overrides,
  };
}

function strictPceItem(overrides: Record<string, unknown>) {
  return {
    id: null,
    kind: null,
    action: "update",
    affectedPolicyId: null,
    fieldPath: "",
    label: "",
    beforeValue: null,
    afterValue: null,
    requestedValue: null,
    effectiveDate: null,
    reason: null,
    sourceIds: null,
    sourceSpanIds: null,
    userSourceSpanIds: null,
    citations: null,
    confidence: null,
    confidenceScore: null,
    status: null,
    ...overrides,
  };
}

describe("PCE agent", () => {
  it("normalizes change requests with stable IDs and validates quoted evidence", async () => {
    const taskKinds: Array<string | undefined> = [];
    const generateObject: GenerateObject = async ({ schema, taskKind }) => {
      taskKinds.push(taskKind);
      return {
        object: schema.parse({
          summary: "Update mailing address",
          items: [strictPceItem({
            action: "update",
            fieldPath: "insured.address",
            label: "Mailing address",
            beforeValue: "10 Old St, Boston, MA 02110",
            afterValue: "25 New Ave, Boston, MA 02111",
            sourceIds: ["src-policy-1"],
            citations: [strictCitation({
              sourceId: "src-policy-1",
              quote: "10 Old St, Boston, MA 02110",
              page: 2,
              fieldPath: "insured.address",
            })],
            confidence: "high",
            confidenceScore: 0.92,
          })],
          missingInfoQuestions: [],
        }),
        usage: { inputTokens: 10, outputTokens: 20 },
      };
    };

    const agent = createPceAgent({ generateObject, now: () => 1000 });
    const result = await agent.processChangeRequest({
      requestText: "Change mailing address from \"10 Old St, Boston, MA 02110\" to 25 New Ave, Boston, MA 02111.",
      evidenceSources: [policyEvidence],
    });

    expect(result.state.items).toHaveLength(1);
    expect(result.state.impacts).toEqual([
      expect.objectContaining({
        itemId: result.state.items[0]?.id,
        requestedValue: "25 New Ave, Boston, MA 02111",
        sourceSpanIds: ["src-policy-1"],
      }),
    ]);
    expect(result.state.items[0]?.id).toBe(stablePolicyChangeItemId(result.state.items[0]!));
    expect(result.state.executionMode).toBe("deterministic_tree");
    expect(result.state.validationIssues).toEqual([]);
    expect(result.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(taskKinds).toEqual(["pce_impact_analysis"]);
  });

  it("reports blocking validation issues when a beforeValue quote is not in cited evidence", async () => {
    const generateObject: GenerateObject = async ({ schema }) => ({
      object: schema.parse({
        summary: "Update mailing address",
        items: [strictPceItem({
          action: "update",
          fieldPath: "insured.address",
          label: "Mailing address",
          beforeValue: "99 Missing Rd",
          afterValue: "25 New Ave",
          sourceIds: ["src-policy-1"],
          citations: [strictCitation({ sourceId: "src-policy-1", quote: "99 Missing Rd" })],
          confidence: "medium",
          confidenceScore: 0.8,
        })],
        missingInfoQuestions: [],
      }),
    });

    const agent = createPceAgent({ generateObject, now: () => 1000 });
    const result = await agent.processChangeRequest({
      requestText: "Change mailing address from \"99 Missing Rd\" to 25 New Ave.",
      evidenceSources: [policyEvidence],
    });

    expect(result.state.validationIssues).toMatchObject([{
      code: "quote_not_found",
      severity: "blocking",
      fieldPath: "insured.address.beforeValue",
      sourceId: "src-policy-1",
    }]);
    expect(result.state.executionMode).toBe("hybrid");
  });

  it("validates high-risk PCE blockers deterministically", () => {
    const items = [
      {
        id: "coverage-1",
        kind: "coverage_change" as const,
        action: "update" as const,
        affectedPolicyId: "policy-1",
        fieldPath: "coverage.spoilage",
        label: "Spoilage coverage",
        afterValue: "Add spoilage",
        sourceIds: [],
        sourceSpanIds: [],
        userSourceSpanIds: [],
        citations: [],
        confidence: "medium" as const,
        confidenceScore: 0.7,
        status: "ready" as const,
      },
      {
        id: "date-1",
        kind: "limit_change" as const,
        action: "update" as const,
        affectedPolicyId: "policy-1",
        fieldPath: "coverage.limit",
        label: "Limit",
        afterValue: "$2,000,000",
        effectiveDate: "1/1/2028",
        sourceIds: ["period-1"],
        sourceSpanIds: ["period-1"],
        userSourceSpanIds: [],
        citations: [],
        confidence: "medium" as const,
        confidenceScore: 0.7,
        status: "ready" as const,
      },
      {
        id: "cert-1",
        kind: "certificate_endorsement_request" as const,
        action: "add" as const,
        affectedPolicyId: "policy-1",
        fieldPath: "certificate.endorsements",
        label: "Certificate endorsement",
        afterValue: "Need certificate wording",
        sourceIds: [],
        sourceSpanIds: [],
        userSourceSpanIds: [],
        citations: [],
        confidence: "low" as const,
        confidenceScore: 0.3,
        status: "ready" as const,
      },
      {
        id: "cancel-1",
        kind: "cancellation" as const,
        action: "update" as const,
        affectedPolicyId: "policy-1",
        fieldPath: "policy.cancellation",
        label: "Cancellation",
        afterValue: "Cancel policy",
        sourceIds: [],
        sourceSpanIds: [],
        userSourceSpanIds: [],
        citations: [],
        confidence: "medium" as const,
        confidenceScore: 0.7,
        status: "ready" as const,
      },
    ];

    const issues = validatePceItems(items, [{
      id: "period-1",
      label: "Policy period",
      text: "Policy period 1/1/2026 to 1/1/2027.",
      metadata: { policyEffectiveDate: "1/1/2026", policyExpirationDate: "1/1/2027" },
    }]);

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "coverage_source_missing",
      "effective_date_outside_policy_period",
      "certificate_details_missing",
      "notice_rule_ambiguous",
    ]));
  });

  it("honors explicit PCE execution mode overrides", async () => {
    const configAgent = createPceAgent({ executionMode: "market_eval", now: () => 1000 });
    const configured = await configAgent.processChangeRequest({
      requestText: "Update the mailing address to 25 New Ave.",
      evidenceSources: [policyEvidence],
    });

    const inputAgent = createPceAgent({ executionMode: "deterministic_tree", now: () => 1000 });
    const inputOverride = await inputAgent.processChangeRequest({
      requestText: "Update the mailing address to 25 New Ave.",
      executionMode: "hybrid",
      evidenceSources: [policyEvidence],
    });

    expect(configured.state.executionMode).toBe("market_eval");
    expect(inputOverride.state.executionMode).toBe("hybrid");
  });

  it("selects market evaluation for financial changes touching multiple forms", async () => {
    const sources: PceEvidenceSource[] = [
      {
        id: "src-cp-0010",
        label: "CP 00 10",
        documentId: "policy-1",
        fieldPath: "coverage.limit",
        text: "Building limit $1,000,000 applies on form CP 00 10.",
        metadata: { formNumber: "CP 00 10" },
      },
      {
        id: "src-cp-1030",
        label: "CP 10 30",
        documentId: "policy-1",
        fieldPath: "coverage.limit",
        text: "Spoilage extension limit $100,000 applies on form CP 10 30.",
        metadata: { formNumber: "CP 10 30" },
      },
    ];
    const generateObject: GenerateObject = async ({ schema }) => ({
      object: schema.parse({
        summary: "Increase property limits",
        items: [strictPceItem({
          kind: "limit_change",
          action: "update",
          fieldPath: "coverage.limit",
          label: "Property limits",
          afterValue: "$2,000,000",
          sourceIds: ["src-cp-0010", "src-cp-1030"],
          sourceSpanIds: ["src-cp-0010", "src-cp-1030"],
          confidence: "medium",
          confidenceScore: 0.7,
        })],
        missingInfoQuestions: [],
      }),
    });

    const agent = createPceAgent({ generateObject, now: () => 1000 });
    const result = await agent.processChangeRequest({
      requestText: "Increase property limits to $2,000,000.",
      evidenceSources: sources,
    });

    expect(result.state.impacts[0]?.affectedCoverageForms).toEqual(["CP 00 10", "CP 10 30"]);
    expect(result.state.executionMode).toBe("market_eval");
  });

  it("exposes deterministic execution mode selection for conflict and ambiguity gates", () => {
    const conflictMode = selectPceExecutionMode({
      requestText: "Increase limit to $2,000,000.",
      items: [],
      impacts: [],
      validationIssues: [],
      missingInfoQuestions: [],
      evidenceSources: [
        { id: "a", fieldPath: "coverage.limit", text: "Building limit is $1,000,000." },
        { id: "b", fieldPath: "coverage.limit", text: "Building limit is $750,000." },
      ],
    });
    const cancellationMode = selectPceExecutionMode({
      requestText: "Cancel the policy if the insured confirms, or nonrenew if they do not.",
      items: [{
        id: "item-1",
        kind: "cancellation",
        action: "update",
        affectedPolicyId: "policy-1",
        fieldPath: "policy.cancellation",
        label: "Cancellation",
        sourceIds: [],
        sourceSpanIds: [],
        userSourceSpanIds: [],
        citations: [],
        confidence: "medium",
        confidenceScore: 0.6,
        status: "ready",
      }],
      impacts: [],
      validationIssues: [],
      missingInfoQuestions: [],
      evidenceSources: [],
    });

    expect(conflictMode).toBe("hybrid");
    expect(cancellationMode).toBe("hybrid");
  });

  it("creates packet artifacts with citations and validation report", async () => {
    const agent = createPceAgent({ now: () => 1000 });
    const { state } = await agent.processChangeRequest({
      requestText: "Change mailing address from \"10 Old St, Boston, MA 02110\" to 25 New Ave, Boston, MA 02111.",
      evidenceSources: [policyEvidence],
    });

    const packet = agent.generateSubmissionPacket({ state });
    const packetById = agent.generateSubmissionPacket(state.id);

    expect(packet.artifacts.map((artifact) => artifact.kind)).toEqual([
      "underwriter_summary",
      "carrier_email",
      "missing_info_request",
      "json_packet",
      "validation_report",
    ]);
    expect(packetById.caseId).toBe(state.id);
    expect(packet.pceCase.executionMode).toBe("deterministic_tree");
    expect(packet.artifacts.find((artifact) => artifact.kind === "underwriter_summary")?.citations).toMatchObject([{
      sourceId: "src-policy-1",
      quote: "10 Old St, Boston, MA 02110",
    }]);
    expect(packet.artifacts.find((artifact) => artifact.kind === "json_packet")?.content).toContain(state.items[0]!.id);
    expect(packet.artifacts.find((artifact) => artifact.kind === "json_packet")?.content).toContain("impacts");
  });

  it("retrieves source-span evidence before normalizing change requests", async () => {
    const sourceStore = new MemorySourceStore();
    const spans = buildPageSourceSpans([
      {
        documentId: "policy-1",
        sourceKind: "policy_pdf",
        pageNumber: 3,
        text: "Current building limit is $1,000,000 on form CP 00 10.",
        formNumber: "CP 00 10",
      },
    ]);
    await sourceStore.addSourceSpans(spans);

    const agent = createPceAgent({ sourceRetriever: sourceStore, now: () => 1000 });
    const result = await agent.processChangeRequest({
      requestText: "Increase building limit from \"$1,000,000\" to $2,000,000.",
    });

    expect(result.state.evidenceSources.map((source) => source.id)).toContain(spans[0].id);
    expect(result.state.items[0]?.sourceSpanIds).toEqual([spans[0].id]);
    expect(result.state.impacts[0]?.affectedCoverageForms).toEqual(["CP 00 10"]);
    expect(result.state.validationIssues).toEqual([]);
  });

  it("merges reply answers into missing-info questions", async () => {
    const agent = createPceAgent({ now: () => 1000 });
    const { state } = await agent.processChangeRequest({
      requestText: "Update the mailing address.",
      evidenceSources: [],
    });

    expect(state.missingInfoQuestions).toHaveLength(1);

    const reply = await agent.processReply({
      state,
      replyText: "Use 25 New Ave, Boston, MA 02111.",
    });

    expect(reply.answersMerged).toBe(1);
    expect(reply.state.missingInfoQuestions[0]?.answer).toBe("Use 25 New Ave, Boston, MA 02111.");
    expect(reply.state.items[0]).toEqual(expect.objectContaining({
      requestedValue: "Use 25 New Ave, Boston, MA 02111.",
      status: "ready",
    }));
    expect(reply.state.impacts[0]?.requestedValue).toBe("Use 25 New Ave, Boston, MA 02111.");
  });

  it("uses deterministic tie-break inputs for stable policy change IDs", () => {
    const a = stablePolicyChangeItemId({
      kind: "limit_change",
      affectedPolicyId: "policy-1",
      fieldPath: "coverage.limit",
      afterValue: "$2,000,000",
      sourceSpanIds: ["src-policy-1"],
    });
    const b = stablePolicyChangeItemId({
      kind: "limit_change",
      affectedPolicyId: "policy-1",
      fieldPath: "coverage.limit",
      afterValue: "$2,000,000",
      sourceSpanIds: ["src-policy-1"],
    });
    const c = stablePolicyChangeItemId({
      kind: "limit_change",
      affectedPolicyId: "policy-1",
      fieldPath: "coverage.limit",
      afterValue: "$3,000,000",
      sourceSpanIds: ["src-policy-1"],
    });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
