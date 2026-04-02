// Shared interfaces used across multiple domain types

import type { RatingBasisType } from "./enums";

export interface Address {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export interface Contact {
  name?: string;
  title?: string;
  type?: string;
  phone?: string;
  fax?: string;
  email?: string;
  address?: Address;
  hours?: string;
}

export interface FormReference {
  formNumber: string;
  editionDate?: string;
  title?: string;
  formType: "coverage" | "endorsement" | "declarations" | "application" | "notice" | "other";
}

export interface TaxFeeItem {
  name: string;
  amount: string;
  type?: "tax" | "fee" | "surcharge" | "assessment";
  description?: string;
}

export interface RatingBasis {
  type: RatingBasisType;
  amount?: string;
  description?: string;
}

export interface Sublimit {
  name: string;
  limit: string;
  appliesTo?: string;
  deductible?: string;
}

export interface SharedLimit {
  description: string;
  limit: string;
  coverageParts: string[];
}

export interface ExtendedReportingPeriod {
  basicDays?: number;
  supplementalYears?: number;
  supplementalPremium?: string;
}

export interface NamedInsured {
  name: string;
  relationship?: string;
  address?: Address;
}
