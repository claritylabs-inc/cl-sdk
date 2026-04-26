#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageName = "@claritylabs/cl-sdk-mcp";
const packageJsonPath = resolve("mcp/package.json");
const currentVersion = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version);
  if (!match) return null;
  return match.slice(1, 4).map((part) => Number(part));
}

function compareVersions(a, b) {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (parsedA[index] > parsedB[index]) return 1;
    if (parsedA[index] < parsedB[index]) return -1;
  }
  return 0;
}

function npmJson(args) {
  const output = execFileSync("npm", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  return output ? JSON.parse(output) : null;
}

function npm(args) {
  execFileSync("npm", args, {
    stdio: "inherit",
  });
}

let publishedVersions = [];
try {
  const versions = npmJson(["view", packageName, "versions", "--json"]);
  publishedVersions = Array.isArray(versions) ? versions : versions ? [versions] : [];
} catch {
  console.log(`${packageName} has no published versions yet.`);
  process.exit(0);
}

const versionsToUnpublish = publishedVersions
  .filter((version) => compareVersions(version, currentVersion) > 0)
  .sort(compareVersions)
  .reverse();

if (versionsToUnpublish.length === 0) {
  console.log(`No ${packageName} versions are higher than ${currentVersion}.`);
  process.exit(0);
}

console.log(`Current ${packageName} version: ${currentVersion}`);
console.log(`Unpublishing higher historical versions: ${versionsToUnpublish.join(", ")}`);

for (const version of versionsToUnpublish) {
  const spec = `${packageName}@${version}`;
  console.log(`\nUnpublishing ${spec}...`);
  try {
    npm(["unpublish", spec, "--force"]);
  } catch (error) {
    console.error(`\nFailed to unpublish ${spec}.`);
    console.error("npm may reject deleting old versions that do not meet its unpublish policy.");
    console.error("If that happens, remove the version through npm support or another npm admin intervention before retrying this release.");
    process.exit(error.status || 1);
  }
}

console.log(`\nPruned ${versionsToUnpublish.length} higher historical ${packageName} version(s).`);
