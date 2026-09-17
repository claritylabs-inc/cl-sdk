import {
  decisionJson,
  decisionOptions,
  runDecision,
  type DecisionConfig,
  type DecisionQuestion,
} from "../core/decisions";
import {
  ABSTAIN,
  choiceQuestion,
  sourceValueQuestion,
  taxonomyQuestion,
  verificationQuestions,
} from "../core/decision-questions";
import type {
  DocumentSourceNode,
  PolicyOperationalProfile,
  SourceSpan,
} from "../source";
import {
  ACORD_LOB_LABELS,
  AcordLobCodeSchema,
} from "../schemas/lines-of-business";
import {
  applyOperationalProfileCleanup,
  OPERATIONAL_COVERAGE_TERM_KINDS,
  type OperationalProfileCleanup,
} from "./operational-profile-cleanup";
import type { TokenUsage } from "../core/types";

export interface ExtractionDecisionConfig extends DecisionConfig {
  onDecisionUsage?: (usage?: TokenUsage) => void;
}

/** Select only verbatim candidates; never turn regex matches into operational facts. */
export function sourceValueCandidates(spans: SourceSpan[]) {
  return spans.flatMap((span) =>
    [
      ...span.text.matchAll(
        /\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b|(?:[$£€]\s*)?\d(?:[\d,.]*\d)?(?:\s*(?:%|USD|GBP|EUR|million|thousand))?/g,
      ),
    ].map((match, i) => ({
      id: `${span.id}:${i}`,
      value: match[0],
      sourceSpanIds: [span.id],
      evidence: span.text,
    })),
  );
}

