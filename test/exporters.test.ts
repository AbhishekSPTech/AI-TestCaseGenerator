import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { azureCsv, MAX_TITLE_LENGTH } from "../src/exporters.js";
import type { TestSuite } from "../src/types.js";
import { story } from "./helpers.js";

const GOLDEN = "test/golden/azure_import.csv";

const suite: TestSuite = {
  summary: "",
  test_cases: [
    {
      id: "TC-001",
      title: 'Verify "Invalid email or password", shown on failure',
      category: "negative",
      priority: 1,
      preconditions: "User {TestUserA} exists",
      test_data: "{TestEmail}: email, with a comma",
      steps: [
        { action: "Enter {TestEmail}\nand a wrong password", expected: 'Message "Invalid email or password"' },
        { action: "Click Login", expected: "User stays on /login" },
      ],
    },
    {
      id: "TC-002",
      title: "Verify login without preconditions",
      category: "positive",
      priority: 2,
      steps: [{ action: "Click Login", expected: "Dashboard, with widgets, is shown" }],
    },
  ],
};

describe("azureCsv", () => {
  beforeEach(() => {
    delete process.env.ADO_AREA_PATH;
    process.env.ADO_ASSIGNED_TO = "Jane Doe <jane.doe@example.com>";
  });

  it("matches the golden Azure Test Plans import file (quotes, commas, newlines, setup step)", () => {
    const csv = azureCsv(suite, story("AC1: x", { areaPath: "Proj\\Team" }));
    // After an intended format change: UPDATE_GOLDEN=1 npm test, then review the diff of the golden file.
    if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, csv, "utf8");
    assert.equal(csv, readFileSync(GOLDEN, "utf8"));
  });

  it("starts with a BOM and keeps every row at 9 columns", () => {
    const csv = azureCsv(suite, story("AC1: x"));
    assert.ok(csv.startsWith("﻿ID,Work Item Type,Title,"));
    // header + (1 + 3 steps) + (1 + 1 step), counted as CSV records (quoted newlines don't split rows)
    const records = csv.split(/\r?\n(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter(Boolean);
    assert.equal(records.length, 7);
  });

  it("omits the id prefix for manual stories without an id", () => {
    const csv = azureCsv(suite, story("AC1: x", { id: "MANUAL" }));
    assert.match(csv, /\n,Test Case,Verify login without preconditions,/);
  });

  it("shortens titles to the Azure DevOps limit", () => {
    const long: TestSuite = { summary: "", test_cases: [{ ...suite.test_cases[1], title: "x".repeat(400) }] };
    const title = azureCsv(long, story("AC1: x")).split("\n")[1].split(",")[2];
    assert.equal(title.length, MAX_TITLE_LENGTH);
    assert.ok(title.endsWith("…"));
  });
});
