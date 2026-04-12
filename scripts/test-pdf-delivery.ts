/**
 * Diagnostic test: verify PDF content is actually delivered to generateObject calls.
 *
 * Usage: npx tsx scripts/test-pdf-delivery.ts <path-to-pdf>
 */
import { readFileSync } from "fs";
import { createExtractor } from "../src/extraction/coordinator";
import type { GenerateText, GenerateObject } from "../src/core/types";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: npx tsx scripts/test-pdf-delivery.ts <path-to-pdf>");
  process.exit(1);
}

const pdfBase64 = readFileSync(pdfPath).toString("base64");
console.log(`Loaded PDF: ${pdfPath} (${(pdfBase64.length * 0.75 / 1024).toFixed(0)} KB)`);

// Track what each call receives
const calls: Array<{
  step: string;
  hasPdfBase64: boolean;
  hasPrismPdfBase64: boolean;
  hasImages: boolean;
  pdfSize: number | null;
  promptSnippet: string;
}> = [];

let callIndex = 0;

const mockGenerateText: GenerateText = async ({ prompt, providerOptions }) => {
  calls.push({
    step: `generateText#${callIndex++}`,
    hasPdfBase64: !!providerOptions?.pdfBase64,
    hasPrismPdfBase64: !!(providerOptions as any)?.prismPdfBase64,
    hasImages: !!providerOptions?.images,
    pdfSize: providerOptions?.pdfBase64
      ? (providerOptions.pdfBase64 as string).length
      : null,
    promptSnippet: prompt.slice(0, 80),
  });
  return { text: "", usage: { inputTokens: 0, outputTokens: 0 } };
};

const mockGenerateObject: GenerateObject = async ({
  prompt,
  schema,
  providerOptions,
}) => {
  const step = `generateObject#${callIndex++}`;
  calls.push({
    step,
    hasPdfBase64: !!providerOptions?.pdfBase64,
    hasPrismPdfBase64: !!(providerOptions as any)?.prismPdfBase64,
    hasImages: !!providerOptions?.images,
    pdfSize: providerOptions?.pdfBase64
      ? (providerOptions.pdfBase64 as string).length
      : null,
    promptSnippet: prompt.slice(0, 80),
  });

  // Return minimal valid responses for each pipeline step
  const promptLower = prompt.toLowerCase();

  if (promptLower.includes("classifying") || promptLower.includes("classify")) {
    return {
      object: {
        documentType: "policy",
        policyTypes: ["commercial_property"],
        confidence: 0.9,
      },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  if (promptLower.includes("plan")) {
    return {
      object: {
        tasks: [
          {
            extractorName: "carrier_info",
            startPage: 1,
            endPage: 2,
            description: "Extract carrier info",
          },
        ],
      },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  if (promptLower.includes("review") || promptLower.includes("complete")) {
    return {
      object: { complete: true, missingFields: [], additionalTasks: [] },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  // Default extractor response
  if (promptLower.includes("carrier")) {
    return {
      object: { carrierName: "MOCK_CARRIER" },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  return {
    object: {},
    usage: { inputTokens: 0, outputTokens: 0 },
  };
};

async function main() {
  const extractor = createExtractor({
    generateText: mockGenerateText,
    generateObject: mockGenerateObject,
    log: async (msg) => console.log(`  [log] ${msg}`),
    onProgress: (msg) => console.log(`  [progress] ${msg}`),
  });

  console.log("\n--- Running extraction pipeline ---\n");

  try {
    await extractor.extract(pdfBase64, "test-doc");
  } catch (e) {
    // Expected — mock responses won't satisfy all schemas
    console.log(`\n  Pipeline ended: ${(e as Error).message?.slice(0, 100)}`);
  }

  console.log("\n--- PDF Delivery Report ---\n");
  console.log(
    "Step".padEnd(25),
    "pdfBase64".padEnd(12),
    "prismPdf".padEnd(12),
    "images".padEnd(10),
    "PDF Size".padEnd(12),
    "Prompt",
  );
  console.log("-".repeat(110));

  for (const c of calls) {
    console.log(
      c.step.padEnd(25),
      (c.hasPdfBase64 ? "YES" : "NO").padEnd(12),
      (c.hasPrismPdfBase64 ? "YES" : "NO").padEnd(12),
      (c.hasImages ? "YES" : "NO").padEnd(10),
      (c.pdfSize ? `${(c.pdfSize * 0.75 / 1024).toFixed(0)} KB` : "-").padEnd(12),
      c.promptSnippet,
    );
  }

  const hasPdf = calls.some((c) => c.hasPdfBase64);
  console.log(
    `\n${hasPdf ? "✅ PDF content IS being delivered to model calls" : "❌ PDF content is NOT being delivered — model is blind!"}`,
  );
}

main().catch(console.error);
