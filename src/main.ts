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
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { computeCoverage } from "./coverage.js";
import { exportAzureCsv } from "./exporters.js";
import { generateTestCases, PROVIDERS, type Provider } from "./generator.js";
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

const USAGE = `Usage:
  npm start -- --azure <work item id>   read the user story from the Azure board
  npm start -- --file <path>            manual input from a text file (e.g. samples/login_story.txt)
  npm start                             type the user story in
Options: --out <dir>  --instructions "<extra guidance>"  --no-strict
         --story-id <id>   user story id for manual input (prefixes test case titles: "<id> | ...")
         --provider auto|claude|azure-openai   (default: LLM_PROVIDER in .env, else auto)`;

/** Accept "story.txt" when the file lives in samples/. */
function resolveStoryFile(path: string): string {
  if (existsSync(path)) return path;
  const inSamples = join("samples", path);
  if (existsSync(inSamples)) return inSamples;
  console.error(`File not found: ${path}\n\n${USAGE}`);
  process.exit(1);
}

function parseCli() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        azure: { type: "string" },
        file: { type: "string" },
        out: { type: "string", default: "output" },
        instructions: { type: "string", default: "" },
        "no-strict": { type: "boolean", default: false },
        provider: { type: "string" },
        "story-id": { type: "string" },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const opt = msg.match(/'(--[^']+)'/)?.[1];
    const hint = opt && /\.\w+$/.test(opt) ? `\nDid you mean: npm start -- --file ${opt.slice(2)}` : "";
    console.error(`${msg}${hint}\n\n${USAGE}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { values: a, positionals } = parseCli();
  if (!a.file && positionals.length === 1) a.file = positionals[0]; // npm start -- story.txt
  if (a.file) a.file = resolveStoryFile(a.file);
  if (a.azure && a.file) {
    console.error("Use either --azure <id> or --file <path> (or neither, to type the story in).");
    process.exit(1);
  }
  const provider = (a.provider || process.env.LLM_PROVIDER || "auto").trim().toLowerCase() as Provider;
  if (!PROVIDERS.includes(provider)) {
    console.error(`Unknown LLM provider "${provider}". Use one of: ${PROVIDERS.join(", ")}.`);
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
  if (a["story-id"] && req.source === "manual") req.id = a["story-id"].trim();
  console.log(`Loaded ${req.source} story ${req.id}: ${req.title}`);
  console.log(`Found ${req.criteria.length} acceptance criteria`);

  // 2. LLM
  const suite = await generateTestCases(req, provider, a.instructions);
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
