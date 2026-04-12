export const commercialPropertyReviewFixture = {
  formInventory: {
    forms: [
      {
        formNumber: "PR5070CF",
        title: "Commercial Property Coverage Form",
        formType: "coverage" as const,
        pageStart: 7,
        pageEnd: 36,
      },
      {
        formNumber: "PR068END",
        title: "Leasehold Interest",
        formType: "endorsement" as const,
        pageStart: 37,
        pageEnd: 38,
      },
    ],
  },
  coverageLimits: {
    coverages: [
      {
        name: "Business Personal Property Coverage",
        limit: "$350,804",
        deductible: "$2,500",
        formNumber: "PR5070CF",
        pageNumber: 1,
        sectionRef: "Commercial Property Declarations",
        originalContent: "Business Personal Property Coverage | $350,804 | $2,500",
      },
      {
        name: "Business Personal Property Coverage",
        limit: "As stated in the Commercial Property Declarations",
        formNumber: "PR5070CF",
        pageNumber: 24,
        sectionRef: "Commercial Property Coverage Form",
        originalContent: "The applicable Limit of Insurance shown in the Commercial Property Declarations",
      },
    ],
  },
  conditions: {
    conditions: [
      {
        name: "Appraisal",
        conditionType: "appraisal",
        content: "2. Appraisal.................................................................................................................................................19",
        pageNumber: 2,
      },
    ],
  },
  endorsements: {
    endorsements: [
      {
        formNumber: "PR068END",
        title: "LEASEHOLD INTEREST",
        endorsementType: "broadening",
        content: "THIS ENDORSEMENT CHANGES THE POLICY.",
        pageStart: 37,
        pageEnd: 38,
      },
    ],
  },
};
