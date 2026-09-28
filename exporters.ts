/** Write test cases to CSV/JSON, or push them straight into Azure Test Plans / TestRail. */
import { writeFileSync } from "node:fs";
import { stringify } from "csv-stringify/sync";
import { basicAuth } from "./sources.js";
import type { Requirement, TestCase, TestSuite } from "./types.js";

const BOM = "\uFEFF"; // so Excel opens UTF-8 correctly

const titleOf = (c: TestCase) => `[${c.category.toUpperCase()}] ${c.title}`;

function descriptionOf(c: TestCase): string {
  const parts: string[] = [];
  if (c.preconditions) parts.push(`Preconditions: ${c.preconditions}`);
  if (c.test_data) parts.push(`Test data: ${c.test_data}`);
  if (c.covers?.length) parts.push(`Covers: ${c.covers.join(", ")}`);
  return parts.join("\n");
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ------------------------------------------------------------------ files
export function exportJson(suite: TestSuite, path: string): void {
  writeFileSync(path, JSON.stringify(suite, null, 2), "utf8");
}

/** Format accepted by Azure Test Plans > "Import test cases from CSV".
 *  One header row per test case, then one row per step with Title left blank. */
export function exportAzureCsv(suite: TestSuite, req: Requirement, path: string): void {
  const rows: (string | number)[][] = [[
    "ID", "Work Item Type", "Title", "Test Step", "Step Action", "Step Expected",
    "Priority", "Area Path", "State",
  ]];
  for (const c of suite.test_cases) {
    rows.push(["", "Test Case", titleOf(c), "", "", "", c.priority, req.areaPath ?? "", "Design"]);
    c.steps.forEach((s, i) => rows.push(["", "", "", i + 1, s.action, s.expected, "", "", ""]));
  }
  writeFileSync(path, BOM + stringify(rows), "utf8");
}

/** For TestRail's CSV import wizard: choose "Test cases use multiple rows", map Title as the
 *  column that starts a new case, and map Step / Expected Result to separated steps. */
export function exportTestRailCsv(suite: TestSuite, req: Requirement, path: string): void {
  const prio = { 1: "Critical", 2: "High", 3: "Medium", 4: "Low" } as const;
  const rows: string[][] = [[
    "Title", "Section", "Type", "Priority", "References", "Preconditions", "Step", "Expected Result",
  ]];
  for (const c of suite.test_cases) {
    c.steps.forEach((s, i) =>
      rows.push(i === 0
        ? [titleOf(c), req.title, "Functional", prio[c.priority], req.id, descriptionOf(c), s.action, s.expected]
        : ["", "", "", "", "", "", s.action, s.expected]),
    );
  }
  writeFileSync(path, BOM + stringify(rows), "utf8");
}

// ------------------------------------------------------------------ direct push: Azure DevOps
export function adoStepsXml(steps: TestCase["steps"]): string {
  const items = steps.map((s, i) =>
    `<step id="${i + 2}" type="ActionStep">` +
    `<parameterizedString isformatted="true">${xmlEscape(s.action)}</parameterizedString>` +
    `<parameterizedString isformatted="true">${xmlEscape(s.expected)}</parameterizedString>` +
    `<description/></step>`);
  return `<steps id="0" last="${steps.length + 1}">${items.join("")}</steps>`;
}

/** Create Test Case work items and link each one to the story ("Tests" relation). */
export async function pushToAzure(
  suite: TestSuite, req: Requirement, org: string, project: string, pat: string,
): Promise<number[]> {
  const url = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/wit/workitems/$Test%20Case?api-version=7.1`;
  const headers = { ...basicAuth("", pat), "Content-Type": "application/json-patch+json" };
  const created: number[] = [];
  for (const c of suite.test_cases) {
    const ops: object[] = [
      { op: "add", path: "/fields/System.Title", value: titleOf(c) },
      { op: "add", path: "/fields/Microsoft.VSTS.TCM.Steps", value: adoStepsXml(c.steps) },
      { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: c.priority },
      { op: "add", path: "/fields/System.Description", value: descriptionOf(c).replace(/\n/g, "<br>") },
      { op: "add", path: "/fields/System.Tags", value: `ai-generated; ${c.category}` },
    ];
    if (req.areaPath) ops.push({ op: "add", path: "/fields/System.AreaPath", value: req.areaPath });
    if (req.apiUrl) {
      ops.push({ op: "add", path: "/relations/-",
        value: { rel: "Microsoft.VSTS.Common.TestedBy-Reverse", url: req.apiUrl } });
    }
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(ops) });
    if (!res.ok) throw new Error(`Azure create failed for "${c.title}": ${res.status} ${await res.text()}`);
    created.push(((await res.json()) as { id: number }).id);
  }
  return created;
}

// ------------------------------------------------------------------ direct push: TestRail
/** templateId 2 is usually "Test Case (Steps)" — check Administration > Customizations. */
export async function pushToTestRail(
  suite: TestSuite, req: Requirement, baseUrl: string, user: string, apiKey: string,
  sectionId: string, templateId = 2,
): Promise<number[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/index.php?/api/v2/add_case/${sectionId}`;
  const headers = { ...basicAuth(user, apiKey), "Content-Type": "application/json" };
  const prio = { 1: 4, 2: 3, 3: 2, 4: 1 } as const; // TestRail default: 4=Critical ... 1=Low
  const created: number[] = [];
  for (const c of suite.test_cases) {
    const body = {
      title: titleOf(c),
      template_id: templateId,
      priority_id: prio[c.priority],
      refs: req.id,
      custom_preconds: descriptionOf(c),
      custom_steps_separated: c.steps.map((s) => ({ content: s.action, expected: s.expected })),
    };
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`TestRail create failed for "${c.title}": ${res.status} ${await res.text()}`);
    created.push(((await res.json()) as { id: number }).id);
  }
  return created;
}
