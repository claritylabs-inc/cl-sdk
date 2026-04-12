# CL-SDK v6 Agentic Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor cl-sdk from a fixed 4-pass extraction pipeline with Vercel AI SDK dependency into a provider-agnostic, agentic extraction system with Zod schemas, chunking, and storage abstractions.

**Architecture:** Replace `LanguageModel` + `generateText` from the `ai` package with plain callback types (`GenerateText`, `GenerateObject`). Convert all TypeScript interfaces to Zod schemas (types derived via `z.infer`). Replace the monolithic pipeline.ts with a coordinator/worker extraction architecture. Add `DocumentStore` and `MemoryStore` interfaces with a SQLite reference implementation.

**Tech Stack:** TypeScript, Zod, pdf-lib, better-sqlite3 (optional peer dep)

**Spec:** `docs/superpowers/specs/2026-04-11-v6-agentic-refactor-design.md`

---

## File Structure Overview

```
src/
  core/
    types.ts               # GenerateText, GenerateObject, EmbedText, TokenUsage, LogFn
    retry.ts               # withRetry + isRateLimitError
    concurrency.ts         # pLimit
    strip-fences.ts        # stripFences
    sanitize.ts            # sanitizeNulls

  schemas/
    enums.ts               # All enums as Zod enums (derived from current types/enums.ts)
    shared.ts              # Address, Contact, FormReference, etc. as Zod schemas
    coverage.ts            # Coverage, EnrichedCoverage schemas
    endorsement.ts         # Endorsement, EndorsementParty schemas
    exclusion.ts           # Exclusion schema
    condition.ts           # PolicyCondition schema
    parties.ts             # InsurerInfo, ProducerInfo schemas
    financial.ts           # PaymentPlan, PaymentInstallment, LocationPremium schemas
    loss-history.ts        # LossSummary, ClaimRecord, ExperienceMod schemas
    underwriting.ts        # EnrichedSubjectivity, EnrichedUnderwritingCondition, BindingAuthority
    declarations/
      shared.ts            # DwellingDetails, DriverRecord, PersonalVehicleDetails schemas
      personal.ts          # 14 personal line declaration schemas
      commercial.ts        # 9 commercial line declaration schemas
      index.ts             # DeclarationsSchema discriminated union
    document.ts            # BaseDocument, PolicyDocument, QuoteDocument, InsuranceDocument schemas
    platform.ts            # Platform, AgentContext, PlatformConfig schemas
    context-keys.ts        # ContextKeyMapping + CONTEXT_KEY_MAP (unchanged logic)

  extraction/
    coordinator.ts         # Agentic extraction loop
    extractor.ts           # Base extractor runner
    assembler.ts           # Assemble extraction memory into validated documents
    chunking.ts            # chunkDocument() + DocumentChunk type
    pdf.ts                 # PDF operations (unchanged from v5)

  prompts/
    extractors/
      carrier-info.ts      # Carrier extraction prompt + schema
      named-insured.ts     # Named insured prompt + schema
      coverage-limits.ts   # Coverage limits prompt + schema
      endorsements.ts      # Endorsements prompt + schema
      exclusions.ts        # Exclusions prompt + schema
      conditions.ts        # Conditions prompt + schema
      premium-breakdown.ts # Premium prompt + schema
      declarations.ts      # Declarations prompt + schema (dispatches by policy type)
      loss-history.ts      # Loss history prompt + schema
      sections.ts          # Raw section content prompt + schema
      supplementary.ts     # Regulatory context, contacts prompt + schema
    coordinator/
      classify.ts          # Document classification prompt + schema
      plan.ts              # Page mapping + extraction planning prompt + schema
      review.ts            # Gap-checking prompt + schema
    templates/
      index.ts             # Template registry + DocumentTemplate type
      homeowners.ts
      personal-auto.ts
      dwelling-fire.ts
      flood.ts
      earthquake.ts
      personal-umbrella.ts
      personal-articles.ts
      watercraft.ts
      recreational-vehicle.ts
      farm-ranch.ts
      general-liability.ts
      commercial-property.ts
      commercial-auto.ts
      workers-comp.ts
      umbrella-excess.ts
      professional-liability.ts
      cyber.ts
      directors-officers.ts
      crime.ts
      default.ts           # Fallback template for unknown/other types
    agent/                 # Unchanged from v5
      index.ts
      identity.ts
      safety.ts
      formatting.ts
      coverage-gaps.ts
      coi-routing.ts
      quotes-policies.ts
      conversation-memory.ts
      intent.ts
    application/
      classify.ts
      field-extraction.ts
      auto-fill.ts
      question-batch.ts
      answer-parsing.ts
      confirmation.ts
      batch-email.ts
      reply-intent.ts
      field-explanation.ts
      pdf-mapping.ts
    intent.ts              # buildClassifyMessagePrompt (unchanged)

  storage/
    interfaces.ts          # DocumentStore, MemoryStore interfaces + filter types
    chunk-types.ts         # DocumentChunk, ConversationTurn types
    sqlite/
      document-store.ts    # SQLite DocumentStore implementation
      memory-store.ts      # SQLite MemoryStore implementation
      migrations.ts        # Schema creation SQL

  tools/
    definitions.ts         # Unchanged from v5

  index.ts                 # New barrel exports
```

---

## Task 1: Project Setup — Dependencies + Build Config

**Files:**
- Modify: `package.json`
- Modify: `tsup.config.ts`

This task updates dependencies and build config for v6. No code changes yet — just the foundation.

- [ ] **Step 1: Update package.json**

Replace the current peer/dev dependencies:

```json
{
  "name": "@claritylabs/cl-sdk",
  "version": "0.1.0",
  "description": "CL-0 SDK — open infrastructure for building AI agents that work with insurance",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    },
    "./storage/sqlite": {
      "types": "./dist/storage-sqlite.d.ts",
      "import": "./dist/storage-sqlite.mjs",
      "require": "./dist/storage-sqlite.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "release": "semantic-release"
  },
  "peerDependencies": {
    "pdf-lib": ">=1.17.0",
    "zod": ">=3.22.0"
  },
  "peerDependenciesMeta": {
    "better-sqlite3": {
      "optional": true
    }
  },
  "devDependencies": {
    "@semantic-release/changelog": "^6.0.3",
    "@semantic-release/git": "^10.0.1",
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^25.5.0",
    "better-sqlite3": "^11.7.0",
    "pdf-lib": "^1.17.1",
    "semantic-release": "^25.0.3",
    "tsup": "^8.4.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0",
    "zod": "^3.24.0"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/claritylabs-inc/cl-sdk"
  },
  "license": "Apache-2.0",
  "publishConfig": {
    "registry": "https://registry.npmjs.org",
    "access": "public"
  }
}
```

- [ ] **Step 2: Update tsup.config.ts for dual entry points**

```ts
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
  },
  {
    entry: { "storage-sqlite": "src/storage/sqlite/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    external: ["better-sqlite3"],
  },
]);
```

- [ ] **Step 3: Install new dependencies**

Run: `npm install`

Expected: Installs zod, vitest, better-sqlite3, @types/better-sqlite3. Removes ai, @ai-sdk/anthropic, @ai-sdk/provider-utils.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsup.config.ts
git commit -m "feat!: update dependencies for v6 — remove ai SDK, add zod + vitest + better-sqlite3"
```

---

## Task 2: Core Utilities — Types + Helpers

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/retry.ts`
- Create: `src/core/concurrency.ts`
- Create: `src/core/strip-fences.ts`
- Create: `src/core/sanitize.ts`
- Test: `src/__tests__/core/retry.test.ts`
- Test: `src/__tests__/core/concurrency.test.ts`
- Test: `src/__tests__/core/strip-fences.test.ts`
- Test: `src/__tests__/core/sanitize.test.ts`

- [ ] **Step 1: Write tests for core utilities**

```ts
// src/__tests__/core/strip-fences.test.ts
import { describe, it, expect } from "vitest";
import { stripFences } from "../../core/strip-fences";

describe("stripFences", () => {
  it("removes json code fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("removes plain code fences", () => {
    expect(stripFences('```\nhello\n```')).toBe("hello");
  });
  it("returns plain text unchanged", () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});
```

```ts
// src/__tests__/core/sanitize.test.ts
import { describe, it, expect } from "vitest";
import { sanitizeNulls } from "../../core/sanitize";

describe("sanitizeNulls", () => {
  it("converts null to undefined", () => {
    expect(sanitizeNulls(null)).toBeUndefined();
  });
  it("recursively converts nulls in objects", () => {
    const result = sanitizeNulls({ a: null, b: { c: null, d: "ok" } });
    expect(result).toEqual({ a: undefined, b: { c: undefined, d: "ok" } });
  });
  it("handles arrays", () => {
    const result = sanitizeNulls([null, { a: null }]);
    expect(result).toEqual([undefined, { a: undefined }]);
  });
  it("passes through primitives", () => {
    expect(sanitizeNulls("hello")).toBe("hello");
    expect(sanitizeNulls(42)).toBe(42);
  });
});
```

```ts
// src/__tests__/core/retry.test.ts
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../core/retry";

describe("withRetry", () => {
  it("returns result on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetry(fn)).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });
  it("retries on rate limit error", async () => {
    const error = new Error("rate limit exceeded");
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");
    expect(await withRetry(fn)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("throws non-rate-limit errors immediately", async () => {
    const error = new Error("bad request");
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn)).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledOnce();
  });
});
```

```ts
// src/__tests__/core/concurrency.test.ts
import { describe, it, expect } from "vitest";
import { pLimit } from "../../core/concurrency";

describe("pLimit", () => {
  it("limits concurrent execution", async () => {
    const limit = pLimit(2);
    let active = 0;
    let maxActive = 0;

    const task = () => limit(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return "done";
    });

    const results = await Promise.all([task(), task(), task(), task()]);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual(["done", "done", "done", "done"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/core/`

Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Create core/types.ts**

```ts
// src/core/types.ts
import type { ZodSchema } from "zod";

/** Callback to generate text from a prompt. Provider-agnostic. */
export type GenerateText = (params: {
  prompt: string;
  system?: string;
  maxTokens: number;
  providerOptions?: Record<string, unknown>;
}) => Promise<{
  text: string;
  usage?: TokenUsage;
}>;

/** Callback to generate a typed object from a prompt + Zod schema. Provider-agnostic. */
export type GenerateObject<T = unknown> = (params: {
  prompt: string;
  system?: string;
  schema: ZodSchema<T>;
  maxTokens: number;
  providerOptions?: Record<string, unknown>;
}) => Promise<{
  object: T;
  usage?: TokenUsage;
}>;

/** Callback to generate embeddings for text. */
export type EmbedText = (text: string) => Promise<number[]>;

/** Callback to convert PDF pages to base64-encoded images. */
export type ConvertPdfToImagesFn = (
  pdfBase64: string,
  startPage: number,
  endPage: number,
) => Promise<Array<{ imageBase64: string; mimeType: string }>>;

/** Token usage reported by model calls. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Logging function for pipeline status messages. */
export type LogFn = (message: string) => Promise<void>;
```

- [ ] **Step 4: Create core/retry.ts**

```ts
// src/core/retry.ts
import type { LogFn } from "./types";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("rate limit") || msg.includes("rate_limit") || msg.includes("too many requests")) {
      return true;
    }
  }
  if (typeof error === "object" && error !== null) {
    const status = (error as Record<string, unknown>).status ?? (error as Record<string, unknown>).statusCode;
    if (status === 429) return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  log?: LogFn,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
      const jitter = Math.random() * 1000;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + jitter;
      await log?.(`Rate limited, retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
```

- [ ] **Step 5: Create core/concurrency.ts**

```ts
// src/core/concurrency.ts

/**
 * Concurrency limiter — returns a function that wraps async tasks
 * so at most `concurrency` run simultaneously.
 */
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      };
      queue.push(run);
      next();
    });
}
```

- [ ] **Step 6: Create core/strip-fences.ts**

```ts
// src/core/strip-fences.ts

/** Strip markdown code fences from AI response text. */
export function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
}
```

- [ ] **Step 7: Create core/sanitize.ts**

```ts
// src/core/sanitize.ts

