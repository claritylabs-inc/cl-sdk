import { describe, expect, it } from "vitest";
import {
  applyApplicationAnswers,
  buildApplicationPacket,
  createApplicationRun,
  extractQuestionGraphFromFields,
  getActiveApplicationFields,
  planNextApplicationQuestions,
  proposeContextWrites,
  validateApplicationPacket,
} from "../../index";
import type { ApplicationTemplate } from "../../schemas/application";

describe("application intake helpers", () => {
  it("projects flat fields into a versioned graph and filters inactive conditionals", () => {
    const graph = extractQuestionGraphFromFields(
      [
        {
          id: "has_losses",
          label: "Any losses?",
          section: "Loss History",
          fieldType: "yes_no",
          required: true,
        },
        {
          id: "loss_details",
          label: "Loss details",
          section: "Loss History",
          fieldType: "text",
          required: true,
          condition: { dependsOn: "has_losses", whenValue: "yes" },
        },
      ],
      { id: "graph-1", title: "GL App" },
    );
    const template: ApplicationTemplate = {
      id: "template-1",
      version: "2026-06-18",
      title: "GL App",
      applicationType: "general_liability",
      questionGraph: graph,
    };

    const run = createApplicationRun({ applicationId: "app-1", template, now: 1000 });
    expect(run.questionGraph?.version).toBe("v1");
    expect(planNextApplicationQuestions(run).fieldIds).toEqual(["has_losses"]);

    const noLosses = applyApplicationAnswers(run, [{ fieldId: "has_losses", value: "no" }], 2000);
    expect(getActiveApplicationFields(noLosses).map((field) => field.id)).toEqual(["has_losses"]);
    expect(planNextApplicationQuestions(noLosses).status).toBe("complete");

    const hasLosses = applyApplicationAnswers(run, [{ fieldId: "has_losses", value: "yes" }], 2000);
    expect(planNextApplicationQuestions(hasLosses).fieldIds).toEqual(["loss_details"]);
  });

  it("builds context proposals and blocks packets with required missing fields", () => {
    const graph = extractQuestionGraphFromFields(
      [
        {
          id: "applicant_name",
          label: "Applicant Name",
          section: "General",
          fieldType: "text",
          required: true,
        },
        {
          id: "fein",
          label: "FEIN",
          section: "General",
          fieldType: "text",
          required: true,
        },
      ],
      { id: "graph-2", title: "Package App" },
    );
    const run = applyApplicationAnswers(
      createApplicationRun({
        applicationId: "app-2",
        now: 1000,
        template: {
          id: "template-2",
          version: "1",
          title: "Package App",
          questionGraph: graph,
        },
      }),
      [{
        fieldId: "applicant_name",
        value: "Acme LLC",
        source: "user",
        userSourceSpanIds: ["reply-1:span"],
      }],
      2000,
    );

    expect(proposeContextWrites(run)).toEqual([
      expect.objectContaining({
        fieldId: "applicant_name",
        key: "general_applicant_name",
        value: "Acme LLC",
      }),
    ]);

    const packet = buildApplicationPacket(run, { now: 3000 });
    expect(packet.status).toBe("draft");
    expect(packet.missingFieldIds).toEqual(["fein"]);
    expect(validateApplicationPacket(packet).qualityGateStatus).toBe("failed");
  });
});
