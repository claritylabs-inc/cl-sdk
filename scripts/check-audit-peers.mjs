import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

// Install the packed public artifact in isolated consumers, not source aliases.
const scratch = mkdtempSync(join(tmpdir(), "cl-sdk-audit-peers-"));
const root = process.cwd();
const npm = (args, cwd = root) =>
  execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
try {
  const pack = JSON.parse(
    npm(["pack", "--json", "--pack-destination", scratch]),
  )[0];
  for (const peer of ["3.25.76", "4.3.6"]) {
    const consumer = join(scratch, `zod-${peer}`);
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    npm(
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefer-online",
        join(scratch, pack.filename),
        `zod@${peer}`,
        "esbuild@0.27.4",
      ],
      consumer,
    );
    copyFileSync(
      join(root, "scripts/check-decisions-bundle.mjs"),
      join(consumer, "smoke.mjs"),
    );
    execFileSync(process.execPath, [join(consumer, "smoke.mjs")], {
      cwd: consumer,
      stdio: "inherit",
    });
    // Existing SDK schemas have broader Zod-version declaration differences.
    // This checks the new public report/helper contract with the host's normal
    // skipLibCheck setting, rather than promising whole-package DTS migration.
    writeFileSync(
      join(consumer, "smoke.ts"),
      `
import { auditExtractionEvidence, parseExtractionEvidenceAudit, type ExtractionEvidenceAudit } from "@claritylabs/cl-sdk/extraction-audit";
const report: ExtractionEvidenceAudit = parseExtractionEvidenceAudit({});
const status: "not_run" | "shadow" | "verified_text" | "unresolved" = report.status;
const threshold: number | undefined = report.acceptanceThreshold;
const count: number = report.forward.total;
const receipt: string[] = report.metrics.batches[0].uncitedFactUnitIds;
type Result = Awaited<ReturnType<typeof auditExtractionEvidence>>;
declare const result: Result;
const audit: ExtractionEvidenceAudit = result.audit;
// @ts-expect-error Public result must not become any under Zod 4.
const invalid: number = report.status;
void [status, threshold, count, receipt, audit, invalid];
`,
    );
    execFileSync(
      process.execPath,
      [
        resolve(root, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "nodenext",
        "--target",
        "es2022",
        "smoke.ts",
      ],
      { cwd: consumer, stdio: "inherit" },
    );
    const installed = JSON.parse(
      readFileSync(join(consumer, "node_modules/zod/package.json"), "utf8"),
    );
    console.log(
      `Packed artifact ${pack.filename}: Zod ${installed.version} active/browser/ESM/CJS and public audit types passed.`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
