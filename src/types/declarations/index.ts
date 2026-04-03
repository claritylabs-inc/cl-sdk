// Declarations — typed discriminated union for line-specific policy data

export type { DwellingDetails, DriverRecord, PersonalVehicleDetails, Declarations } from "./shared";

export type {
  HomeownersDeclarations,
  PersonalAutoDeclarations,
  DwellingFireDeclarations,
  FloodDeclarations,
  EarthquakeDeclarations,
  PersonalUmbrellaDeclarations,
  PersonalArticlesDeclarations,
  WatercraftDeclarations,
  RecreationalVehicleDeclarations,
  FarmRanchDeclarations,
  TitleDeclarations,
  PetDeclarations,
  TravelDeclarations,
  IdentityTheftDeclarations,
} from "./personal";

export type {
  GLDeclarations,
  CommercialPropertyDeclarations,
  CommercialAutoDeclarations,
  WorkersCompDeclarations,
  UmbrellaExcessDeclarations,
  ProfessionalLiabilityDeclarations,
  CyberDeclarations,
  DODeclarations,
  CrimeDeclarations,
} from "./commercial";