/**
 * Recursively convert null values to undefined.
 * Some databases (e.g. Convex) reject null for optional fields,
 * but LLMs routinely return null for missing values.
 */
export function sanitizeNulls<T>(obj: T): T {
  if (obj === null || obj === undefined) return undefined as unknown as T;
  if (Array.isArray(obj)) return obj.map(sanitizeNulls) as unknown as T;
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = sanitizeNulls(value);
    }
    return result as T;
  }
  return obj;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/core/`

Expected: All 4 test files pass.

- [ ] **Step 9: Commit**

```bash
git add src/core/ src/__tests__/core/
git commit -m "feat!: add core utilities — provider-agnostic types, retry, concurrency, helpers"
```

---

## Task 3: Zod Schemas — Enums + Shared Types

**Files:**
- Create: `src/schemas/enums.ts`
- Create: `src/schemas/shared.ts`
- Test: `src/__tests__/schemas/enums.test.ts`
- Test: `src/__tests__/schemas/shared.test.ts`

Convert the existing TypeScript union types and interfaces to Zod schemas. Types are derived via `z.infer`.

- [ ] **Step 1: Write tests**

```ts
// src/__tests__/schemas/enums.test.ts
import { describe, it, expect } from "vitest";
import { PolicyTypeSchema, POLICY_TYPES, EndorsementTypeSchema } from "../../schemas/enums";

describe("enum schemas", () => {
  it("validates known policy types", () => {
    expect(PolicyTypeSchema.parse("general_liability")).toBe("general_liability");
    expect(PolicyTypeSchema.parse("homeowners_ho3")).toBe("homeowners_ho3");
  });
  it("rejects unknown policy types", () => {
    expect(() => PolicyTypeSchema.parse("not_a_type")).toThrow();
  });
  it("POLICY_TYPES contains all values", () => {
    expect(POLICY_TYPES.length).toBe(42);
  });
  it("validates endorsement types", () => {
    expect(EndorsementTypeSchema.parse("additional_insured")).toBe("additional_insured");
  });
});
```

```ts
// src/__tests__/schemas/shared.test.ts
import { describe, it, expect } from "vitest";
import { AddressSchema, ContactSchema } from "../../schemas/shared";

