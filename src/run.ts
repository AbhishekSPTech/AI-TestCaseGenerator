/**
 * The whole workflow: load story → validate → generate → check coverage → export.
 * Never exits the process; main.ts turns the result (or a thrown error) into an exit code.
 * Tests pass a fake `llm` so the workflow runs without API keys.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeCoverage, type Coverage } from "./coverage.js";
import { exportAzureCsv } from "./exporters.js";
import { createLlm, generateTestCases, type Llm, type Provider } from "./generator.js";
import { printSummary, verdict, writeReviewFile } from "./reporter.js";
import { type Ask, fetchAzureStory, loadFromFile, promptForStory } from "./sources.js";
import type { Requirement, TestSuite } from "./types.js";
import { validateRequirement } from "./validation.js";

export type StorySource =
  | { kind: "azure"; id: string }
  | { kind: "file"; path: string }
  | { kind: "prompt"; ask?: Ask }; // ask: share the caller's terminal reader (console app)

export interface RunOptions {
  source: StorySource;
  outDir: string;
  provider: Provider;
  strict: boolean; // fail when an acceptance criterion is uncovered or there are none
  instructions?: string;
  storyId?: string; // overrides the id of a manual story
}

export interface RunDeps {
  llm?: Llm; // default: createLlm(options.provider)
  log?: (msg: string) => void;
}

export interface RunResult {
  exitCode: 0 | 1;
  req: Requirement;
  suite: TestSuite;
  coverage: Coverage;
  csvPath: string;
  reviewPath: string;
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example).`);
  return v;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function loadStory(source: StorySource): Promise<Requirement> {
  switch (source.kind) {
    case "azure":
      return fetchAzureStory(requireEnv("ADO_ORG"), requireEnv("ADO_PROJECT"), source.id, requireEnv("ADO_PAT"));
    case "file":
      return loadFromFile(source.path);
    case "prompt":
      return promptForStory(source.ask);
  }
}

export async function run(opts: RunOptions, deps: RunDeps = {}): Promise<RunResult> {
  const log = deps.log ?? console.log;
  // Resolve the LLM first so a missing key fails before any network call.
  const llm = deps.llm ?? createLlm(opts.provider);

  // 1. Input — rejected here, before paying for an LLM call, if it can't be checked
  const req = await loadStory(opts.source);
  if (opts.storyId?.trim() && req.source === "manual") req.id = opts.storyId.trim();
  log(`Loaded ${req.source} story ${req.id}: ${req.title}`);
  log(`Found ${req.criteria.length} acceptance criteria`);
  const storyWarnings = validateRequirement(req, opts.strict);

  // 2. LLM
  const suite = await generateTestCases(req, llm, { extraInstructions: opts.instructions, log });
  suite.warnings = [...storyWarnings, ...(suite.warnings ?? [])];
  const coverage = computeCoverage(req.criteria, suite.test_cases);
  printSummary(suite, coverage, log);

  // 3. Export — files are written even when coverage fails, so the gaps can be reviewed
  const out = resolve(opts.outDir);
  mkdirSync(out, { recursive: true });
  const stem = req.source === "azure" ? `azure_${req.id}` : `manual_${slug(req.title) || "story"}`;
  const csvPath = join(out, `${stem}_azure_import.csv`);
  const reviewPath = join(out, `${stem}_review.txt`);
  exportAzureCsv(suite, req, csvPath);
  writeReviewFile(reviewPath, req, suite, coverage, opts.strict);
  log(verdict(coverage, opts.strict));

  const exitCode = opts.strict && coverage.uncovered.length ? 1 : 0;
  return { exitCode, req, suite, coverage, csvPath, reviewPath };
}
