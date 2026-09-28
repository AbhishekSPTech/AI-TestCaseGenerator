/**
 * Test Case Generator Agent
 *
 *   npm start -- --azure 12345            # read user story 12345 from the Azure board
 *   npm start -- --file story.txt         # manual input from a text file
 *   npm start                             # manual input typed into the terminal
 *
 * Output (in ./output, change with --out):
 *   <story>_azure_import.csv   Azure Test Plans > test suite > "Import test cases from CSV"
 *   <story>_review.txt         coverage, open questions, assumptions — read before importing
 *
 * Exit code 1 if any acceptance criterion has no test case (disable with --no-strict).
 */
import "dotenv/config";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { computeCoverage } from "./coverage.js";
import { exportAzureCsv } from "./exporters.js";
import { generateTestCases } from "./generator.js";
import { printSummary, writeReviewFile } from "./reporter.js";
import { fetchAzureStory, loadFromFile, promptForStory } from "./sources.js";
import type { Requirement } from "./types.js";

function env(name: string): string {
  const v = process.env[name] ?? "";
  if (!v) {
    console.error(`Missing environment variable ${name} (see .env.example)`);
    process.exit(1);
  }
  return v;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function main(): Promise<void> {
  const { values: a } = parseArgs({
    options: {
      azure: { type: "string" },
      file: { type: "string" },
      out: { type: "string", default: "output" },
      instructions: { type: "string", default: "" },
      "no-strict": { type: "boolean", default: false },
    },
  });
  if (a.azure && a.file) {
    console.error("Use either --azure <id> or --file <path> (or neither, to type the story in).");
    process.exit(1);
  }

  // 1. Input
  let req: Requirement;
  if (a.azure) {
    req = await fetchAzureStory(env("ADO_ORG"), env("ADO_PROJECT"), a.azure, env("ADO_PAT"));
  } else if (a.file) {
    req = loadFromFile(a.file);
  } else {
    req = await promptForStory();
  }
  console.log(`Loaded ${req.source} story ${req.id}: ${req.title}`);
  console.log(`Found ${req.criteria.length} acceptance criteria`);

  // 2. LLM
  const suite = await generateTestCases(req, process.env.CLAUDE_MODEL || "claude-sonnet-5", a.instructions);
  const coverage = computeCoverage(req.criteria, suite.test_cases);
  printSummary(suite, coverage);

  // 3. Export
  const out = resolve(a.out!);
  mkdirSync(out, { recursive: true });
  const stem = req.source === "azure" ? `azure_${req.id}` : `manual_${slug(req.title) || "story"}`;
  const csvPath = join(out, `${stem}_azure_import.csv`);
  const reviewPath = join(out, `${stem}_review.txt`);
  exportAzureCsv(suite, req, csvPath);
  writeReviewFile(reviewPath, req, suite, coverage);
  console.log(`Azure import CSV: ${csvPath}`);
  console.log(`Review notes:     ${reviewPath}`);
  console.log(`Import via Azure Test Plans > your test suite > "Import test cases from CSV".`);

  if (coverage.uncovered.length && !a["no-strict"]) {
    console.error(`Acceptance criteria not covered: ${coverage.uncovered.join(", ")} (exit code 1; use --no-strict to ignore)`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
