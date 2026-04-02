import type { AdmittedStatus } from "./enums";
import type { Address } from "./shared";

export interface InsurerInfo {
  legalName: string;
  naicNumber?: string;
  amBestRating?: string;
  amBestNumber?: string;
  admittedStatus?: AdmittedStatus;
  stateOfDomicile?: string;
}

export interface ProducerInfo {
  agencyName: string;
  contactName?: string;
  licenseNumber?: string;
  phone?: string;
  email?: string;
  address?: Address;
}
