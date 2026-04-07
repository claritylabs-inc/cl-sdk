import { PolicyDocument, QuoteDocument } from "../types/document";
import { AgentContext, CommunicationIntent } from "../types/platform";
import { buildAgentSystemPrompt } from "./agent/index";

/**
 * @deprecated Use `buildAgentSystemPrompt` from `prompts/agent/index` instead.
 * Maps legacy mode strings to the new platform/intent API.
 */
export function buildSystemPrompt(
  mode: "direct" | "cc" | "forward",
  companyContext: string | undefined,
  siteUrl: string,
  companyName?: string,
  userName?: string,
  coiHandling?: "broker" | "user" | "member" | "ignore",
  brokerName?: string,
  brokerContactName?: string,
  brokerContactEmail?: string,
): string {
  const intentMap: Record<string, CommunicationIntent> = {
    direct: "direct",
    cc: "observed",
    forward: "mediated",
  };

  const ctx: AgentContext = {
    platform: "email",
    intent: intentMap[mode],
    companyName,
    companyContext,
    siteUrl,
    userName,
    coiHandling,
    brokerName,
    brokerContactName,
    brokerContactEmail,
  };

  return buildAgentSystemPrompt(ctx);
}

/** @deprecated Use buildDocumentContext instead */
export function buildPolicyContext(
  policies: PolicyDocument[],
  queryText: string,
): { context: string; relevantPolicyIds: string[] } {
  const result = buildDocumentContext(policies, [], queryText);
  return { context: result.context, relevantPolicyIds: result.relevantPolicyIds };
}

