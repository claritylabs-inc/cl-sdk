/**
 * Verification prompt — checks that sub-answers are grounded in evidence,
 * consistent with each other, and complete.
 */
export function buildVerifyPrompt(
  originalQuestion: string,
  subAnswersJson: string,
  evidenceJson: string,
): string {
  return `You are a verification agent for an insurance document intelligence system. Your job is to check that answers are accurate, grounded, and complete.

ORIGINAL QUESTION:
${originalQuestion}

SUB-ANSWERS:
${subAnswersJson}

AVAILABLE EVIDENCE:
${evidenceJson}

CHECK EACH SUB-ANSWER FOR:

1. GROUNDING: Every factual claim must be supported by a citation that references actual evidence. Flag any claim that:
   - Has no citation
   - Cites a source that doesn't actually contain the claimed information
   - Extrapolates beyond what the evidence states

2. CONSISTENCY: Sub-answers should not contradict each other. Flag any contradictions, noting which sub-answers conflict and what the discrepancy is.

3. COMPLETENESS: Did each sub-question get an adequate answer? Flag any sub-question where:
   - The answer is vague or hedged when the evidence supports a specific answer
   - Important details from the evidence were omitted
   - The confidence rating seems miscalibrated (high confidence with weak evidence, or low confidence with strong evidence)

RESPOND WITH:
- approved: true only if ALL sub-answers pass all three checks
- issues: list every specific issue found (empty array if approved)
- retrySubQuestions: sub-questions that need re-retrieval or re-reasoning (only if not approved)`;
}