export async function cleanupCoverageDecision(params: {
  sourceTree: DocumentSourceNode[];
  sourceSpans: SourceSpan[];
  operationalProfile: PolicyOperationalProfile;
  decisions: ExtractionDecisionConfig;
  fallback: () => Promise<{
    operationalProfile: PolicyOperationalProfile;
    warnings: string[];
  }>;
}) {
  const {
    operationalProfile: profile,
    sourceTree,
    sourceSpans,
    decisions,
    fallback,
  } = params;
  // Large or incomplete contexts retain the established reasoning pass, without sampling away evidence.
  if (
    !sourceSpans.length ||
    sourceSpans.reduce((n, s) => n + s.text.length, 0) > 180_000
  )
    return fallback();
  const questions: Record<string, DecisionQuestion> = {};
  const values = sourceValueCandidates(sourceSpans);
  const candidateOptions = Object.fromEntries(
    values.map((v, i) => [`v${i}`, decisionJson(v)]),
  );
  const valueFields = [
    "limit",
    "deductible",
    "premium",
    "retroactiveDate",
  ] as const;
  profile.coverages.forEach((coverage, i) => {
    questions[`c${i}_action`] = choiceQuestion(
      {
        question:
          "Should this existing coverage row be kept, dropped as a non-coverage artifact/duplicate, or updated using the offered source candidates? Preserve distinct coverage scopes and endorsement modifications.",
        coverage: decisionJson(coverage),
        coverageIndex: i,
      },
      {
        keep: "Actual source-supported coverage row with correct values and taxonomy",
        drop: "Navigation, header, duplicate of same coverage AND scope, or a financial-only non-coverage artifact",
        update:
          "Actual coverage requiring a correction available among the supplied candidates",
      },
    );
    questions[`c${i}_lob`] = taxonomyQuestion(
      decisionJson({
        name: coverage.name,
        lineOfBusiness: coverage.lineOfBusiness,
      }),
      Object.fromEntries(
        AcordLobCodeSchema.options.map((code) => [
          code,
          ACORD_LOB_LABELS[code],
        ]),
      ),
    );
    for (const field of valueFields) {
      questions[`c${i}_${field}`] = sourceValueQuestion(
        decisionJson({
          coverage: coverage.name,
          field,
          current: coverage[field] ?? null,
        }),
        {
          unchanged: decisionJson({
            value: coverage[field] ?? null,
            meaning: "Current value is supported, or correctly absent",
          }),
          ...candidateOptions,
        },
      );
    }
    coverage.limits.forEach((term, j) => {
      questions[`c${i}_t${j}_kind`] = taxonomyQuestion(
        decisionJson(term),
        Object.fromEntries(
          OPERATIONAL_COVERAGE_TERM_KINDS.map((kind) => [
            kind,
            kind.replace(/_/g, " "),
          ]),
        ),
      );
      questions[`c${i}_t${j}_action`] = choiceQuestion(
        {
          question:
            "Should this existing term be retained or dropped? Only drop a duplicate within identical scope or an artifact, never an unresolved or conflicting term.",
          term: decisionJson(term),
        },
        {
          keep: "Source-backed distinct term",
          drop: "Exact same-scope duplicate or navigational artifact",
        },
      );
    });
    // Verification uses the complete source context, including other endorsements.
    for (const [key, q] of Object.entries(
      verificationQuestions(decisionJson({ coverageIndex: i, coverage })),
    ))
      questions[`c${i}_${key}`] = q;
  });
  if (Object.keys(questions).length > 128) return fallback();
  return runDecision({
    ...decisionOptions(decisions),
    family: "extraction.cleanup",
    state: decisionJson({ profile, sourceSpans, sourceTree }),
    questions,
    requiredQuestionIds: (answers) =>
      Object.keys(questions).filter((id) => {
        const prefix = id.split("_")[0];
        const action = answers[`${prefix}_action`];
        if (/_t\d+_kind$/.test(id)) {
          const termAction = answers[id.replace(/_kind$/, "_action")];
          if (termAction.type === "choice" && termAction.choice === "drop")
            return false;
        }
        return (
          action.type !== "choice" ||
          action.choice !== "drop" ||
          ["action", "supported", "contradiction", "missing"].some(
            (key) => id === `${prefix}_${key}`,
          )
        );
      }),
    accept: (answers) => {
      const cleanup: OperationalProfileCleanup = {
        coverageDecisions: [],
        warnings: [],
      };
      for (const [i, coverage] of profile.coverages.entries()) {
        const action = answers[`c${i}_action`];
        if (
          action.type !== "choice" ||
          !["keep", "drop", "update"].includes(action.choice)
        )
          return;
        // Contradiction/missing evidence always escalates; unsupported rows may only be dropped after explicit artifact judgment.
        for (const kind of ["contradiction", "missing"] as const) {
          const a = answers[`c${i}_${kind}`];
          if (a.type !== "noul" || a.noul > 0.5) return;
        }
        const support = answers[`c${i}_supported`];
        if (
          support.type !== "noul" ||
          (support.noul < 0.5 && action.choice !== "drop")
        )
          return;
        const decision: OperationalProfileCleanup["coverageDecisions"][number] =
          {
            coverageIndex: i,
            action: action.choice as "keep" | "drop" | "update",
          };
        if (decision.action === "drop") {
          cleanup.coverageDecisions.push(decision);
          continue;
        }
        let changed = false;
        const lob = answers[`c${i}_lob`];
        if (
          lob.type !== "choice" ||
          lob.choice === ABSTAIN ||
          lob.choice === "UN"
        )
          return;
        if (lob.choice !== coverage.lineOfBusiness) {
          changed = true;
          decision.lineOfBusiness = lob.choice;
          decision.action = "update";
        }
        for (const field of valueFields) {
          const a = answers[`c${i}_${field}`];
          if (a.type !== "choice" || a.choice === ABSTAIN) return;
          if (a.choice === "unchanged") continue;
          const candidate = values.find((_, j) => a.choice === `v${j}`);
          if (!candidate) return;
          changed ||= candidate.value !== coverage[field];
          decision[field] = candidate.value;
          decision.sourceSpanIds = [
            ...new Set([
              ...(decision.sourceSpanIds ?? coverage.sourceSpanIds),
              ...candidate.sourceSpanIds,
            ]),
          ];
          decision.action = "update";
        }
        decision.termDecisions = [];
        for (const [j, term] of coverage.limits.entries()) {
          const termAction = answers[`c${i}_t${j}_action`];
          if (
            termAction.type !== "choice" ||
            !["keep", "drop"].includes(termAction.choice)
          )
            return;
          if (termAction.choice === "drop") {
            decision.termDecisions.push({ termIndex: j, action: "drop" });
            changed = true;
            decision.action = "update";
            continue;
          }
          const kind = answers[`c${i}_t${j}_kind`];
          if (kind.type !== "choice" || kind.choice === ABSTAIN) return;
          const parsedKind = OPERATIONAL_COVERAGE_TERM_KINDS.find(
            (k) => k === kind.choice,
          );
          if (!parsedKind) return;
          decision.termDecisions.push({
            termIndex: j,
            action: parsedKind !== term.kind ? "update" : "keep",
            kind: parsedKind,
          });
          if (parsedKind !== term.kind) {
            changed = true;
            decision.action = "update";
          }
        }
        if (action.choice === "update" && !changed) return;
        cleanup.coverageDecisions.push(decision);
      }
      return {
        operationalProfile: applyOperationalProfileCleanup(
          profile,
          cleanup,
          new Set(sourceTree.map((n) => n.id)),
          new Set(sourceSpans.map((s) => s.id)),
        ),
        warnings: [],
      };
    },
    fallback,
    onUsage: decisions.onDecisionUsage,
  });
}
