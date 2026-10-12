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
 * Exit code 1 if any acceptance criterion has no test case, if the story has no acceptance
 * criteria, or on any error (the coverage checks are relaxed with --no-strict).
 * The workflow itself lives in run.ts; this file only parses arguments and sets the exit code.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { PROVIDERS, type Provider } from "./generator.js";
import { run, type RunOptions } from "./run.js";
import { resolveStoryFile } from "./sources.js";

const USAGE = `Usage:
  npm start -- --azure <work item id>   read the user story from the Azure board
  npm start -- --file <path>            manual input from a text file (e.g. samples/login_story.txt)
  npm start                             type the user story in
Options: --out <dir>  --instructions "<extra guidance>"  --no-strict
         --story-id <id>   user story id for manual input (prefixes test case titles: "<id> | ...")
         --provider auto|claude|azure-openai   (default: LLM_PROVIDER in .env, else auto)`;

/** A command-line mistake: printed together with the usage text. */
class UsageError extends Error {}

function storyFile(path: string): string {
  const found = resolveStoryFile(path);
  if (!found) throw new UsageError(`File not found: ${path}`);
  return found;
}

function parseCli(argv: string[]): RunOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
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
    throw new UsageError(`${msg}${hint}`);
  }
  const { values: a, positionals } = parsed;
  if (positionals.length > 1) throw new UsageError(`Unexpected arguments: ${positionals.join(" ")}`);
  const file = a.file ?? positionals[0]; // npm start -- story.txt
  if (a.azure && file) throw new UsageError("Use either --azure <id> or --file <path> (or neither, to type the story in).");

  const provider = (a.provider || process.env.LLM_PROVIDER || "auto").trim().toLowerCase() as Provider;
  if (!PROVIDERS.includes(provider)) {
    throw new UsageError(`Unknown LLM provider "${provider}". Use one of: ${PROVIDERS.join(", ")}.`);
  }
  return {
    source: a.azure ? { kind: "azure", id: a.azure } : file ? { kind: "file", path: storyFile(file) } : { kind: "prompt" },
    outDir: a.out!,
    provider,
    strict: !a["no-strict"],
    instructions: a.instructions,
    storyId: a["story-id"],
  };
}

async function main(): Promise<number> {
  const result = await run(parseCli(process.argv.slice(2)));
  console.log(`Azure import CSV: ${result.csvPath}`);
  console.log(`Review notes:     ${result.reviewPath}`);
  console.log(`Import via Azure Test Plans > your test suite > "Import test cases from CSV".`);
  if (result.exitCode) {
    console.error(`Acceptance criteria not covered: ${result.coverage.uncovered.join(", ")} `
      + "(exit code 1; use --no-strict to ignore)");
  }
  return result.exitCode;
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    if (err instanceof UsageError) console.error(`\n${USAGE}`);
    process.exitCode = 1;
  },
);
