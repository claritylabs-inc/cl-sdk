import { z } from "zod";
import {
  HomeownersDeclarationsSchema,
  PersonalAutoDeclarationsSchema,
  DwellingFireDeclarationsSchema,
  FloodDeclarationsSchema,
  EarthquakeDeclarationsSchema,
  PersonalUmbrellaDeclarationsSchema,
  PersonalArticlesDeclarationsSchema,
  WatercraftDeclarationsSchema,
  RecreationalVehicleDeclarationsSchema,
  FarmRanchDeclarationsSchema,
  TitleDeclarationsSchema,
  PetDeclarationsSchema,
  TravelDeclarationsSchema,
  IdentityTheftDeclarationsSchema,
} from "./personal";
import {
  GLDeclarationsSchema,
  CommercialPropertyDeclarationsSchema,
  CommercialAutoDeclarationsSchema,
  WorkersCompDeclarationsSchema,
  UmbrellaExcessDeclarationsSchema,
  ProfessionalLiabilityDeclarationsSchema,
  CyberDeclarationsSchema,
  DODeclarationsSchema,
  CrimeDeclarationsSchema,
} from "./commercial";

export const DeclarationsSchema = z.discriminatedUnion("line", [
  // Personal lines
  HomeownersDeclarationsSchema,
  PersonalAutoDeclarationsSchema,
  DwellingFireDeclarationsSchema,
  FloodDeclarationsSchema,
  EarthquakeDeclarationsSchema,
  PersonalUmbrellaDeclarationsSchema,
  PersonalArticlesDeclarationsSchema,
  WatercraftDeclarationsSchema,
  RecreationalVehicleDeclarationsSchema,
  FarmRanchDeclarationsSchema,
  TitleDeclarationsSchema,
  PetDeclarationsSchema,
  TravelDeclarationsSchema,
  IdentityTheftDeclarationsSchema,
  // Commercial lines
  GLDeclarationsSchema,
  CommercialPropertyDeclarationsSchema,
  CommercialAutoDeclarationsSchema,
  WorkersCompDeclarationsSchema,
  UmbrellaExcessDeclarationsSchema,
  ProfessionalLiabilityDeclarationsSchema,
  CyberDeclarationsSchema,
  DODeclarationsSchema,
  CrimeDeclarationsSchema,
]);
export type Declarations = z.infer<typeof DeclarationsSchema>;

export * from "./shared";
export * from "./personal";
export * from "./commercial";
