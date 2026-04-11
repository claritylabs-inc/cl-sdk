import type { ZodSchema } from "zod";

import { buildCarrierInfoPrompt, CarrierInfoSchema } from "./carrier-info";
import { buildNamedInsuredPrompt, NamedInsuredSchema } from "./named-insured";
import { buildCoverageLimitsPrompt, CoverageLimitsSchema } from "./coverage-limits";
import { buildEndorsementsPrompt, EndorsementsSchema } from "./endorsements";
import { buildExclusionsPrompt, ExclusionsSchema } from "./exclusions";
import { buildConditionsPrompt, ConditionsSchema } from "./conditions";
import { buildPremiumBreakdownPrompt, PremiumBreakdownSchema } from "./premium-breakdown";
import { buildDeclarationsPrompt, DeclarationsExtractSchema } from "./declarations";
import { buildLossHistoryPrompt, LossHistorySchema } from "./loss-history";
import { buildSectionsPrompt, SectionsSchema } from "./sections";
import { buildSupplementaryPrompt, SupplementarySchema } from "./supplementary";

export interface ExtractorDef {
  buildPrompt: () => string;
  schema: ZodSchema;
  maxTokens?: number;
}

const EXTRACTORS: Record<string, ExtractorDef> = {
  carrier_info: { buildPrompt: buildCarrierInfoPrompt, schema: CarrierInfoSchema, maxTokens: 2048 },
  named_insured: { buildPrompt: buildNamedInsuredPrompt, schema: NamedInsuredSchema, maxTokens: 2048 },
  coverage_limits: { buildPrompt: buildCoverageLimitsPrompt, schema: CoverageLimitsSchema, maxTokens: 8192 },
  endorsements: { buildPrompt: buildEndorsementsPrompt, schema: EndorsementsSchema, maxTokens: 8192 },
  exclusions: { buildPrompt: buildExclusionsPrompt, schema: ExclusionsSchema, maxTokens: 4096 },
  conditions: { buildPrompt: buildConditionsPrompt, schema: ConditionsSchema, maxTokens: 4096 },
  premium_breakdown: { buildPrompt: buildPremiumBreakdownPrompt, schema: PremiumBreakdownSchema, maxTokens: 4096 },
  declarations: { buildPrompt: buildDeclarationsPrompt, schema: DeclarationsExtractSchema, maxTokens: 8192 },
  loss_history: { buildPrompt: buildLossHistoryPrompt, schema: LossHistorySchema, maxTokens: 4096 },
  sections: { buildPrompt: buildSectionsPrompt, schema: SectionsSchema, maxTokens: 8192 },
  supplementary: { buildPrompt: buildSupplementaryPrompt, schema: SupplementarySchema, maxTokens: 2048 },
};

export function getExtractor(name: string): ExtractorDef | undefined {
  return EXTRACTORS[name];
}

export * from "./carrier-info";
export * from "./named-insured";
export * from "./coverage-limits";
export * from "./endorsements";
export * from "./exclusions";
export * from "./conditions";
export * from "./premium-breakdown";
export * from "./declarations";
export * from "./loss-history";
export * from "./sections";
export * from "./supplementary";
