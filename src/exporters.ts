// Write test cases as a CSV for Azure Test Plans > "Import test cases from CSV".
import { writeFileSync } from "node:fs";
import { stringify } from "csv-stringify/sync";
import type { Requirement, TestCase, TestStep, TestSuite } from "./types.js";

const BOM = "﻿"; // so Excel opens UTF-8 correctly

const titleOf = (c: TestCase, req: Requirement) => (req.id !== "MANUAL" ? `${req.id} | ${c.title}` : c.title);

// The CSV import has no preconditions field, so they go in as a setup step 1.
function stepsOf(c: TestCase): TestStep[] {
  const setup: string[] = [];
  if (c.preconditions) setup.push(`Preconditions: ${c.preconditions}`);
  if (c.test_data) setup.push(`Test data: ${c.test_data}`);
  return setup.length
    ? [{ action: setup.join("\n"), expected: "Preconditions are met and test data is available" }, ...c.steps]
    : c.steps;
}

export function exportAzureCsv(suite: TestSuite, req: Requirement, path: string): void {
  const areaPath = req.areaPath || process.env.ADO_AREA_PATH || "";
  const assignedTo = process.env.ADO_ASSIGNED_TO || "";
  const rows: (string | number)[][] = [[
    "ID", "Work Item Type", "Title", "Test Step", "Step Action", "Step Expected",
    "Area Path", "Assigned To", "State",
  ]];
  for (const c of suite.test_cases) {
    rows.push(["", "Test Case", titleOf(c, req), "", "", "", areaPath, assignedTo, "Design"]);
    stepsOf(c).forEach((s, i) => rows.push(["", "", "", i + 1, s.action, s.expected, "", "", ""]));
  }
  writeFileSync(path, BOM + stringify(rows), "utf8");
}
