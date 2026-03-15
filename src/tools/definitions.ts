// Claude tool_use-compatible schema definitions (schema only, no implementations)

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const DOCUMENT_LOOKUP_TOOL: ToolDefinition = {
  name: "document_lookup",
  description:
    "Search and retrieve an insurance policy or quote by ID, policy number, carrier name, or free-text query. Returns the full document with coverages, sections, and metadata.",
  input_schema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Exact document ID to retrieve.",
      },
      query: {
        type: "string",
        description:
          "Free-text search query (e.g. carrier name, policy number, coverage type). Used when ID is not known.",
      },
      documentType: {
        type: "string",
        enum: ["policy", "quote"],
        description: "Filter by document type. Omit to search both.",
      },
    },
  },
};

export const COI_GENERATION_TOOL: ToolDefinition = {
  name: "coi_generation",
  description:
    "Request generation of a Certificate of Insurance (COI) for a specific policy. Returns a task ID that can be polled for completion.",
  input_schema: {
    type: "object",
    properties: {
      policyId: {
        type: "string",
        description: "The ID of the policy to generate a COI for.",
      },
      holderName: {
        type: "string",
        description: "Name of the certificate holder (the requesting third party).",
      },
      holderAddress: {
        type: "string",
        description: "Address of the certificate holder.",
      },
      additionalInsured: {
        type: "boolean",
        description: "Whether to add the holder as an additional insured.",
      },
    },
    required: ["policyId", "holderName"],
  },
};

export const COVERAGE_COMPARISON_TOOL: ToolDefinition = {
  name: "coverage_comparison",
  description:
    "Compare coverages across two or more insurance documents (policies and/or quotes). Returns a side-by-side comparison of coverage types, limits, and deductibles.",
  input_schema: {
    type: "object",
    properties: {
      documentIds: {
        type: "array",
        items: { type: "string" },
        description: "Array of document IDs (policies or quotes) to compare.",
      },
      coverageTypes: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional filter: only compare these coverage types (e.g. 'General Liability', 'Workers Compensation'). Omit to compare all.",
      },
    },
    required: ["documentIds"],
  },
};

export const AGENT_TOOLS: ToolDefinition[] = [
  DOCUMENT_LOOKUP_TOOL,
  COI_GENERATION_TOOL,
  COVERAGE_COMPARISON_TOOL,
];
