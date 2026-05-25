import { describe, expect, it, vi } from "vitest";
import { formatDocumentContent } from "../../extraction/formatter";
import type { GenerateText } from "../../core/types";
import type { PolicyDocument } from "../../schemas/document";

function createPolicyDoc(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return {
    id: "pol-1",
    type: "policy",
    carrier: "Acme Insurance",
    insuredName: "Test Corp",
    policyNumber: "POL-001",
    effectiveDate: "01/01/2026",
    coverages: [],
    ...overrides,
  };
}

describe("formatDocumentContent", () => {
  it("skips generateText and returns the original document for plain content", async () => {
    const doc = createPolicyDoc({
      summary: "This is straightforward policy summary prose that does not need markdown cleanup.",
      sections: [
        {
          title: "General Terms",
          pageStart: 1,
          type: "terms",
          content: "Coverage applies to eligible losses during the policy period.",
        },
      ],
    });
    const generateText = vi.fn<GenerateText>();

    const result = await formatDocumentContent(doc, generateText);

    expect(generateText).not.toHaveBeenCalled();
    expect(result.document).toBe(doc);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(result.document.summary).toBe(doc.summary);
  });

  it("formats only entries with markdown cleanup signals and tracks usage", async () => {
    const doc = createPolicyDoc({
      summary: "This plain summary should not be sent to the formatting model.",
      sections: [
        {
          title: "Coverage Schedule",
          pageStart: 1,
          type: "schedule",
          content: "COVERAGE | LIMIT | DEDUCTIBLE\nEmployee Theft | $10,000 | $1,000",
        },
      ],
    });
    const generateText = vi.fn<GenerateText>().mockResolvedValue({
      text: "===ENTRY 1===\n| COVERAGE | LIMIT | DEDUCTIBLE |\n| --- | --- | --- |\n| Employee Theft | $10,000 | $1,000 |",
      usage: { inputTokens: 42, outputTokens: 24 },
    });

    const result = await formatDocumentContent(doc, generateText);

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0][0].prompt).not.toContain("This plain summary");
    expect(generateText.mock.calls[0][0].prompt).toContain("===ENTRY 1===");
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 24 });
    expect(result.document.sections?.[0].content).toBe(
      "| COVERAGE | LIMIT | DEDUCTIBLE |\n| --- | --- | --- |\n| Employee Theft | $10,000 | $1,000 |",
    );
  });

  it("does not format source-backed section or endorsement content", async () => {
    const doc = createPolicyDoc({
      sections: [
        {
          title: "Coverage Schedule",
          pageStart: 1,
          type: "schedule",
          content: "COVERAGE | LIMIT\nEmployee Theft | $10,000",
          sourceSpanIds: ["span-section"],
        },
      ],
      endorsements: [
        {
          title: "Additional Insured",
          formNumber: "CG2010",
          endorsementType: "additional_insured",
          content: "FORM | TERMS\nCG2010 | Additional insured wording",
          pageStart: 2,
          sourceSpanIds: ["span-endorsement"],
        },
      ],
    });
    const generateText = vi.fn<GenerateText>();

    const result = await formatDocumentContent(doc, generateText);

    expect(generateText).not.toHaveBeenCalled();
    expect(result.document.sections?.[0].content).toBe("COVERAGE | LIMIT\nEmployee Theft | $10,000");
    expect(result.document.endorsements?.[0].content).toBe("FORM | TERMS\nCG2010 | Additional insured wording");
  });

  it("formats batches in parallel up to the configured concurrency", async () => {
    const doc = createPolicyDoc({
      sections: Array.from({ length: 41 }, (_, index) => ({
        title: `Schedule ${index}`,
        pageStart: index + 1,
        type: "schedule",
        content: `COVERAGE | LIMIT | DEDUCTIBLE\nCoverage ${index} | $10,000 | $1,000`,
      })),
    });
    let active = 0;
    let maxActive = 0;
    const generateText = vi.fn<GenerateText>().mockImplementation(async ({ prompt }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;

      const ids = [...prompt.matchAll(/===ENTRY (\d+)===/g)].map((match) => Number(match[1]));
      return {
        text: ids.map((id) => `===ENTRY ${id}===\nformatted ${id}`).join("\n"),
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });

    const result = await formatDocumentContent(doc, generateText, { concurrency: 3 });

    expect(generateText).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(3);
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 3 });
    expect(result.document.sections?.[40].content).toBe("formatted 40");
  });
});
