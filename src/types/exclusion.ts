export interface Exclusion {
  name: string;
  formNumber?: string;
  excludedPerils?: string[];
  isAbsolute?: boolean;
  exceptions?: string[];
  buybackAvailable?: boolean;
  buybackEndorsement?: string;
  appliesTo?: string[];
  content: string;
  pageNumber?: number;
}
