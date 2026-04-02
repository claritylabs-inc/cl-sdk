import type { ClaimStatus } from "./enums";

export interface ClaimRecord {
  dateOfLoss: string;
  claimNumber?: string;
  description: string;
  status: ClaimStatus;
  paid?: string;
  reserved?: string;
  incurred?: string;
  claimant?: string;
  coverageLine?: string;
}

export interface LossSummary {
  period?: string;
  totalClaims?: number;
  totalIncurred?: string;
  totalPaid?: string;
  totalReserved?: string;
  lossRatio?: string;
}

export interface ExperienceMod {
  factor: number;
  effectiveDate?: string;
  state?: string;
}
