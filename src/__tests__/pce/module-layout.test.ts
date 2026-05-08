import { describe, expect, it } from "vitest";
import { createPceAgent } from "../../pce/coordinator";
import { buildPceSubmissionPacket } from "../../pce/packet";
import { buildPceQualityReport } from "../../pce/quality";
import { collectPceEvidenceSources } from "../../pce/retriever";
import { validatePceItems } from "../../pce/validator";
import { selectPceExecutionMode, stablePolicyChangeItemId } from "../../pce/workflow";

describe("PCE module layout", () => {
  it("exposes coordinator, workflow, retriever, validator, packet, and quality modules", async () => {
    const agent = createPceAgent({ now: () => 1000 });
    const { state } = await agent.processChangeRequest({
      requestText: "Change mailing address from \"10 Old St\" to 25 New Ave.",
      evidenceSources: [{
        id: "source-1",
        label: "Declarations",
        documentId: "policy-1",
        fieldPath: "insured.address",
        text: "Named insured mailing address: 10 Old St.",
      }],
    });

    expect(stablePolicyChangeItemId(state.items[0]!)).toBe(state.items[0]!.id);
    expect(selectPceExecutionMode({
      requestText: state.requestText,
      items: state.items,
      impacts: state.impacts,
      evidenceSources: state.evidenceSources,
      validationIssues: state.validationIssues,
      missingInfoQuestions: state.missingInfoQuestions,
    })).toBe("deterministic_tree");
    expect(await collectPceEvidenceSources({ requestText: state.requestText, evidenceSources: state.evidenceSources })).toHaveLength(1);
    expect(validatePceItems(state.items, state.evidenceSources)).toEqual([]);
    expect(buildPceSubmissionPacket(state, 2000).caseId).toBe(state.id);
    expect(buildPceQualityReport(state)).toMatchObject({ qualityGateStatus: "passed" });
  });

  it("fails PCE quality when existing values are not source grounded", async () => {
    const agent = createPceAgent({ now: () => 1000 });
    const { state } = await agent.processChangeRequest({
      requestText: "Change mailing address from \"10 Old St\" to 25 New Ave.",
      evidenceSources: [],
    });
    const ungroundedState = {
      ...state,
      items: state.items.map((item) => ({ ...item, beforeValue: "10 Old St", sourceSpanIds: [], sourceIds: [] })),
    };

    expect(buildPceQualityReport(ungroundedState)).toMatchObject({
      qualityGateStatus: "failed",
      ungroundedExistingValueCount: 1,
    });
  });
});
