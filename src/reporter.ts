/** Console summary and the *_review.txt file a QA reviewer reads before importing the CSV. */
import { writeFileSync } from "node:fs";
import type { Coverage } from "./coverage.js";
import type { Requirement, TestSuite } from "./types.js";

const oneLine = (s: string, max = 70) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function coverageLines(cov: Coverage): string[] {
  if (!cov.criteria.length) return ["No acceptance criteria found — coverage cannot be checked."];
  const covered = cov.criteria.length - cov.uncovered.length;
  const lines = [`Coverage: ${covered}/${cov.criteria.length} acceptance criteria covered`];
  for (const c of cov.criteria) {
    const status = c.cases.length ? `${c.cases.length} test(s)` : "NOT COVERED";
    lines.push(`  ${c.id.padEnd(5)} ${status.padEnd(12)} ${oneLine(c.text)}`);
  }
  if (cov.unknownRefs.length) lines.push(`  Tests reference unknown criteria: ${cov.unknownRefs.join(", ")}`);
  return lines;
}

function countsLine(suite: TestSuite): string {
  const n = (k: string) => suite.test_cases.filter((c) => c.category === k).length;
  return `${suite.test_cases.length} test cases (positive ${n("positive")}, negative ${n("negative")}, edge ${n("edge")})`;
}

export function printSummary(suite: TestSuite, cov: Coverage): void {
  console.log(`Generated ${countsLine(suite)}`);
  coverageLines(cov).forEach((l) => console.log(l));
  suite.assumptions?.forEach((s) => console.log(`  - assumption: ${s}`));
  suite.open_questions?.forEach((q) => console.log(`  ? ${q}`));
  suite.warnings?.forEach((w) => console.log(`  ! ${w}`));
}

export function writeReviewFile(path: string, req: Requirement, suite: TestSuite, cov: Coverage): void {
  const section = (title: string, items?: string[]) =>
    items?.length ? [``, title, ...items.map((i) => `  - ${i}`)] : [];
  const lines = [
    `User story: ${req.source === "azure" ? `#${req.id} ` : ""}${req.title}`,
    ``,
    `Summary: ${suite.summary}`,
    ``,
    countsLine(suite),
    ``,
    ...coverageLines(cov),
    ...section("Open questions (answer before importing):", suite.open_questions),
    ...section("Assumptions made:", suite.assumptions),
    ...section("Warnings:", suite.warnings),
    ``,
    `Test cases:`,
    ...suite.test_cases.map((c) =>
      `  ${c.id}  P${c.priority}  ${c.category.padEnd(8)} ${(c.covers ?? []).join(",").padEnd(10)} ${c.title}`),
  ];
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}
