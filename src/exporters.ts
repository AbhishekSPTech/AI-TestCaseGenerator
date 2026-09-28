/** Write test cases as a CSV for Azure Test Plans > "Import test cases from CSV". */
import { writeFileSync } from "node:fs";
import { stringify } from "csv-stringify/sync";
import type { Requirement, TestCase, TestStep, TestSuite } from "./types.js";

const BOM = "﻿"; // so Excel opens UTF-8 correctly

const titleOf = (c: TestCase) => `${c.id ? `${c.id} ` : ""}[${c.category.toUpperCase()}] ${c.title}`;

/** The CSV import has no preconditions field, so they go in as a setup step 1. */
function stepsOf(c: TestCase): TestStep[] {
  const setup: string[] = [];
  if (c.preconditions) setup.push(`Preconditions: ${c.preconditions}`);
  if (c.test_data) setup.push(`Test data: ${c.test_data}`);
  return setup.length
    ? [{ action: setup.join("\n"), expected: "Preconditions are met and test data is available" }, ...c.steps]
    : c.steps;
}

/** One header row per test case, then one row per step with Title left blank. */
export function exportAzureCsv(suite: TestSuite, req: Requirement, path: string): void {
  const rows: (string | number)[][] = [[
    "ID", "Work Item Type", "Title", "Test Step", "Step Action", "Step Expected",
    "Priority", "Area Path", "State", "Tags",
  ]];
  for (const c of suite.test_cases) {
    const tags = ["ai-generated", c.category, ...(c.covers ?? [])].join("; ");
    rows.push(["", "Test Case", titleOf(c), "", "", "", c.priority, req.areaPath ?? "", "Design", tags]);
    stepsOf(c).forEach((s, i) => rows.push(["", "", "", i + 1, s.action, s.expected, "", "", "", ""]));
  }
  writeFileSync(path, BOM + stringify(rows), "utf8");
}
