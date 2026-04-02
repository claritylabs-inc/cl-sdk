import type { EndorsementType, EndorsementPartyRole } from "./enums";
import type { Address } from "./shared";

export interface EndorsementParty {
  name: string;
  role: EndorsementPartyRole;
  address?: Address;
  relationship?: string;
  scope?: string;
}

export interface Endorsement {
  formNumber: string;
  editionDate?: string;
  title: string;
  endorsementType: EndorsementType;
  effectiveDate?: string;
  affectedCoverageParts?: string[];
  namedParties?: EndorsementParty[];
  keyTerms?: string[];
  premiumImpact?: string;
  content: string;
  pageStart: number;
  pageEnd?: number;
}