describe("shared schemas", () => {
  it("validates a complete address", () => {
    const addr = { street1: "123 Main", city: "Austin", state: "TX", zip: "78701" };
    expect(AddressSchema.parse(addr)).toEqual(addr);
  });
  it("validates address with optional fields", () => {
    const addr = { street1: "123 Main", city: "Austin", state: "TX", zip: "78701", street2: "Suite 4", country: "US" };
    expect(AddressSchema.parse(addr)).toEqual(addr);
  });
  it("rejects address missing required fields", () => {
    expect(() => AddressSchema.parse({ street1: "123 Main" })).toThrow();
  });
  it("validates contact with minimal fields", () => {
    expect(ContactSchema.parse({})).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/schemas/`

Expected: FAIL — modules don't exist.

- [ ] **Step 3: Create schemas/enums.ts**

Convert all 30+ union types from `types/enums.ts` to Zod enums. Each enum exports both the schema and the derived TypeScript type. The file follows the exact same structure as the current `types/enums.ts` but uses `z.enum()` instead of TypeScript union types.

```ts
// src/schemas/enums.ts
import { z } from "zod";

export const PolicyTypeSchema = z.enum([
  "general_liability", "commercial_property", "commercial_auto", "non_owned_auto",
  "workers_comp", "umbrella", "excess_liability", "professional_liability",
  "cyber", "epli", "directors_officers", "fiduciary_liability", "crime_fidelity",
  "inland_marine", "builders_risk", "environmental", "ocean_marine", "surety",
  "product_liability", "bop", "management_liability_package", "property",
  "homeowners_ho3", "homeowners_ho5", "renters_ho4", "condo_ho6", "dwelling_fire",
  "mobile_home", "personal_auto", "personal_umbrella", "flood_nfip", "flood_private",
  "earthquake", "personal_inland_marine", "watercraft", "recreational_vehicle",
  "farm_ranch", "pet", "travel", "identity_theft", "title", "other",
]);
export type PolicyType = z.infer<typeof PolicyTypeSchema>;
export const POLICY_TYPES = PolicyTypeSchema.options;

export const EndorsementTypeSchema = z.enum([
  "additional_insured", "waiver_of_subrogation", "primary_noncontributory",
  "blanket_additional_insured", "loss_payee", "mortgage_holder", "broadening",
  "restriction", "exclusion", "amendatory", "notice_of_cancellation",
  "designated_premises", "classification_change", "schedule_update",
  "deductible_change", "limit_change", "territorial_extension", "other",
]);
export type EndorsementType = z.infer<typeof EndorsementTypeSchema>;

export const ConditionTypeSchema = z.enum([
  "duties_after_loss", "notice_requirements", "other_insurance", "cancellation",
  "nonrenewal", "transfer_of_rights", "liberalization", "arbitration",
  "concealment_fraud", "examination_under_oath", "legal_action", "loss_payment",
  "appraisal", "mortgage_holders", "policy_territory", "separation_of_insureds", "other",
]);
export type ConditionType = z.infer<typeof ConditionTypeSchema>;

export const PolicySectionTypeSchema = z.enum([
  "declarations", "insuring_agreement", "policy_form", "endorsement",
  "application", "exclusion", "condition", "definition", "schedule",
  "notice", "regulatory", "other",
]);
export type PolicySectionType = z.infer<typeof PolicySectionTypeSchema>;

export const QuoteSectionTypeSchema = z.enum([
  "terms_summary", "premium_indication", "underwriting_condition",
  "subjectivity", "coverage_summary", "exclusion", "other",
]);
export type QuoteSectionType = z.infer<typeof QuoteSectionTypeSchema>;

export const CoverageFormSchema = z.enum(["occurrence", "claims_made", "accident"]);
export type CoverageForm = z.infer<typeof CoverageFormSchema>;

export const PolicyTermTypeSchema = z.enum(["fixed", "continuous"]);
export type PolicyTermType = z.infer<typeof PolicyTermTypeSchema>;

export const CoverageTriggerSchema = z.enum(["occurrence", "claims_made", "accident"]);
export type CoverageTrigger = z.infer<typeof CoverageTriggerSchema>;

export const LimitTypeSchema = z.enum([
  "per_occurrence", "per_claim", "aggregate", "per_person",
  "per_accident", "statutory", "blanket", "scheduled",
]);
export type LimitType = z.infer<typeof LimitTypeSchema>;

export const DeductibleTypeSchema = z.enum([
  "per_occurrence", "per_claim", "aggregate", "percentage", "waiting_period",
]);
export type DeductibleType = z.infer<typeof DeductibleTypeSchema>;

export const ValuationMethodSchema = z.enum([
  "replacement_cost", "actual_cash_value", "agreed_value", "functional_replacement",
]);
export type ValuationMethod = z.infer<typeof ValuationMethodSchema>;

export const DefenseCostTreatmentSchema = z.enum(["inside_limits", "outside_limits", "supplementary"]);
export type DefenseCostTreatment = z.infer<typeof DefenseCostTreatmentSchema>;

export const EntityTypeSchema = z.enum([
  "corporation", "llc", "partnership", "sole_proprietor", "joint_venture",
  "trust", "nonprofit", "municipality", "individual", "married_couple", "other",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const AdmittedStatusSchema = z.enum(["admitted", "non_admitted", "surplus_lines"]);
export type AdmittedStatus = z.infer<typeof AdmittedStatusSchema>;

export const AuditTypeSchema = z.enum([
  "annual", "semi_annual", "quarterly", "monthly", "self", "physical", "none",
]);
export type AuditType = z.infer<typeof AuditTypeSchema>;

export const EndorsementPartyRoleSchema = z.enum([
  "additional_insured", "loss_payee", "mortgage_holder",
  "certificate_holder", "notice_recipient", "other",
]);
export type EndorsementPartyRole = z.infer<typeof EndorsementPartyRoleSchema>;

export const ClaimStatusSchema = z.enum(["open", "closed", "reopened"]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const SubjectivityCategorySchema = z.enum(["pre_binding", "post_binding", "information"]);
export type SubjectivityCategory = z.infer<typeof SubjectivityCategorySchema>;

export const DocumentTypeSchema = z.enum(["policy", "quote", "binder", "endorsement", "certificate"]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const ChunkTypeSchema = z.enum([
  "declarations", "coverage_form", "endorsement", "schedule", "conditions", "mixed",
]);
export type ChunkType = z.infer<typeof ChunkTypeSchema>;

export const RatingBasisTypeSchema = z.enum([
  "payroll", "revenue", "area", "units", "vehicle_count", "employee_count",
  "per_capita", "dwelling_value", "vehicle_value", "contents_value", "other",
]);
export type RatingBasisType = z.infer<typeof RatingBasisTypeSchema>;

export const VehicleCoverageTypeSchema = z.enum([
  "liability", "collision", "comprehensive", "uninsured_motorist",
  "underinsured_motorist", "medical_payments", "hired_auto",
  "non_owned_auto", "cargo", "physical_damage",
]);
export type VehicleCoverageType = z.infer<typeof VehicleCoverageTypeSchema>;

export const HomeownersFormTypeSchema = z.enum(["HO-3", "HO-5", "HO-4", "HO-6", "HO-7", "HO-8"]);
export type HomeownersFormType = z.infer<typeof HomeownersFormTypeSchema>;

export const DwellingFireFormTypeSchema = z.enum(["DP-1", "DP-2", "DP-3"]);
export type DwellingFireFormType = z.infer<typeof DwellingFireFormTypeSchema>;

export const FloodZoneSchema = z.enum(["A", "AE", "AH", "AO", "AR", "V", "VE", "B", "C", "X", "D"]);
export type FloodZone = z.infer<typeof FloodZoneSchema>;

export const ConstructionTypeSchema = z.enum(["frame", "masonry", "superior", "mixed", "other"]);
export type ConstructionType = z.infer<typeof ConstructionTypeSchema>;

export const RoofTypeSchema = z.enum(["asphalt_shingle", "tile", "metal", "slate", "flat", "wood_shake", "other"]);
export type RoofType = z.infer<typeof RoofTypeSchema>;

export const FoundationTypeSchema = z.enum(["basement", "crawl_space", "slab", "pier", "other"]);
export type FoundationType = z.infer<typeof FoundationTypeSchema>;

export const PersonalAutoUsageSchema = z.enum(["pleasure", "commute", "business", "farm"]);
export type PersonalAutoUsage = z.infer<typeof PersonalAutoUsageSchema>;

export const LossSettlementSchema = z.enum([
  "replacement_cost", "actual_cash_value", "extended_replacement_cost", "guaranteed_replacement_cost",
]);
export type LossSettlement = z.infer<typeof LossSettlementSchema>;

export const BoatTypeSchema = z.enum(["sailboat", "powerboat", "pontoon", "jet_ski", "kayak_canoe", "yacht", "other"]);
export type BoatType = z.infer<typeof BoatTypeSchema>;

export const RVTypeSchema = z.enum(["rv_motorhome", "travel_trailer", "atv", "snowmobile", "golf_cart", "dirt_bike", "other"]);
export type RVType = z.infer<typeof RVTypeSchema>;

export const ScheduledItemCategorySchema = z.enum([
  "jewelry", "fine_art", "musical_instruments", "silverware", "furs",
  "cameras", "collectibles", "firearms", "golf_equipment", "other",
]);
export type ScheduledItemCategory = z.infer<typeof ScheduledItemCategorySchema>;

export const TitlePolicyTypeSchema = z.enum(["owners", "lenders"]);
export type TitlePolicyType = z.infer<typeof TitlePolicyTypeSchema>;

export const PetSpeciesSchema = z.enum(["dog", "cat", "other"]);
export type PetSpecies = z.infer<typeof PetSpeciesSchema>;
```

- [ ] **Step 4: Create schemas/shared.ts**

```ts
// src/schemas/shared.ts
import { z } from "zod";
import { RatingBasisTypeSchema } from "./enums";

export const AddressSchema = z.object({
  street1: z.string(),
  street2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  country: z.string().optional(),
});
export type Address = z.infer<typeof AddressSchema>;

export const ContactSchema = z.object({
  name: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  phone: z.string().optional(),
  fax: z.string().optional(),
  email: z.string().optional(),
  address: AddressSchema.optional(),
  hours: z.string().optional(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const FormReferenceSchema = z.object({
  formNumber: z.string(),
  editionDate: z.string().optional(),
  title: z.string().optional(),
  formType: z.enum(["coverage", "endorsement", "declarations", "application", "notice", "other"]),
});
export type FormReference = z.infer<typeof FormReferenceSchema>;

export const TaxFeeItemSchema = z.object({
  name: z.string(),
  amount: z.string(),
  type: z.enum(["tax", "fee", "surcharge", "assessment"]).optional(),
  description: z.string().optional(),
});
export type TaxFeeItem = z.infer<typeof TaxFeeItemSchema>;

export const RatingBasisSchema = z.object({
  type: RatingBasisTypeSchema,
  amount: z.string().optional(),
  description: z.string().optional(),
});
export type RatingBasis = z.infer<typeof RatingBasisSchema>;

export const SublimitSchema = z.object({
  name: z.string(),
  limit: z.string(),
  appliesTo: z.string().optional(),
  deductible: z.string().optional(),
});
export type Sublimit = z.infer<typeof SublimitSchema>;

export const SharedLimitSchema = z.object({
  description: z.string(),
  limit: z.string(),
  coverageParts: z.array(z.string()),
});
export type SharedLimit = z.infer<typeof SharedLimitSchema>;

export const ExtendedReportingPeriodSchema = z.object({
  basicDays: z.number().optional(),
  supplementalYears: z.number().optional(),
  supplementalPremium: z.string().optional(),
});
export type ExtendedReportingPeriod = z.infer<typeof ExtendedReportingPeriodSchema>;

export const NamedInsuredSchema = z.object({
  name: z.string(),
  relationship: z.string().optional(),
  address: AddressSchema.optional(),
});
export type NamedInsured = z.infer<typeof NamedInsuredSchema>;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/schemas/`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/enums.ts src/schemas/shared.ts src/__tests__/schemas/
git commit -m "feat!: add Zod schemas for enums and shared types"
```

---

## Task 4: Zod Schemas — Domain Types (Coverage, Endorsement, Financial, etc.)

**Files:**
- Create: `src/schemas/coverage.ts`
- Create: `src/schemas/endorsement.ts`
- Create: `src/schemas/exclusion.ts`
- Create: `src/schemas/condition.ts`
- Create: `src/schemas/parties.ts`
- Create: `src/schemas/financial.ts`
- Create: `src/schemas/loss-history.ts`
- Create: `src/schemas/underwriting.ts`

Each file converts the corresponding `types/*.ts` interface to a Zod schema. Follow the exact same field names and optional/required status as the existing interfaces. Reference `src/types/coverage.ts`, `src/types/endorsement.ts`, `src/types/exclusion.ts`, `src/types/condition.ts`, `src/types/parties.ts`, `src/types/financial.ts`, `src/types/loss-history.ts`, `src/types/underwriting.ts` for the exact field definitions.

- [ ] **Step 1: Create all domain schema files**

Create each file following the pattern: import Zod + dependent schemas, define schema with `z.object()`, export schema and derived type.

For example, `src/schemas/coverage.ts`:

```ts
// src/schemas/coverage.ts
import { z } from "zod";
import {
  LimitTypeSchema, DeductibleTypeSchema, CoverageTriggerSchema, ValuationMethodSchema,
} from "./enums";

export const CoverageSchema = z.object({
  name: z.string(),
  limit: z.string(),
  deductible: z.string().optional(),
  pageNumber: z.number().optional(),
  sectionRef: z.string().optional(),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const EnrichedCoverageSchema = z.object({
  name: z.string(),
  coverageCode: z.string().optional(),
  formNumber: z.string().optional(),
  formEditionDate: z.string().optional(),
  limit: z.string(),
  limitType: LimitTypeSchema.optional(),
  deductible: z.string().optional(),
  deductibleType: DeductibleTypeSchema.optional(),
  sir: z.string().optional(),
  sublimit: z.string().optional(),
  coinsurance: z.string().optional(),
  valuation: ValuationMethodSchema.optional(),
  territory: z.string().optional(),
  trigger: CoverageTriggerSchema.optional(),
  retroactiveDate: z.string().optional(),
  included: z.boolean(),
  premium: z.string().optional(),
  pageNumber: z.number().optional(),
  sectionRef: z.string().optional(),
});
export type EnrichedCoverage = z.infer<typeof EnrichedCoverageSchema>;
```

Repeat this pattern for each domain type file, referencing the exact fields from the corresponding `src/types/*.ts` file. Every field name, type, and optional status must match.

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`

Expected: No errors from schema files (may have errors from other files not yet migrated — that's fine).

- [ ] **Step 3: Commit**

```bash
git add src/schemas/
git commit -m "feat!: add Zod schemas for domain types — coverage, endorsement, financial, etc."
```

---

## Task 5: Zod Schemas — Declarations (Union Type)

**Files:**
- Create: `src/schemas/declarations/shared.ts`
- Create: `src/schemas/declarations/personal.ts`
- Create: `src/schemas/declarations/commercial.ts`
- Create: `src/schemas/declarations/index.ts`

Convert the 23 declaration types from `types/declarations/` to Zod discriminated unions. Reference `src/types/declarations/shared.ts`, `src/types/declarations/personal.ts`, `src/types/declarations/commercial.ts`, and `src/types/declarations/index.ts` for exact field definitions.

- [ ] **Step 1: Create declarations/shared.ts**

Contains `DwellingDetailsSchema`, `DriverRecordSchema`, `PersonalVehicleDetailsSchema`, plus the shared sub-schemas (`LimitScheduleSchema`, `DeductibleScheduleSchema`, `InsuredLocationSchema`, `InsuredVehicleSchema`, `VehicleCoverageSchema`, `ClassificationCodeSchema`). Match fields exactly from `src/types/declarations/shared.ts` and `src/types/declarations.ts`.

- [ ] **Step 2: Create declarations/personal.ts**

Contains all 14 personal line declaration schemas (HomeownersDeclarationsSchema, PersonalAutoDeclarationsSchema, etc.). Each uses `z.object({ line: z.literal("homeowners"), ... })` for the discriminant.

- [ ] **Step 3: Create declarations/commercial.ts**

Contains all 9 commercial line declaration schemas (GLDeclarationsSchema, CommercialPropertyDeclarationsSchema, etc.). Each uses `z.object({ line: z.literal("gl"), ... })` for the discriminant.

- [ ] **Step 4: Create declarations/index.ts**

```ts
// src/schemas/declarations/index.ts
import { z } from "zod";
// Import all personal + commercial schemas
import { HomeownersDeclarationsSchema, PersonalAutoDeclarationsSchema, /* ...all 14 */ } from "./personal";
import { GLDeclarationsSchema, CommercialPropertyDeclarationsSchema, /* ...all 9 */ } from "./commercial";

export const DeclarationsSchema = z.discriminatedUnion("line", [
  HomeownersDeclarationsSchema,
  PersonalAutoDeclarationsSchema,
  // ... all 23
]);
export type Declarations = z.infer<typeof DeclarationsSchema>;

// Re-export everything
export * from "./shared";
export * from "./personal";
export * from "./commercial";
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`

Expected: No errors from declaration schema files.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/declarations/
git commit -m "feat!: add Zod schemas for all 23 declaration types as discriminated union"
```

---

## Task 6: Zod Schemas — Document + Platform

**Files:**
- Create: `src/schemas/document.ts`
- Create: `src/schemas/platform.ts`
- Create: `src/schemas/context-keys.ts`
- Test: `src/__tests__/schemas/document.test.ts`

- [ ] **Step 1: Write test for document schema**

```ts
// src/__tests__/schemas/document.test.ts
import { describe, it, expect } from "vitest";
import { PolicyDocumentSchema, QuoteDocumentSchema, InsuranceDocumentSchema } from "../../schemas/document";

describe("document schemas", () => {
  const minimalPolicy = {
    id: "pol-1",
    type: "policy" as const,
    carrier: "Acme Insurance",
    insuredName: "Test Corp",
    policyNumber: "POL-001",
    effectiveDate: "01/01/2026",
    coverages: [],
  };

  it("validates a minimal policy", () => {
    expect(PolicyDocumentSchema.parse(minimalPolicy)).toMatchObject({ id: "pol-1", type: "policy" });
  });

  it("validates via discriminated union", () => {
    expect(InsuranceDocumentSchema.parse(minimalPolicy)).toMatchObject({ type: "policy" });
  });

  const minimalQuote = {
    id: "q-1",
    type: "quote" as const,
    carrier: "Acme Insurance",
    insuredName: "Test Corp",
    quoteNumber: "Q-001",
    coverages: [],
  };

  it("validates a minimal quote", () => {
    expect(QuoteDocumentSchema.parse(minimalQuote)).toMatchObject({ id: "q-1", type: "quote" });
  });
});
```

- [ ] **Step 2: Create schemas/document.ts**

Build `BaseDocumentSchema`, `PolicyDocumentSchema`, `QuoteDocumentSchema`, and `InsuranceDocumentSchema` (discriminated union on `type`). Reference every field from `src/types/document.ts` — the schema must validate objects matching the existing interfaces exactly.

```ts
// src/schemas/document.ts
import { z } from "zod";
import { PolicyTypeSchema, EntityTypeSchema, CoverageFormSchema, PolicyTermTypeSchema, AuditTypeSchema } from "./enums";
import { AddressSchema, ContactSchema, FormReferenceSchema, TaxFeeItemSchema, RatingBasisSchema, NamedInsuredSchema, ExtendedReportingPeriodSchema } from "./shared";
import { CoverageSchema, EnrichedCoverageSchema } from "./coverage";
import { EndorsementSchema, EndorsementPartySchema } from "./endorsement";
import { ExclusionSchema } from "./exclusion";
import { PolicyConditionSchema } from "./condition";
import { DeclarationsSchema, LimitScheduleSchema, DeductibleScheduleSchema, InsuredLocationSchema, InsuredVehicleSchema, ClassificationCodeSchema } from "./declarations/index";
import { InsurerInfoSchema, ProducerInfoSchema } from "./parties";
import { PaymentPlanSchema, LocationPremiumSchema } from "./financial";
import { LossSummarySchema, ClaimRecordSchema, ExperienceModSchema } from "./loss-history";
import { EnrichedSubjectivitySchema, EnrichedUnderwritingConditionSchema, BindingAuthoritySchema } from "./underwriting";

// Section + Subsection schemas (inline — only used here)
const SubsectionSchema = z.object({
  title: z.string(),
  sectionNumber: z.string().optional(),
  pageNumber: z.number().optional(),
  content: z.string(),
});

const SectionSchema = z.object({
  title: z.string(),
  sectionNumber: z.string().optional(),
  pageStart: z.number(),
  pageEnd: z.number().optional(),
  type: z.string(),
  coverageType: z.string().optional(),
  content: z.string(),
  subsections: z.array(SubsectionSchema).optional(),
});

const SubjectivitySchema = z.object({
  description: z.string(),
  category: z.string().optional(),
});

const UnderwritingConditionSchema = z.object({
  description: z.string(),
});

const PremiumLineSchema = z.object({
  line: z.string(),
  amount: z.string(),
});

const BaseDocumentFields = {
  id: z.string(),
  carrier: z.string(),
  security: z.string().optional(),
  insuredName: z.string(),
  premium: z.string().optional(),
  summary: z.string().optional(),
  policyTypes: z.array(z.string()).optional(),
  coverages: z.array(CoverageSchema),
  sections: z.array(SectionSchema).optional(),
  carrierLegalName: z.string().optional(),
  carrierNaicNumber: z.string().optional(),
  carrierAmBestRating: z.string().optional(),
  carrierAdmittedStatus: z.string().optional(),
  mga: z.string().optional(),
  underwriter: z.string().optional(),
  brokerAgency: z.string().optional(),
  brokerContactName: z.string().optional(),
  brokerLicenseNumber: z.string().optional(),
  priorPolicyNumber: z.string().optional(),
  programName: z.string().optional(),
  isRenewal: z.boolean().optional(),
  isPackage: z.boolean().optional(),
  insuredDba: z.string().optional(),
  insuredAddress: AddressSchema.optional(),
  insuredEntityType: EntityTypeSchema.optional(),
  additionalNamedInsureds: z.array(NamedInsuredSchema).optional(),
  insuredSicCode: z.string().optional(),
  insuredNaicsCode: z.string().optional(),
  insuredFein: z.string().optional(),
  enrichedCoverages: z.array(EnrichedCoverageSchema).optional(),
  endorsements: z.array(EndorsementSchema).optional(),
  exclusions: z.array(ExclusionSchema).optional(),
  conditions: z.array(PolicyConditionSchema).optional(),
  limits: LimitScheduleSchema.optional(),
  deductibles: DeductibleScheduleSchema.optional(),
  locations: z.array(InsuredLocationSchema).optional(),
  vehicles: z.array(InsuredVehicleSchema).optional(),
  classifications: z.array(ClassificationCodeSchema).optional(),
  formInventory: z.array(FormReferenceSchema).optional(),
  declarations: DeclarationsSchema.optional(),
  coverageForm: CoverageFormSchema.optional(),
  retroactiveDate: z.string().optional(),
  extendedReportingPeriod: ExtendedReportingPeriodSchema.optional(),
  insurer: InsurerInfoSchema.optional(),
  producer: ProducerInfoSchema.optional(),
  claimsContacts: z.array(ContactSchema).optional(),
  regulatoryContacts: z.array(ContactSchema).optional(),
  thirdPartyAdministrators: z.array(ContactSchema).optional(),
  additionalInsureds: z.array(EndorsementPartySchema).optional(),
  lossPayees: z.array(EndorsementPartySchema).optional(),
  mortgageHolders: z.array(EndorsementPartySchema).optional(),
  taxesAndFees: z.array(TaxFeeItemSchema).optional(),
  totalCost: z.string().optional(),
  minimumPremium: z.string().optional(),
  depositPremium: z.string().optional(),
  paymentPlan: PaymentPlanSchema.optional(),
  auditType: AuditTypeSchema.optional(),
  ratingBasis: z.array(RatingBasisSchema).optional(),
  premiumByLocation: z.array(LocationPremiumSchema).optional(),
  lossSummary: LossSummarySchema.optional(),
  individualClaims: z.array(ClaimRecordSchema).optional(),
  experienceMod: ExperienceModSchema.optional(),
  cancellationNoticeDays: z.number().optional(),
  nonrenewalNoticeDays: z.number().optional(),
};

export const PolicyDocumentSchema = z.object({
  ...BaseDocumentFields,
  type: z.literal("policy"),
  policyNumber: z.string(),
  effectiveDate: z.string(),
  expirationDate: z.string().optional(),
  policyTermType: PolicyTermTypeSchema.optional(),
  nextReviewDate: z.string().optional(),
  effectiveTime: z.string().optional(),
});
export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;

export const QuoteDocumentSchema = z.object({
  ...BaseDocumentFields,
  type: z.literal("quote"),
  quoteNumber: z.string(),
  proposedEffectiveDate: z.string().optional(),
  proposedExpirationDate: z.string().optional(),
  quoteExpirationDate: z.string().optional(),
  subjectivities: z.array(SubjectivitySchema).optional(),
  underwritingConditions: z.array(UnderwritingConditionSchema).optional(),
  premiumBreakdown: z.array(PremiumLineSchema).optional(),
  enrichedSubjectivities: z.array(EnrichedSubjectivitySchema).optional(),
  enrichedUnderwritingConditions: z.array(EnrichedUnderwritingConditionSchema).optional(),
  warrantyRequirements: z.array(z.string()).optional(),
  lossControlRecommendations: z.array(z.string()).optional(),
  bindingAuthority: BindingAuthoritySchema.optional(),
});
export type QuoteDocument = z.infer<typeof QuoteDocumentSchema>;

export const InsuranceDocumentSchema = z.discriminatedUnion("type", [
  PolicyDocumentSchema,
  QuoteDocumentSchema,
]);
export type InsuranceDocument = z.infer<typeof InsuranceDocumentSchema>;

// Re-export inline schemas for consumers
export type Section = z.infer<typeof SectionSchema>;
export type Subsection = z.infer<typeof SubsectionSchema>;
export type Subjectivity = z.infer<typeof SubjectivitySchema>;
export type UnderwritingCondition = z.infer<typeof UnderwritingConditionSchema>;
export type PremiumLine = z.infer<typeof PremiumLineSchema>;
export { SectionSchema, SubsectionSchema, SubjectivitySchema, UnderwritingConditionSchema, PremiumLineSchema };
```

- [ ] **Step 3: Create schemas/platform.ts**

Copy the existing platform types and convert to Zod. `PLATFORM_CONFIGS` stays as a plain object (not a schema — it's a runtime constant, not validated data).

```ts
// src/schemas/platform.ts
import { z } from "zod";

export const PlatformSchema = z.enum(["email", "chat", "sms", "slack", "discord"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const CommunicationIntentSchema = z.enum(["direct", "mediated", "observed"]);
export type CommunicationIntent = z.infer<typeof CommunicationIntentSchema>;

export interface PlatformConfig {
  supportsMarkdown: boolean;
  supportsLinks: boolean;
  supportsRichFormatting: boolean;
  maxResponseLength?: number;
  signOff?: boolean;
}

export const PLATFORM_CONFIGS: Record<Platform, PlatformConfig> = {
  email: { supportsMarkdown: false, supportsLinks: true, supportsRichFormatting: false, signOff: true },
  chat: { supportsMarkdown: true, supportsLinks: true, supportsRichFormatting: true },
  sms: { supportsMarkdown: false, supportsLinks: false, supportsRichFormatting: false, maxResponseLength: 1600 },
  slack: { supportsMarkdown: true, supportsLinks: true, supportsRichFormatting: true },
  discord: { supportsMarkdown: true, supportsLinks: true, supportsRichFormatting: true, maxResponseLength: 2000 },
};

export interface AgentContext {
  platform: Platform;
  intent: CommunicationIntent;
  platformConfig?: PlatformConfig;
  companyName?: string;
  companyContext?: string;
  siteUrl: string;
  userName?: string;
  coiHandling?: "broker" | "user" | "member" | "ignore";
  brokerName?: string;
  brokerContactName?: string;
  brokerContactEmail?: string;
  agentName?: string;
  linkGuidance?: string;
}
```

- [ ] **Step 4: Create schemas/context-keys.ts**

Copy from `src/types/context-keys.ts` unchanged — it's a static mapping, not a schema.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/__tests__/schemas/`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/
git commit -m "feat!: add Zod schemas for documents, platform, and context keys"
```

---

## Task 7: Extraction — PDF Operations + Chunking

**Files:**
- Create: `src/extraction/pdf.ts` (copy from existing, unchanged)
- Create: `src/extraction/chunking.ts`
- Create: `src/storage/chunk-types.ts`
- Test: `src/__tests__/extraction/chunking.test.ts`

- [ ] **Step 1: Copy pdf.ts unchanged**

Copy `src/extraction/pdf.ts` as-is — no changes needed. This file uses pdf-lib directly and has no AI SDK dependency.

- [ ] **Step 2: Create storage/chunk-types.ts**

```ts
// src/storage/chunk-types.ts

export interface DocumentChunk {
  /** Deterministic ID: `${documentId}:${type}:${index}` */
  id: string;
  /** Source document ID */
  documentId: string;
  /** Chunk type for filtering */
  type: "carrier_info" | "named_insured" | "coverage" | "endorsement" | "exclusion" | "condition" | "section" | "declaration" | "loss_history" | "premium" | "supplementary";
  /** Human-readable text for embedding */
  text: string;
  /** Structured metadata for filtering */
  metadata: Record<string, string>;
}

export interface ConversationTurn {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolResult?: string;
  timestamp: number;
}

export interface ChunkFilter {
  documentId?: string;
  type?: DocumentChunk["type"];
  metadata?: Record<string, string>;
}

export interface DocumentFilters {
  type?: "policy" | "quote";
  carrier?: string;
  insuredName?: string;
  policyNumber?: string;
  quoteNumber?: string;
}
```

- [ ] **Step 3: Write chunking tests**

```ts
// src/__tests__/extraction/chunking.test.ts
import { describe, it, expect } from "vitest";
import { chunkDocument } from "../../extraction/chunking";
import type { PolicyDocument } from "../../schemas/document";

describe("chunkDocument", () => {
  const doc: PolicyDocument = {
    id: "pol-1",
    type: "policy",
    carrier: "Acme Insurance",
    insuredName: "Test Corp",
    policyNumber: "POL-001",
    effectiveDate: "01/01/2026",
    coverages: [
      { name: "General Liability", limit: "$1,000,000" },
      { name: "Property", limit: "$500,000" },
    ],
    endorsements: [
      { formNumber: "CG2010", title: "Additional Insured", type: "additional_insured", content: "Adds additional insured coverage." },
    ],
  };

  it("creates carrier_info chunk", () => {
    const chunks = chunkDocument(doc);
    const carrier = chunks.find((c) => c.type === "carrier_info");
    expect(carrier).toBeDefined();
    expect(carrier!.text).toContain("Acme Insurance");
    expect(carrier!.id).toBe("pol-1:carrier_info:0");
  });

  it("creates one chunk per coverage", () => {
    const chunks = chunkDocument(doc);
    const coverages = chunks.filter((c) => c.type === "coverage");
    expect(coverages.length).toBe(2);
    expect(coverages[0].metadata.coverageName).toBe("General Liability");
  });

  it("creates endorsement chunks", () => {
    const chunks = chunkDocument(doc);
    const endorsements = chunks.filter((c) => c.type === "endorsement");
    expect(endorsements.length).toBe(1);
  });

  it("assigns deterministic IDs", () => {
    const chunks1 = chunkDocument(doc);
    const chunks2 = chunkDocument(doc);
    expect(chunks1.map((c) => c.id)).toEqual(chunks2.map((c) => c.id));
  });
});
```

- [ ] **Step 4: Create extraction/chunking.ts**

```ts
// src/extraction/chunking.ts
import type { InsuranceDocument } from "../schemas/document";
import type { DocumentChunk } from "../storage/chunk-types";

/**
 * Break a validated document into retrieval-friendly chunks.
 * Each chunk has a deterministic ID, type tag, text for embedding, and metadata for filtering.
 */
export function chunkDocument(doc: InsuranceDocument): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const docId = doc.id;

  // Carrier info chunk
  chunks.push({
    id: `${docId}:carrier_info:0`,
    documentId: docId,
    type: "carrier_info",
    text: [
      `Carrier: ${doc.carrier}`,
      doc.carrierLegalName ? `Legal Name: ${doc.carrierLegalName}` : null,
      doc.carrierNaicNumber ? `NAIC: ${doc.carrierNaicNumber}` : null,
      doc.carrierAmBestRating ? `AM Best: ${doc.carrierAmBestRating}` : null,
      doc.mga ? `MGA: ${doc.mga}` : null,
    ].filter(Boolean).join("\n"),
    metadata: { carrier: doc.carrier, documentType: doc.type },
  });

  // Named insured chunk
  chunks.push({
    id: `${docId}:named_insured:0`,
    documentId: docId,
    type: "named_insured",
    text: [
      `Insured: ${doc.insuredName}`,
      doc.insuredDba ? `DBA: ${doc.insuredDba}` : null,
      doc.insuredFein ? `FEIN: ${doc.insuredFein}` : null,
      doc.insuredAddress ? `Address: ${doc.insuredAddress.street1}, ${doc.insuredAddress.city}, ${doc.insuredAddress.state} ${doc.insuredAddress.zip}` : null,
    ].filter(Boolean).join("\n"),
    metadata: { insuredName: doc.insuredName, documentType: doc.type },
  });

  // Coverage chunks — one per coverage
  doc.coverages.forEach((cov, i) => {
    chunks.push({
      id: `${docId}:coverage:${i}`,
      documentId: docId,
      type: "coverage",
      text: `Coverage: ${cov.name}\nLimit: ${cov.limit}${cov.deductible ? `\nDeductible: ${cov.deductible}` : ""}`,
      metadata: { coverageName: cov.name, limit: cov.limit, documentType: doc.type },
    });
  });

  // Endorsement chunks
  doc.endorsements?.forEach((end, i) => {
    chunks.push({
      id: `${docId}:endorsement:${i}`,
      documentId: docId,
      type: "endorsement",
      text: `Endorsement: ${end.title ?? end.formNumber}\n${end.content ?? ""}`.trim(),
      metadata: { endorsementType: end.type ?? "other", formNumber: end.formNumber ?? "", documentType: doc.type },
    });
  });

  // Exclusion chunks
  doc.exclusions?.forEach((exc, i) => {
    chunks.push({
      id: `${docId}:exclusion:${i}`,
      documentId: docId,
      type: "exclusion",
      text: `Exclusion: ${exc.title}\n${exc.content ?? ""}`.trim(),
      metadata: { documentType: doc.type },
    });
  });

  // Section chunks
  doc.sections?.forEach((sec, i) => {
    chunks.push({
      id: `${docId}:section:${i}`,
      documentId: docId,
      type: "section",
      text: `Section: ${sec.title}\n${sec.content}`,
      metadata: { sectionType: sec.type, documentType: doc.type },
    });
  });

  // Premium chunk
  if (doc.premium) {
    chunks.push({
      id: `${docId}:premium:0`,
      documentId: docId,
      type: "premium",
      text: `Premium: ${doc.premium}${doc.totalCost ? `\nTotal Cost: ${doc.totalCost}` : ""}`,
      metadata: { premium: doc.premium, documentType: doc.type },
    });
  }

  return chunks;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/__tests__/extraction/chunking.test.ts`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/extraction/pdf.ts src/extraction/chunking.ts src/storage/chunk-types.ts src/__tests__/extraction/
git commit -m "feat: add document chunking for vector retrieval + chunk types"
```

---

## Task 8: Prompts — Coordinator (Classify, Plan, Review)

**Files:**
- Create: `src/prompts/coordinator/classify.ts`
- Create: `src/prompts/coordinator/plan.ts`
- Create: `src/prompts/coordinator/review.ts`

These are the prompts that drive the agentic extraction loop. Each file exports a prompt builder function and a Zod output schema.

- [ ] **Step 1: Create coordinator/classify.ts**

```ts
// src/prompts/coordinator/classify.ts
import { z } from "zod";
import { PolicyTypeSchema } from "../../schemas/enums";

export const ClassifyResultSchema = z.object({
  documentType: z.enum(["policy", "quote"]),
  policyTypes: z.array(PolicyTypeSchema),
  confidence: z.number(),
});
export type ClassifyResult = z.infer<typeof ClassifyResultSchema>;

export function buildClassifyPrompt(): string {
  return `You are classifying an insurance document. Examine the first few pages and determine:

1. Whether this is a POLICY (bound coverage) or QUOTE (proposed coverage)
2. What lines of business are covered

Policies typically have: policy numbers, effective/expiration dates, declarations pages, premium charges.
Quotes typically have: quote numbers, proposed dates, subjectivities, "indication" or "proposal" language.

Return JSON matching this structure:
{
  "documentType": "policy" | "quote",
  "policyTypes": ["general_liability", "commercial_property", ...],
  "confidence": 0.0-1.0
}

Use these policy type values: general_liability, commercial_property, commercial_auto, non_owned_auto, workers_comp, umbrella, excess_liability, professional_liability, cyber, epli, directors_officers, fiduciary_liability, crime_fidelity, inland_marine, builders_risk, environmental, ocean_marine, surety, product_liability, bop, management_liability_package, property, homeowners_ho3, homeowners_ho5, renters_ho4, condo_ho6, dwelling_fire, mobile_home, personal_auto, personal_umbrella, flood_nfip, flood_private, earthquake, personal_inland_marine, watercraft, recreational_vehicle, farm_ranch, pet, travel, identity_theft, title, other.

Respond with JSON only.`;
}
```

- [ ] **Step 2: Create coordinator/plan.ts**

```ts
// src/prompts/coordinator/plan.ts
import { z } from "zod";

export const ExtractionTaskSchema = z.object({
  extractorName: z.string(),
  startPage: z.number(),
  endPage: z.number(),
  description: z.string(),
});

export const ExtractionPlanSchema = z.object({
  tasks: z.array(ExtractionTaskSchema),
  pageMap: z.record(z.string(), z.string()).optional(),
});
export type ExtractionPlan = z.infer<typeof ExtractionPlanSchema>;

export function buildPlanPrompt(templateHints: string): string {
  return `You are planning the extraction of an insurance document. You have already classified this document. Now scan the full document and create a page map + extraction plan.

DOCUMENT TYPE HINTS:
${templateHints}

For each section of the document, decide which extractor should handle it and which pages to send.

Available extractors:
- carrier_info: Carrier name, legal name, NAIC, AM Best rating, admitted status, MGA, underwriter
- named_insured: Insured name, DBA, address, entity type, FEIN, SIC/NAICS codes, additional named insureds
- coverage_limits: Coverage names, limits, deductibles, coverage form, triggers
- endorsements: Endorsement forms, titles, types, content, affected parties
- exclusions: Exclusion titles, content, applicability
- conditions: Policy conditions (duties after loss, cancellation, etc.)
- premium_breakdown: Premium amounts, taxes, fees, payment plans, rating basis
- declarations: Line-specific structured declarations data (varies by policy type)
- loss_history: Loss runs, claim records, experience modification
- sections: Raw section content (for sections that don't fit other extractors)
- supplementary: Regulatory context, contacts, claims contacts, third-party administrators

Return JSON:
{
  "tasks": [
    { "extractorName": "carrier_info", "startPage": 1, "endPage": 2, "description": "Extract carrier details from declarations page" },
    ...
  ],
  "pageMap": { "declarations": "pages 1-3", "endorsements": "pages 15-22", ... }
}

Create tasks that cover the entire document. Prefer specific extractors over generic "sections" where possible. Keep page ranges tight — only include pages relevant to each extractor.

Respond with JSON only.`;
}
```

- [ ] **Step 3: Create coordinator/review.ts**

```ts
// src/prompts/coordinator/review.ts
import { z } from "zod";

export const ReviewResultSchema = z.object({
  complete: z.boolean(),
  missingFields: z.array(z.string()),
  additionalTasks: z.array(z.object({
    extractorName: z.string(),
    startPage: z.number(),
    endPage: z.number(),
    description: z.string(),
  })),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export function buildReviewPrompt(templateExpected: string[], extractedKeys: string[]): string {
  return `You are reviewing an extraction for completeness. Compare what was expected vs what was found.

EXPECTED FIELDS (from document type template):
${templateExpected.map((f) => `- ${f}`).join("\n")}

FIELDS ALREADY EXTRACTED:
${extractedKeys.map((f) => `- ${f}`).join("\n")}

Determine:
1. Is the extraction complete enough? (required fields present = complete)
2. What fields are missing?
3. Should any additional extraction tasks be dispatched?

Return JSON:
{
  "complete": boolean,
  "missingFields": ["field1", "field2"],
  "additionalTasks": [
    { "extractorName": "...", "startPage": N, "endPage": N, "description": "..." }
  ]
}

If all required fields are present, set complete=true even if some optional fields are missing.

Respond with JSON only.`;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/prompts/coordinator/
git commit -m "feat: add coordinator prompts — classify, plan, review"
```

---

## Task 9: Prompts — Extractors

**Files:**
- Create: `src/prompts/extractors/carrier-info.ts`
- Create: `src/prompts/extractors/named-insured.ts`
- Create: `src/prompts/extractors/coverage-limits.ts`
- Create: `src/prompts/extractors/endorsements.ts`
- Create: `src/prompts/extractors/exclusions.ts`
- Create: `src/prompts/extractors/conditions.ts`
- Create: `src/prompts/extractors/premium-breakdown.ts`
- Create: `src/prompts/extractors/declarations.ts`
- Create: `src/prompts/extractors/loss-history.ts`
- Create: `src/prompts/extractors/sections.ts`
- Create: `src/prompts/extractors/supplementary.ts`

Each file exports a Zod output schema and a prompt builder. The prompt content should be derived from the relevant portions of the existing `src/prompts/extraction.ts` (the METADATA_PROMPT and buildSectionsPrompt contain the field-level extraction instructions). Split the monolithic prompt into focused, ~15-25 line prompts per extractor.

**Pattern for each file:**

```ts
// src/prompts/extractors/<name>.ts
import { z } from "zod";

export const <Name>Schema = z.object({ /* fields this extractor returns */ });
export type <Name>Result = z.infer<typeof <Name>Schema>;

export function build<Name>Prompt(): string {
  return `<focused extraction instructions for this specific data>

Return JSON only.`;
}
```

- [ ] **Step 1: Create all 11 extractor prompt files**

Each extractor's schema should match the fields from the corresponding part of `BaseDocument` / `PolicyDocument` / `QuoteDocument`. The prompt instructions should be extracted from the existing `METADATA_PROMPT` and `buildSectionsPrompt` in `src/prompts/extraction.ts`, split into focused pieces.

Read `src/prompts/extraction.ts` for the exact field definitions and extraction instructions. Each extractor gets only the portion relevant to its scope.

- [ ] **Step 2: Verify files compile**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors from extractor files.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/extractors/
git commit -m "feat: add focused extractor prompts — split monolithic extraction prompt into 11 modules"
```

---

## Task 10: Prompts — Document Type Templates

**Files:**
- Create: `src/prompts/templates/index.ts`
- Create: `src/prompts/templates/default.ts`
- Create: One file per template (homeowners, personal-auto, general-liability, etc.)

- [ ] **Step 1: Create templates/index.ts with the template type and registry**

```ts
// src/prompts/templates/index.ts

export interface DocumentTemplate {
  type: string;
  expectedSections: string[];
  pageHints: Record<string, string>;
  required: string[];
  optional: string[];
}

// Import all templates
import { HOMEOWNERS_TEMPLATE } from "./homeowners";
import { PERSONAL_AUTO_TEMPLATE } from "./personal-auto";
import { GENERAL_LIABILITY_TEMPLATE } from "./general-liability";
import { COMMERCIAL_PROPERTY_TEMPLATE } from "./commercial-property";
import { COMMERCIAL_AUTO_TEMPLATE } from "./commercial-auto";
import { WORKERS_COMP_TEMPLATE } from "./workers-comp";
import { UMBRELLA_EXCESS_TEMPLATE } from "./umbrella-excess";
import { PROFESSIONAL_LIABILITY_TEMPLATE } from "./professional-liability";
import { CYBER_TEMPLATE } from "./cyber";
import { DIRECTORS_OFFICERS_TEMPLATE } from "./directors-officers";
import { CRIME_TEMPLATE } from "./crime";
import { DWELLING_FIRE_TEMPLATE } from "./dwelling-fire";
import { FLOOD_TEMPLATE } from "./flood";
import { EARTHQUAKE_TEMPLATE } from "./earthquake";
import { PERSONAL_UMBRELLA_TEMPLATE } from "./personal-umbrella";
import { PERSONAL_ARTICLES_TEMPLATE } from "./personal-articles";
import { WATERCRAFT_TEMPLATE } from "./watercraft";
import { RECREATIONAL_VEHICLE_TEMPLATE } from "./recreational-vehicle";
import { FARM_RANCH_TEMPLATE } from "./farm-ranch";
import { DEFAULT_TEMPLATE } from "./default";

const TEMPLATE_MAP: Record<string, DocumentTemplate> = {
  homeowners_ho3: HOMEOWNERS_TEMPLATE,
  homeowners_ho5: HOMEOWNERS_TEMPLATE,
  renters_ho4: HOMEOWNERS_TEMPLATE,
  condo_ho6: HOMEOWNERS_TEMPLATE,
  mobile_home: HOMEOWNERS_TEMPLATE,
  personal_auto: PERSONAL_AUTO_TEMPLATE,
  dwelling_fire: DWELLING_FIRE_TEMPLATE,
  flood_nfip: FLOOD_TEMPLATE,
  flood_private: FLOOD_TEMPLATE,
  earthquake: EARTHQUAKE_TEMPLATE,
  personal_umbrella: PERSONAL_UMBRELLA_TEMPLATE,
  personal_inland_marine: PERSONAL_ARTICLES_TEMPLATE,
  watercraft: WATERCRAFT_TEMPLATE,
  recreational_vehicle: RECREATIONAL_VEHICLE_TEMPLATE,
  farm_ranch: FARM_RANCH_TEMPLATE,
  general_liability: GENERAL_LIABILITY_TEMPLATE,
  commercial_property: COMMERCIAL_PROPERTY_TEMPLATE,
  commercial_auto: COMMERCIAL_AUTO_TEMPLATE,
  workers_comp: WORKERS_COMP_TEMPLATE,
  umbrella: UMBRELLA_EXCESS_TEMPLATE,
  excess_liability: UMBRELLA_EXCESS_TEMPLATE,
  professional_liability: PROFESSIONAL_LIABILITY_TEMPLATE,
  cyber: CYBER_TEMPLATE,
  directors_officers: DIRECTORS_OFFICERS_TEMPLATE,
  crime_fidelity: CRIME_TEMPLATE,
};

export function getTemplate(policyType: string): DocumentTemplate {
  return TEMPLATE_MAP[policyType] ?? DEFAULT_TEMPLATE;
}
```

- [ ] **Step 2: Create each template file**

Each template follows the `DocumentTemplate` interface. Example:

```ts
// src/prompts/templates/homeowners.ts
import type { DocumentTemplate } from "./index";

export const HOMEOWNERS_TEMPLATE: DocumentTemplate = {
  type: "homeowners",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "endorsements", "exclusions", "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 3 pages",
    endorsements: "last 30%",
    conditions: "middle of document",
  },
  required: ["carrier_info", "named_insured", "coverage_limits", "declarations"],
  optional: ["loss_history", "supplementary", "sections"],
};
```

```ts
// src/prompts/templates/default.ts
import type { DocumentTemplate } from "./index";

export const DEFAULT_TEMPLATE: DocumentTemplate = {
  type: "unknown",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits",
    "endorsements", "exclusions", "conditions", "premium_breakdown", "sections",
  ],
  pageHints: {
    declarations: "first 5 pages",
    endorsements: "last 25%",
  },
  required: ["carrier_info", "named_insured", "coverage_limits"],
  optional: ["declarations", "loss_history", "supplementary", "endorsements", "exclusions", "conditions"],
};
```

Create similarly structured templates for every policy type listed in the registry. Each template's `expectedSections`, `pageHints`, and `required`/`optional` should reflect the typical structure of that document type (use domain knowledge from the existing extraction prompts).

- [ ] **Step 3: Commit**

```bash
git add src/prompts/templates/
git commit -m "feat: add document type templates for agentic extraction"
```

---

## Task 11: Prompts — Agent + Application + Intent (Migrate Unchanged)

**Files:**
- Copy: `src/prompts/agent/` (all files, unchanged)
- Create: `src/prompts/application/` (split from existing `src/prompts/application.ts`)
- Copy: `src/prompts/intent.ts` (unchanged)

- [ ] **Step 1: Copy agent prompt modules**

Copy the entire `src/prompts/agent/` directory as-is. These modules are already well-decomposed and have no AI SDK dependency. Update imports to reference `../schemas/platform` instead of `../../types/platform`.

- [ ] **Step 2: Split application.ts into individual files**

Break `src/prompts/application.ts` (449 lines) into individual files under `src/prompts/application/`:

- `classify.ts` — `APPLICATION_CLASSIFY_PROMPT`
- `field-extraction.ts` — `buildFieldExtractionPrompt`
- `auto-fill.ts` — `buildAutoFillPrompt`
- `question-batch.ts` — `buildQuestionBatchPrompt`
- `answer-parsing.ts` — `buildAnswerParsingPrompt`
- `confirmation.ts` — `buildConfirmationSummaryPrompt`
- `batch-email.ts` — `buildBatchEmailGenerationPrompt`
- `reply-intent.ts` — `buildReplyIntentClassificationPrompt`
- `field-explanation.ts` — `buildFieldExplanationPrompt`
- `pdf-mapping.ts` — `buildFlatPdfMappingPrompt`, `buildAcroFormMappingPrompt`, `buildLookupFillPrompt`
- `index.ts` — re-exports everything

Each file gets exactly one prompt function/constant. The prompt content is unchanged.

- [ ] **Step 3: Copy intent.ts**

Copy `src/prompts/intent.ts` unchanged.

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors from prompt files.

- [ ] **Step 5: Commit**

```bash
git add src/prompts/agent/ src/prompts/application/ src/prompts/intent.ts
git commit -m "feat: migrate agent, application, and intent prompts — split application.ts into modules"
```

---

## Task 12: Extraction — Extractor Runner + Coordinator

**Files:**
- Create: `src/extraction/extractor.ts`
- Create: `src/extraction/assembler.ts`
- Create: `src/extraction/coordinator.ts`
- Test: `src/__tests__/extraction/extractor.test.ts`
- Test: `src/__tests__/extraction/coordinator.test.ts`

This is the core of the agentic pipeline.

- [ ] **Step 1: Write extractor runner tests**

```ts
// src/__tests__/extraction/extractor.test.ts
import { describe, it, expect, vi } from "vitest";
import { runExtractor } from "../../extraction/extractor";
import { z } from "zod";

describe("runExtractor", () => {
  it("calls generateObject with prompt and schema, returns result", async () => {
    const schema = z.object({ name: z.string() });
    const generateObject = vi.fn().mockResolvedValue({
      object: { name: "Acme" },
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await runExtractor({
      name: "carrier_info",
      prompt: "Extract carrier info",
      schema,
      pdfBase64: "base64data",
      startPage: 1,
      endPage: 3,
      generateObject,
    });

    expect(result.data).toEqual({ name: "Acme" });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(generateObject).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Create extraction/extractor.ts**

```ts
// src/extraction/extractor.ts
import type { ZodSchema } from "zod";
import type { GenerateObject, TokenUsage, ConvertPdfToImagesFn } from "../core/types";
import { withRetry } from "../core/retry";
import { extractPageRange } from "./pdf";

export interface ExtractorParams<T> {
  name: string;
  prompt: string;
  schema: ZodSchema<T>;
  pdfBase64: string;
  startPage: number;
  endPage: number;
  generateObject: GenerateObject<T>;
  convertPdfToImages?: ConvertPdfToImagesFn;
  maxTokens?: number;
  providerOptions?: Record<string, unknown>;
}

export interface ExtractorResult<T> {
  name: string;
  data: T;
  usage?: TokenUsage;
}

/**
 * Run a single focused extractor against a page range of a PDF.
 * Handles page extraction, retry on rate limits, and schema validation.
 */
export async function runExtractor<T>(params: ExtractorParams<T>): Promise<ExtractorResult<T>> {
  const { name, prompt, schema, pdfBase64, startPage, endPage, generateObject, convertPdfToImages, maxTokens = 4096, providerOptions } = params;

  // Extract relevant pages
  const pagesPdf = await extractPageRange(pdfBase64, startPage, endPage);

  // Build the prompt with PDF context instruction
  const fullPrompt = convertPdfToImages
    ? `${prompt}\n\n[Document pages ${startPage}-${endPage} are provided as images above.]`
    : `${prompt}\n\n[Document pages ${startPage}-${endPage} are provided as a PDF file above.]`;

  const result = await withRetry(() =>
    generateObject({
      prompt: fullPrompt,
      schema,
      maxTokens,
      providerOptions,
    })
  );

  return {
    name,
    data: result.object,
    usage: result.usage,
  };
}
```

- [ ] **Step 3: Create extraction/assembler.ts**

```ts
// src/extraction/assembler.ts
import type { PolicyDocument, QuoteDocument, InsuranceDocument } from "../schemas/document";
import { sanitizeNulls } from "../core/sanitize";

/**
 * Assemble extracted results from shared memory into a validated document.
 * The memory is a Map<string, unknown> keyed by extractor name.
 */
export function assembleDocument(
  documentId: string,
  documentType: "policy" | "quote",
  memory: Map<string, unknown>,
): InsuranceDocument {
  const carrier = memory.get("carrier_info") as Record<string, unknown> | undefined;
  const insured = memory.get("named_insured") as Record<string, unknown> | undefined;
  const coverages = memory.get("coverage_limits") as Record<string, unknown> | undefined;
  const endorsements = memory.get("endorsements") as Record<string, unknown> | undefined;
  const exclusions = memory.get("exclusions") as Record<string, unknown> | undefined;
  const conditions = memory.get("conditions") as Record<string, unknown> | undefined;
  const premium = memory.get("premium_breakdown") as Record<string, unknown> | undefined;
  const declarations = memory.get("declarations") as Record<string, unknown> | undefined;
  const lossHistory = memory.get("loss_history") as Record<string, unknown> | undefined;
  const sections = memory.get("sections") as Record<string, unknown> | undefined;
  const supplementary = memory.get("supplementary") as Record<string, unknown> | undefined;
  const classify = memory.get("classify") as Record<string, unknown> | undefined;

  const base = {
    id: documentId,
    carrier: (carrier as any)?.carrierName ?? "Unknown",
    insuredName: (insured as any)?.insuredName ?? "Unknown",
    coverages: (coverages as any)?.coverages ?? [],
    policyTypes: (classify as any)?.policyTypes,
    // Spread all extracted fields from each extractor
    ...sanitizeNulls(carrier ?? {}),
    ...sanitizeNulls(insured ?? {}),
    ...sanitizeNulls(coverages ?? {}),
    ...sanitizeNulls(premium ?? {}),
    ...sanitizeNulls(supplementary ?? {}),
    endorsements: (endorsements as any)?.endorsements,
    exclusions: (exclusions as any)?.exclusions,
    conditions: (conditions as any)?.conditions,
    sections: (sections as any)?.sections,
    declarations: declarations ? sanitizeNulls(declarations) : undefined,
    ...sanitizeNulls(lossHistory ?? {}),
  };

  if (documentType === "policy") {
    return {
      ...base,
      type: "policy",
      policyNumber: (carrier as any)?.policyNumber ?? (insured as any)?.policyNumber ?? "Unknown",
      effectiveDate: (carrier as any)?.effectiveDate ?? (insured as any)?.effectiveDate ?? "Unknown",
      expirationDate: (carrier as any)?.expirationDate,
      policyTermType: (carrier as any)?.policyTermType,
    } as PolicyDocument;
  }

  return {
    ...base,
    type: "quote",
    quoteNumber: (carrier as any)?.quoteNumber ?? "Unknown",
    proposedEffectiveDate: (carrier as any)?.proposedEffectiveDate,
    proposedExpirationDate: (carrier as any)?.proposedExpirationDate,
    subjectivities: (coverages as any)?.subjectivities,
    underwritingConditions: (coverages as any)?.underwritingConditions,
    premiumBreakdown: (premium as any)?.premiumBreakdown,
  } as QuoteDocument;
}
```

- [ ] **Step 4: Create extraction/coordinator.ts**

```ts
// src/extraction/coordinator.ts
import type { GenerateText, GenerateObject, TokenUsage, ConvertPdfToImagesFn, LogFn } from "../core/types";
import type { InsuranceDocument } from "../schemas/document";
import type { DocumentChunk } from "../storage/chunk-types";
import { pLimit } from "../core/concurrency";
import { stripFences } from "../core/strip-fences";
import { withRetry } from "../core/retry";
import { getPdfPageCount, extractPageRange } from "./pdf";
import { runExtractor } from "./extractor";
import { assembleDocument } from "./assembler";
import { chunkDocument } from "./chunking";
import { getTemplate } from "../prompts/templates/index";
import { buildClassifyPrompt, ClassifyResultSchema } from "../prompts/coordinator/classify";
import { buildPlanPrompt, ExtractionPlanSchema } from "../prompts/coordinator/plan";
import { buildReviewPrompt, ReviewResultSchema } from "../prompts/coordinator/review";
// Import all extractor prompts + schemas
import * as extractors from "../prompts/extractors/index";

export interface ExtractorConfig {
  generateText: GenerateText;
  generateObject: GenerateObject;
  convertPdfToImages?: ConvertPdfToImagesFn;
  concurrency?: number;
  maxReviewRounds?: number;
  onTokenUsage?: (usage: TokenUsage) => void;
  onProgress?: (message: string) => void;
  log?: LogFn;
  providerOptions?: Record<string, unknown>;
}

export interface ExtractionResult {
  document: InsuranceDocument;
  chunks: DocumentChunk[];
  tokenUsage: TokenUsage;
}

/**
 * Create an extractor with the agentic extraction pipeline.
 */
export function createExtractor(config: ExtractorConfig) {
  const {
    generateText,
    generateObject,
    convertPdfToImages,
    concurrency = 2,
    maxReviewRounds = 2,
    onTokenUsage,
    onProgress,
    log,
    providerOptions,
  } = config;

  const limit = pLimit(concurrency);
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  function trackUsage(usage?: TokenUsage) {
    if (usage) {
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
      onTokenUsage?.(usage);
    }
  }

  async function extract(pdfBase64: string, documentId?: string): Promise<ExtractionResult> {
    const id = documentId ?? `doc-${Date.now()}`;
    const memory = new Map<string, unknown>();
    totalUsage = { inputTokens: 0, outputTokens: 0 };

    // Step 1: Classify
    onProgress?.("Classifying document...");
    const pageCount = await getPdfPageCount(pdfBase64);
    const classifyPages = await extractPageRange(pdfBase64, 1, Math.min(3, pageCount));

    const classifyResult = await withRetry(() =>
      generateObject({
        prompt: buildClassifyPrompt(),
        schema: ClassifyResultSchema,
        maxTokens: 512,
        providerOptions,
      })
    );
    trackUsage(classifyResult.usage);
    memory.set("classify", classifyResult.object);

    const { documentType, policyTypes } = classifyResult.object;
    const primaryType = policyTypes[0] ?? "other";
    const template = getTemplate(primaryType);

    // Step 2: Plan
    onProgress?.(`Planning extraction for ${primaryType} ${documentType}...`);
    const templateHints = [
      `Document type: ${primaryType} ${documentType}`,
      `Expected sections: ${template.expectedSections.join(", ")}`,
      `Page hints: ${Object.entries(template.pageHints).map(([k, v]) => `${k}: ${v}`).join("; ")}`,
      `Total pages: ${pageCount}`,
    ].join("\n");

    const planResult = await withRetry(() =>
      generateObject({
        prompt: buildPlanPrompt(templateHints),
        schema: ExtractionPlanSchema,
        maxTokens: 2048,
        providerOptions,
      })
    );
    trackUsage(planResult.usage);

    // Step 3: Dispatch extractors in parallel
    const tasks = planResult.object.tasks;
    onProgress?.(`Dispatching ${tasks.length} extractors...`);

    const extractorResults = await Promise.all(
      tasks.map((task) =>
        limit(async () => {
          const ext = extractors.getExtractor(task.extractorName);
          if (!ext) {
            await log?.(`Unknown extractor: ${task.extractorName}, skipping`);
            return null;
          }

          onProgress?.(`Extracting ${task.extractorName} (pages ${task.startPage}-${task.endPage})...`);
          try {
            const result = await runExtractor({
              name: task.extractorName,
              prompt: ext.buildPrompt(),
              schema: ext.schema,
              pdfBase64,
              startPage: task.startPage,
              endPage: task.endPage,
              generateObject,
              convertPdfToImages,
              maxTokens: ext.maxTokens ?? 4096,
              providerOptions,
            });
            trackUsage(result.usage);
            return result;
          } catch (error) {
            await log?.(`Extractor ${task.extractorName} failed: ${error}`);
            return null;
          }
        })
      )
    );

    // Write results to memory
    for (const result of extractorResults) {
      if (result) {
        memory.set(result.name, result.data);
      }
    }

    // Step 4: Review loop
    for (let round = 0; round < maxReviewRounds; round++) {
      const extractedKeys = [...memory.keys()].filter((k) => k !== "classify");
      const reviewResult = await withRetry(() =>
        generateObject({
          prompt: buildReviewPrompt(template.required, extractedKeys),
          schema: ReviewResultSchema,
          maxTokens: 1024,
          providerOptions,
        })
      );
      trackUsage(reviewResult.usage);

      if (reviewResult.object.complete || reviewResult.object.additionalTasks.length === 0) {
        onProgress?.("Extraction complete.");
        break;
      }

      // Dispatch follow-up tasks
      onProgress?.(`Review round ${round + 1}: dispatching ${reviewResult.object.additionalTasks.length} follow-up extractors...`);
      const followUpResults = await Promise.all(
        reviewResult.object.additionalTasks.map((task) =>
          limit(async () => {
            const ext = extractors.getExtractor(task.extractorName);
            if (!ext) return null;

            try {
              const result = await runExtractor({
                name: task.extractorName,
                prompt: ext.buildPrompt(),
                schema: ext.schema,
                pdfBase64,
                startPage: task.startPage,
                endPage: task.endPage,
                generateObject,
                convertPdfToImages,
                maxTokens: ext.maxTokens ?? 4096,
                providerOptions,
              });
              trackUsage(result.usage);
              return result;
            } catch (error) {
              await log?.(`Follow-up extractor ${task.extractorName} failed: ${error}`);
              return null;
            }
          })
        )
      );

      for (const result of followUpResults) {
        if (result) {
          memory.set(result.name, result.data);
        }
      }
    }

    // Step 5: Assemble
    onProgress?.("Assembling document...");
    const document = assembleDocument(id, documentType, memory);
    const chunks = chunkDocument(document);

    return { document, chunks, tokenUsage: totalUsage };
  }

  return { extract };
}
```

- [ ] **Step 5: Create extractors index file**

Create `src/prompts/extractors/index.ts` that exports a `getExtractor()` function mapping extractor names to their prompt + schema:

```ts
// src/prompts/extractors/index.ts
import type { ZodSchema } from "zod";

// Import all extractors
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

// Re-export all for direct use
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
```

- [ ] **Step 6: Write coordinator test**

```ts
// src/__tests__/extraction/coordinator.test.ts
import { describe, it, expect, vi } from "vitest";
import { createExtractor } from "../../extraction/coordinator";

describe("createExtractor", () => {
  it("returns an object with extract method", () => {
    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
    });
    expect(typeof extractor.extract).toBe("function");
  });
});
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/__tests__/extraction/`

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/extraction/ src/prompts/extractors/index.ts src/__tests__/extraction/
git commit -m "feat!: add agentic extraction pipeline — coordinator, extractor runner, assembler"
```

---

## Task 13: Storage — Interfaces + SQLite Reference Implementation

**Files:**
- Create: `src/storage/interfaces.ts`
- Create: `src/storage/sqlite/index.ts`
- Create: `src/storage/sqlite/document-store.ts`
- Create: `src/storage/sqlite/memory-store.ts`
- Create: `src/storage/sqlite/migrations.ts`
- Test: `src/__tests__/storage/sqlite.test.ts`

- [ ] **Step 1: Create storage/interfaces.ts**

```ts
// src/storage/interfaces.ts
import type { InsuranceDocument } from "../schemas/document";
import type { DocumentChunk, ConversationTurn, ChunkFilter, DocumentFilters } from "./chunk-types";

export interface DocumentStore {
  save(doc: InsuranceDocument): Promise<void>;
  get(id: string): Promise<InsuranceDocument | null>;
  query(filters: DocumentFilters): Promise<InsuranceDocument[]>;
  delete(id: string): Promise<void>;
}

export interface MemoryStore {
  addChunks(chunks: DocumentChunk[]): Promise<void>;
  search(query: string, options?: { limit?: number; filter?: ChunkFilter }): Promise<DocumentChunk[]>;
  addTurn(turn: ConversationTurn): Promise<void>;
  getHistory(conversationId: string, options?: { limit?: number }): Promise<ConversationTurn[]>;
  searchHistory(query: string, conversationId?: string): Promise<ConversationTurn[]>;
}
```

- [ ] **Step 2: Create storage/sqlite/migrations.ts**

```ts
// src/storage/sqlite/migrations.ts

export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  embedding BLOB,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_result TEXT,
  timestamp INTEGER NOT NULL,
  embedding BLOB
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(type);
CREATE INDEX IF NOT EXISTS idx_turns_conversation_id ON conversation_turns(conversation_id);
CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON conversation_turns(timestamp);
`;
```

- [ ] **Step 3: Create storage/sqlite/document-store.ts**

```ts
// src/storage/sqlite/document-store.ts
import type Database from "better-sqlite3";
import type { DocumentStore } from "../interfaces";
import type { InsuranceDocument } from "../../schemas/document";
import type { DocumentFilters } from "../chunk-types";

export function createSqliteDocumentStore(db: Database.Database): DocumentStore {
  return {
    async save(doc: InsuranceDocument): Promise<void> {
      db.prepare("INSERT OR REPLACE INTO documents (id, type, data) VALUES (?, ?, ?)").run(
        doc.id, doc.type, JSON.stringify(doc),
      );
    },

    async get(id: string): Promise<InsuranceDocument | null> {
      const row = db.prepare("SELECT data FROM documents WHERE id = ?").get(id) as { data: string } | undefined;
      return row ? JSON.parse(row.data) : null;
    },

    async query(filters: DocumentFilters): Promise<InsuranceDocument[]> {
      let sql = "SELECT data FROM documents WHERE 1=1";
      const params: unknown[] = [];

      if (filters.type) {
        sql += " AND type = ?";
        params.push(filters.type);
      }
      if (filters.carrier) {
        sql += " AND json_extract(data, '$.carrier') LIKE ?";
        params.push(`%${filters.carrier}%`);
      }
      if (filters.insuredName) {
        sql += " AND json_extract(data, '$.insuredName') LIKE ?";
        params.push(`%${filters.insuredName}%`);
      }
      if (filters.policyNumber) {
        sql += " AND json_extract(data, '$.policyNumber') = ?";
        params.push(filters.policyNumber);
      }
      if (filters.quoteNumber) {
        sql += " AND json_extract(data, '$.quoteNumber') = ?";
        params.push(filters.quoteNumber);
      }

      const rows = db.prepare(sql).all(...params) as { data: string }[];
      return rows.map((r) => JSON.parse(r.data));
    },

    async delete(id: string): Promise<void> {
      db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    },
  };
}
```

- [ ] **Step 4: Create storage/sqlite/memory-store.ts**

```ts
// src/storage/sqlite/memory-store.ts
import type Database from "better-sqlite3";
import type { MemoryStore } from "../interfaces";
import type { DocumentChunk, ConversationTurn, ChunkFilter } from "../chunk-types";
import type { EmbedText } from "../../core/types";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function createSqliteMemoryStore(db: Database.Database, embed: EmbedText): MemoryStore {
  return {
    async addChunks(chunks: DocumentChunk[]): Promise<void> {
      const stmt = db.prepare("INSERT OR REPLACE INTO chunks (id, document_id, type, text, metadata, embedding) VALUES (?, ?, ?, ?, ?, ?)");
      const insertMany = db.transaction((items: DocumentChunk[]) => {
        for (const chunk of items) {
          stmt.run(chunk.id, chunk.documentId, chunk.type, chunk.text, JSON.stringify(chunk.metadata), null);
        }
      });
      insertMany(chunks);

      // Generate embeddings in background
      for (const chunk of chunks) {
        try {
          const embedding = await embed(chunk.text);
          const buf = Buffer.from(new Float64Array(embedding).buffer);
          db.prepare("UPDATE chunks SET embedding = ? WHERE id = ?").run(buf, chunk.id);
        } catch {
          // Embedding failure is non-fatal
        }
      }
    },

    async search(query: string, options?: { limit?: number; filter?: ChunkFilter }): Promise<DocumentChunk[]> {
      const queryEmbedding = await embed(query);
      const limit = options?.limit ?? 10;

      let sql = "SELECT id, document_id, type, text, metadata, embedding FROM chunks WHERE embedding IS NOT NULL";
      const params: unknown[] = [];

      if (options?.filter?.documentId) {
        sql += " AND document_id = ?";
        params.push(options.filter.documentId);
      }
      if (options?.filter?.type) {
        sql += " AND type = ?";
        params.push(options.filter.type);
      }

      const rows = db.prepare(sql).all(...params) as Array<{
        id: string; document_id: string; type: string; text: string; metadata: string; embedding: Buffer;
      }>;

      // Score by cosine similarity
      const scored = rows.map((row) => {
        const stored = Array.from(new Float64Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 8));
        return {
          chunk: {
            id: row.id,
            documentId: row.document_id,
            type: row.type as DocumentChunk["type"],
            text: row.text,
            metadata: JSON.parse(row.metadata),
          },
          score: cosineSimilarity(queryEmbedding, stored),
        };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((s) => s.chunk);
    },

    async addTurn(turn: ConversationTurn): Promise<void> {
      const embedding = await embed(turn.content).catch(() => null);
      const buf = embedding ? Buffer.from(new Float64Array(embedding).buffer) : null;
      db.prepare(
        "INSERT INTO conversation_turns (id, conversation_id, role, content, tool_name, tool_result, timestamp, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(turn.id, turn.conversationId, turn.role, turn.content, turn.toolName ?? null, turn.toolResult ?? null, turn.timestamp, buf);
    },

    async getHistory(conversationId: string, options?: { limit?: number }): Promise<ConversationTurn[]> {
      const limit = options?.limit ?? 50;
      const rows = db.prepare(
        "SELECT id, conversation_id, role, content, tool_name, tool_result, timestamp FROM conversation_turns WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?"
      ).all(conversationId, limit) as Array<Record<string, unknown>>;

      return rows.reverse().map((r) => ({
        id: r.id as string,
        conversationId: r.conversation_id as string,
        role: r.role as ConversationTurn["role"],
        content: r.content as string,
        toolName: r.tool_name as string | undefined,
        toolResult: r.tool_result as string | undefined,
        timestamp: r.timestamp as number,
      }));
    },

    async searchHistory(query: string, conversationId?: string): Promise<ConversationTurn[]> {
      const queryEmbedding = await embed(query);

      let sql = "SELECT id, conversation_id, role, content, tool_name, tool_result, timestamp, embedding FROM conversation_turns WHERE embedding IS NOT NULL";
      const params: unknown[] = [];
      if (conversationId) {
        sql += " AND conversation_id = ?";
        params.push(conversationId);
      }

      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

      const scored = rows.map((row) => {
        const buf = row.embedding as Buffer;
        const stored = Array.from(new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8));
        return {
          turn: {
            id: row.id as string,
            conversationId: row.conversation_id as string,
            role: row.role as ConversationTurn["role"],
            content: row.content as string,
            toolName: row.tool_name as string | undefined,
            toolResult: row.tool_result as string | undefined,
            timestamp: row.timestamp as number,
          },
          score: cosineSimilarity(queryEmbedding, stored),
        };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 10).map((s) => s.turn);
    },
  };
}
```

- [ ] **Step 5: Create storage/sqlite/index.ts**

```ts
// src/storage/sqlite/index.ts
import type { EmbedText } from "../../core/types";
import type { DocumentStore } from "../interfaces";
import type { MemoryStore } from "../interfaces";
import { CREATE_TABLES } from "./migrations";
import { createSqliteDocumentStore } from "./document-store";
import { createSqliteMemoryStore } from "./memory-store";

export interface SqliteStoreOptions {
  path: string;
  embed: EmbedText;
}

export function createSqliteStore(options: SqliteStoreOptions): {
  documents: DocumentStore;
  memory: MemoryStore;
  close: () => void;
} {
  // Dynamic import to keep better-sqlite3 optional
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require("better-sqlite3");
  const db = new BetterSqlite3(options.path);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);

  return {
    documents: createSqliteDocumentStore(db),
    memory: createSqliteMemoryStore(db, options.embed),
    close: () => db.close(),
  };
}

export type { DocumentStore, MemoryStore } from "../interfaces";
export type { SqliteStoreOptions };
```

- [ ] **Step 6: Write SQLite integration tests**

```ts
// src/__tests__/storage/sqlite.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSqliteStore } from "../../storage/sqlite/index";
import type { PolicyDocument } from "../../schemas/document";

const mockEmbed = async (text: string): Promise<number[]> => {
  // Simple deterministic embedding for testing
  const hash = Array.from(text).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return Array.from({ length: 8 }, (_, i) => Math.sin(hash + i));
};

describe("SQLite store", () => {
  let store: ReturnType<typeof createSqliteStore>;

  beforeEach(() => {
    store = createSqliteStore({ path: ":memory:", embed: mockEmbed });
  });

  afterEach(() => {
    store.close();
  });

  const testPolicy: PolicyDocument = {
    id: "pol-1",
    type: "policy",
    carrier: "Acme Insurance",
    insuredName: "Test Corp",
    policyNumber: "POL-001",
    effectiveDate: "01/01/2026",
    coverages: [{ name: "GL", limit: "$1M" }],
  };

  it("saves and retrieves a document", async () => {
    await store.documents.save(testPolicy);
    const result = await store.documents.get("pol-1");
    expect(result).toMatchObject({ id: "pol-1", carrier: "Acme Insurance" });
  });

  it("queries by carrier", async () => {
    await store.documents.save(testPolicy);
    const results = await store.documents.query({ carrier: "Acme" });
    expect(results.length).toBe(1);
  });

  it("deletes a document", async () => {
    await store.documents.save(testPolicy);
    await store.documents.delete("pol-1");
    const result = await store.documents.get("pol-1");
    expect(result).toBeNull();
  });

  it("adds and searches chunks", async () => {
    await store.memory.addChunks([
      { id: "c1", documentId: "pol-1", type: "coverage", text: "General Liability $1M limit", metadata: { coverageName: "GL" } },
      { id: "c2", documentId: "pol-1", type: "carrier_info", text: "Carrier is State Farm", metadata: {} },
    ]);
    const results = await store.memory.search("liability coverage", { limit: 1 });
    expect(results.length).toBe(1);
    expect(results[0].type).toBe("coverage");
  });

  it("adds and retrieves conversation turns", async () => {
    await store.memory.addTurn({
      id: "t1", conversationId: "conv-1", role: "user",
      content: "What are the liability limits?", timestamp: Date.now(),
    });
    const history = await store.memory.getHistory("conv-1");
    expect(history.length).toBe(1);
    expect(history[0].content).toContain("liability limits");
  });
});
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/__tests__/storage/`

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/storage/ src/__tests__/storage/
git commit -m "feat: add storage interfaces + SQLite reference implementation"
```

---

## Task 14: Tools + Barrel Exports

**Files:**
- Copy: `src/tools/definitions.ts` (unchanged)
- Create: `src/tools/index.ts`
- Create: `src/index.ts` (new barrel)

- [ ] **Step 1: Copy tools unchanged**

Copy `src/tools/definitions.ts` and `src/tools/index.ts` as-is — no AI SDK dependency.

- [ ] **Step 2: Create new src/index.ts barrel**

```ts
// src/index.ts

// ── Core types ──
export type { GenerateText, GenerateObject, EmbedText, ConvertPdfToImagesFn, TokenUsage, LogFn } from "./core/types";

// ── Core utilities ──
export { withRetry } from "./core/retry";
export { pLimit } from "./core/concurrency";
export { stripFences } from "./core/strip-fences";
export { sanitizeNulls } from "./core/sanitize";

// ── Schemas (Zod) + derived types ──
export * from "./schemas/enums";
export * from "./schemas/shared";
export * from "./schemas/coverage";
export * from "./schemas/endorsement";
export * from "./schemas/exclusion";
export * from "./schemas/condition";
export * from "./schemas/parties";
export * from "./schemas/financial";
export * from "./schemas/loss-history";
export * from "./schemas/underwriting";
export * from "./schemas/declarations/index";
export * from "./schemas/document";
export * from "./schemas/platform";
export type { ContextKeyMapping } from "./schemas/context-keys";
export { CONTEXT_KEY_MAP } from "./schemas/context-keys";

// ── Extraction pipeline ──
export { createExtractor } from "./extraction/coordinator";
export type { ExtractorConfig, ExtractionResult } from "./extraction/coordinator";
export { chunkDocument } from "./extraction/chunking";

// ── PDF operations ──
export { getAcroFormFields, fillAcroForm, overlayTextOnPdf, extractPageRange, getPdfPageCount } from "./extraction/pdf";
export type { AcroFormFieldInfo, FieldMapping, TextOverlay } from "./extraction/pdf";

// ── Storage interfaces ──
export type { DocumentStore, MemoryStore } from "./storage/interfaces";
export type { DocumentChunk, ConversationTurn, ChunkFilter, DocumentFilters } from "./storage/chunk-types";

// ── Agent prompts ──
export {
  buildAgentSystemPrompt,
  buildIdentityPrompt,
  buildSafetyPrompt,
  buildFormattingPrompt,
  buildCoverageGapPrompt,
  buildCoiRoutingPrompt,
  buildQuotesPoliciesPrompt,
  buildConversationMemoryGuidance,
  buildIntentPrompt,
} from "./prompts/agent/index";

// ── Application prompts ──
export * from "./prompts/application/index";

// ── Intent classification ──
export { buildClassifyMessagePrompt } from "./prompts/intent";

// ── Tool definitions ──
export type { ToolDefinition } from "./tools/index";
export { DOCUMENT_LOOKUP_TOOL, COI_GENERATION_TOOL, COVERAGE_COMPARISON_TOOL, AGENT_TOOLS } from "./tools/index";

// ── Extraction prompts (for advanced use) ──
export { getExtractor } from "./prompts/extractors/index";
export { getTemplate } from "./prompts/templates/index";
export type { DocumentTemplate } from "./prompts/templates/index";
```

- [ ] **Step 3: Verify full build**

Run: `npm run build`

Expected: Build succeeds, produces dist/ with both entry points.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/tools/
git commit -m "feat!: new barrel exports for v6 — remove all v5 deprecated exports"
```

---

## Task 15: Remove Old Source Files + Final Cleanup

**Files:**
- Delete: `src/types/` (entire directory — replaced by `src/schemas/`)
- Delete: `src/prompts/extraction.ts` (replaced by `src/prompts/extractors/` + `src/prompts/coordinator/`)
- Delete: `src/prompts/application.ts` (replaced by `src/prompts/application/`)
- Delete: `src/prompts/agent.ts` (deprecated legacy, replaced by `src/prompts/agent/`)
- Delete: `src/prompts/classifier.ts` (deprecated legacy)
- Delete: `src/extraction/pipeline.ts` (replaced by coordinator + extractor + assembler)

- [ ] **Step 1: Remove old files**

Delete all files listed above. The new implementations in `src/schemas/`, `src/prompts/extractors/`, `src/prompts/coordinator/`, `src/prompts/application/`, and `src/extraction/coordinator.ts` replace them.

- [ ] **Step 2: Verify build still works**

Run: `npm run build && npm run typecheck`

Expected: Clean build, no type errors.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat!: remove v5 source files — types/, pipeline.ts, monolithic prompts, deprecated exports"
```

---

## Task 16: Update CLAUDE.md + README

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Update CLAUDE.md to reflect the v6 architecture — new file structure, callback-based provider model, agentic extraction, Zod schemas, storage interfaces. Remove all references to Vercel AI SDK, `ModelConfig`, `LanguageModel`, fixed 4-pass pipeline, deprecated exports.

Key sections to update:
- Overview: mention callback-based provider model, Zod schemas, SQLite storage
- Architecture: describe coordinator/worker pattern, extraction memory, chunking
- Model Configuration: replace with callback types section
- Key Patterns: update for new structure

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for v6 architecture"
```

---

## Task 17: Final Verification

- [ ] **Step 1: Full build**

Run: `npm run build`

Expected: Clean build, both entry points (main + storage/sqlite).

- [ ] **Step 2: Type check**

Run: `npm run typecheck`

Expected: Zero errors.

- [ ] **Step 3: All tests**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 4: Verify exports**

Run: `node -e "const sdk = require('./dist/index.js'); console.log(Object.keys(sdk).sort().join(', '))"`

Expected: Lists all exported names — `createExtractor`, `chunkDocument`, `PolicyDocumentSchema`, `buildAgentSystemPrompt`, etc. No v5 exports like `extractFromPdf`, `ModelConfig`, `createUniformModelConfig`.

- [ ] **Step 5: Verify SQLite subpath export**

Run: `node -e "const s = require('./dist/storage-sqlite.js'); console.log(Object.keys(s))"`

Expected: Lists `createSqliteStore`.

- [ ] **Step 6: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore: final v6 verification and fixups"
```
