import { z } from "zod";
import { AdmittedStatusSchema } from "./enums";
import { AddressSchema } from "./shared";

export const InsurerInfoSchema = z.object({
  legalName: z.string(),
  naicNumber: z.string().optional(),
  amBestRating: z.string().optional(),
  amBestNumber: z.string().optional(),
  admittedStatus: AdmittedStatusSchema.optional(),
  stateOfDomicile: z.string().optional(),
});
export type InsurerInfo = z.infer<typeof InsurerInfoSchema>;

export const ProducerInfoSchema = z.object({
  agencyName: z.string(),
  contactName: z.string().optional(),
  licenseNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: AddressSchema.optional(),
});
export type ProducerInfo = z.infer<typeof ProducerInfoSchema>;
