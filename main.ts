/**
 * Test Case Generator Agent
 *
 *   npm start -- --azure 12345                  # ADO user story -> CSVs + JSON
 *   npm start -- --jira PROJ-42                 # Jira ticket    -> CSVs + JSON
 *   npm start -- --file story.txt               # local text, for prompt tuning
 *   npm start -- --azure 12345 --push-azure     # also create Test Case work items linked to the story
 *   npm start -- --azure 12345 --push-testrail  # also create cases in a TestRail section
 */
import "dotenv/config";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as exporters from "./exporters.js";
import { generateTestCases } from "./generator.js";
import { fetchAzureStory, fetchJiraIssue, loadFromFile } from "./sources.js";
import type { Requirement } from "./types.js";

function env(name: string, required = true): string {
  const v = process.env[name] ?? "";
  if (required && !v) {
    console.error(`Missing environment variable ${name} (see .env.example)`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const { values: a } = parseArgs({
    options: {
      azure: { type: "string" },
      jira: { type: "string" },
      file: { type: "string" },
      out: { type: "string", default: "output" },
      instructions: { type: "string", default: "" },
      "push-azure": { type: "boolean", default: false },
      "push-testrail": { type: "boolean", default: false },
    },
  });

  const sources = [a.azure, a.jira, a.file].filter(Boolean);
  if (sources.length !== 1) {
    console.error("Provide exactly one of --azure <id>, --jira <key>, --file <path>");
    process.exit(1);
  }

  // 1. Input
  let req: Requirement;
  if (a.azure) {
    req = await fetchAzureStory(env("ADO_ORG"), env("ADO_PROJECT"), a.azure, env("ADO_PAT"));
  } else if (a.jira) {
    req = await fetchJiraIssue(env("JIRA_BASE_URL"), a.jira, env("JIRA_EMAIL"),
      env("JIRA_API_TOKEN"), env("JIRA_AC_FIELD", false) || undefined);
  } else {
    req = loadFromFile(a.file!);
  }
  console.log(`Loaded ${req.source} story ${req.id}: ${req.title}`);

  // 2. LLM
  env("ANTHROPIC_API_KEY");
  const suite = await generateTestCases(req, process.env.CLAUDE_MODEL || "claude-sonnet-5", a.instructions);
  const cases = suite.test_cases;
  const count = (k: string) => cases.filter((c) => c.category === k).length;
  console.log(`Generated ${cases.length} test cases (positive ${count("positive")}, ` +
    `negative ${count("negative")}, edge ${count("edge")})`);
  suite.warnings?.forEach((w) => console.log(`  ! ${w}`));
  suite.open_questions?.forEach((q) => console.log(`  ? ${q}`));

  // 3. Export
  const out = resolve(a.out!);
  mkdirSync(out, { recursive: true });
  const stem = `${req.source}_${req.id}`;
  exporters.exportJson(suite, join(out, `${stem}_testcases.json`));
  exporters.exportAzureCsv(suite, req, join(out, `${stem}_azure_import.csv`));
  exporters.exportTestRailCsv(suite, req, join(out, `${stem}_testrail_import.csv`));
  console.log(`Files written to ${out}`);

  if (a["push-azure"]) {
    const ids = await exporters.pushToAzure(suite, req, env("ADO_ORG"), env("ADO_PROJECT"), env("ADO_PAT"));
    console.log(`Created ${ids.length} Azure Test Case work items: ${ids.join(", ")}`);
  }
  if (a["push-testrail"]) {
    const ids = await exporters.pushToTestRail(suite, req, env("TESTRAIL_URL"), env("TESTRAIL_USER"),
      env("TESTRAIL_API_KEY"), env("TESTRAIL_SECTION_ID"), Number(process.env.TESTRAIL_TEMPLATE_ID || 2));
    console.log(`Created ${ids.length} TestRail cases: ${ids.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