export function buildDocumentContext(
  policies: PolicyDocument[],
  quotes: QuoteDocument[],
  queryText: string,
): { context: string; relevantPolicyIds: string[]; relevantQuoteIds: string[] } {
  if (policies.length === 0 && quotes.length === 0) {
    return {
      context: "NO POLICIES OR QUOTES FOUND. The user has not imported any insurance documents yet.",
      relevantPolicyIds: [],
      relevantQuoteIds: [],
    };
  }

  const queryLower = queryText.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

  // Build policy index
  const policyIndexLines = policies.map((p, i) => {
    const types = p.policyTypes?.join(", ") ?? "unknown";
    const carrier = p.security || p.carrier;
    const coverageSummary = p.coverages
      .slice(0, 5)
      .map((c) => `${c.name}: ${c.limit}`)
      .join("; ");
    const sectionTitles = p.sections
      ?.map((s) => s.title)
      .join(", ") ?? "none";
    const termEnd = p.expirationDate ?? (p.nextReviewDate ? `review ${p.nextReviewDate}` : "continuous");
    return `[${i + 1}] ID:${p.id} | ${carrier} | #${p.policyNumber} | Types: ${types} | ${p.effectiveDate} to ${termEnd} | Insured: ${p.insuredName} | Premium: ${p.premium ?? "N/A"} | Coverages: ${coverageSummary} | Sections: ${sectionTitles}`;
  });

  // Build quote index
  const quoteIndexLines = quotes.map((q, i) => {
    const types = q.policyTypes?.join(", ") ?? "unknown";
    const carrier = q.security || q.carrier;
    const coverageSummary = q.coverages
      .slice(0, 5)
      .map((c) => `${c.name}: ${c.limit}`)
      .join("; ");
    const expiry = q.quoteExpirationDate ? ` | Quote expires: ${q.quoteExpirationDate}` : "";
    return `[Q${i + 1}] ID:${q.id} | ${carrier} | #${q.quoteNumber} | Types: ${types} | Proposed: ${q.proposedEffectiveDate ?? "N/A"} to ${q.proposedExpirationDate ?? "N/A"}${expiry} | Insured: ${q.insuredName} | Premium: ${q.premium ?? "N/A"} | Coverages: ${coverageSummary}`;
  });

  // Score policies
  const scoredPolicies = policies.map((p) => {
    let score = 0;
    const searchText = [
      p.carrier, p.security, p.policyNumber, p.insuredName,
      ...(p.policyTypes ?? []),
      ...p.coverages.map((c) => c.name), p.summary,
      ...(p.sections?.map((s) => s.title) ?? []),
    ].filter(Boolean).join(" ").toLowerCase();
    for (const word of queryWords) {
      if (searchText.includes(word)) score++;
    }
    return { policy: p, score };
  });

  // Score quotes
  const scoredQuotes = quotes.map((q) => {
    let score = 0;
    const searchText = [
      q.carrier, q.security, q.quoteNumber, q.insuredName,
      ...(q.policyTypes ?? []),
      ...q.coverages.map((c) => c.name), q.summary,
      ...(q.subjectivities?.map((s) => s.description) ?? []),
    ].filter(Boolean).join(" ").toLowerCase();
    for (const word of queryWords) {
      if (searchText.includes(word)) score++;
    }
    // Boost if query mentions quote/proposal
    if (queryLower.includes("quote") || queryLower.includes("proposal") || queryLower.includes("indication")) {
      score += 3;
    }
    return { quote: q, score };
  });

  // Select relevant policies
  const relevantPolicies = scoredPolicies
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const policiesToExpand = relevantPolicies.length > 0
    ? relevantPolicies.map((r) => r.policy)
    : policies.slice(0, 5);
  const relevantPolicyIds = policiesToExpand.map((p) => p.id);

  // Select relevant quotes
  const relevantQuotes = scoredQuotes
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const quotesToExpand = relevantQuotes.length > 0
    ? relevantQuotes.map((r) => r.quote)
    : quotes.slice(0, 3);
  const relevantQuoteIds = quotesToExpand.map((q) => q.id);

  // Expand policy sections
  const expandedPolicySections = policiesToExpand.map((p) => {
    const carrier = p.security || p.carrier;
    let sections = `\n--- POLICY: ${carrier} #${p.policyNumber} (ID:${p.id}) ---`;
    if (p.summary) sections += `\nSummary: ${p.summary}`;
    if (p.coverages.length > 0) {
      sections += `\n\nCoverages:`;
      for (const c of p.coverages) {
        sections += `\n  - ${c.name}: Limit ${c.limit}${c.deductible ? `, Deductible ${c.deductible}` : ""}${c.pageNumber ? ` (p.${c.pageNumber})` : ""}`;
      }
    }
    if (p.sections) {
      const relevantSections = p.sections.filter((s) => {
        const sectionText = (s.title + " " + s.content).toLowerCase();
        return queryWords.some((w) => sectionText.includes(w));
      });
      const sectionsToInclude = relevantSections.length > 0
        ? relevantSections
        : p.sections.slice(0, 3);
      for (const s of sectionsToInclude) {
        sections += `\n\n## ${s.title}${s.sectionNumber ? ` (${s.sectionNumber})` : ""} [pages ${s.pageStart}${s.pageEnd ? `-${s.pageEnd}` : ""}] (${s.type})`;
        const content = s.content.length > 3000
          ? s.content.slice(0, 3000) + "\n... [truncated]"
          : s.content;
        sections += `\n${content}`;
      }
    }
    return sections;
  });

  // Expand quote sections
  const expandedQuoteSections = quotesToExpand.map((q) => {
    const carrier = q.security || q.carrier;
    let sections = `\n--- QUOTE: ${carrier} #${q.quoteNumber} (ID:${q.id}) ---`;
    if (q.summary) sections += `\nSummary: ${q.summary}`;
    if (q.quoteExpirationDate) sections += `\nQuote expires: ${q.quoteExpirationDate}`;
    if (q.premium) sections += `\nProposed premium: ${q.premium}`;
    if (q.coverages.length > 0) {
      sections += `\n\nProposed Coverages:`;
      for (const c of q.coverages) {
        sections += `\n  - ${c.name}: Proposed Limit ${c.limit}${c.deductible ? `, Proposed Deductible ${c.deductible}` : ""}`;
      }
    }
    if (q.subjectivities && q.subjectivities.length > 0) {
      sections += `\n\nSubjectivities:`;
      for (const s of q.subjectivities) {
        sections += `\n  - ${s.description}${s.category ? ` (${s.category})` : ""}`;
      }
    }
    if (q.underwritingConditions && q.underwritingConditions.length > 0) {
      sections += `\n\nUnderwriting Conditions:`;
      for (const uc of q.underwritingConditions) {
        sections += `\n  - ${uc.description}`;
      }
    }
    if (q.premiumBreakdown && q.premiumBreakdown.length > 0) {
      sections += `\n\nPremium Breakdown:`;
      for (const pb of q.premiumBreakdown) {
        sections += `\n  - ${pb.line}: ${pb.amount}`;
      }
    }
    return sections;
  });

  const parts: string[] = [];

  if (policies.length > 0) {
    parts.push(`POLICY INDEX (${policies.length} bound policies):\n${policyIndexLines.join("\n")}`);
  }
  if (quotes.length > 0) {
    parts.push(`QUOTE INDEX (${quotes.length} quotes/proposals):\n${quoteIndexLines.join("\n")}`);
  }
  if (expandedPolicySections.length > 0) {
    parts.push(`DETAILED POLICY DATA:\n${expandedPolicySections.join("\n")}`);
  }
  if (expandedQuoteSections.length > 0) {
    parts.push(`DETAILED QUOTE DATA:\n${expandedQuoteSections.join("\n")}`);
  }

  return {
    context: parts.join("\n\n"),
    relevantPolicyIds,
    relevantQuoteIds,
  };
}

interface PastConversation {
  fromName?: string;
  fromEmail: string;
  subject: string;
  body: string;
  responseBody: string;
  _creationTime: number;
  threadId?: string;
}

export function buildConversationMemoryContext(
  conversations: PastConversation[],
): string {
  if (conversations.length === 0) return "";

  const MAX_MEMORY_CHARS = 3000;
  let total = 0;
  const entries: string[] = [];

  for (let i = 0; i < conversations.length; i++) {
    const c = conversations[i];
    const date = new Date(c._creationTime).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const who = c.fromName
      ? `${c.fromName} (${c.fromEmail})`
      : c.fromEmail;
    const q = c.body.slice(0, 200).replace(/\n+/g, " ");
    const a = c.responseBody.slice(0, 300).replace(/\n+/g, " ");

    const entry = `[${i + 1}] "${c.subject}" -- Asked by ${who} on ${date}\nQ: ${q}\nA: ${a}`;

    if (total + entry.length > MAX_MEMORY_CHARS) break;
    entries.push(entry);
    total += entry.length;
  }

  if (entries.length === 0) return "";

  return `\n\nCONVERSATION MEMORY (past conversations from this organization):\n${entries.join("\n\n")}`;
}
