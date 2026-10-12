/** Console summary and the *_review.txt file a QA reviewer reads before importing the CSV. */
import { writeFileSync } from "node:fs";
import type { Coverage, CoverageStatus } from "./coverage.js";
import type { Requirement, TestSuite } from "./types.js";

const oneLine = (s: string, max = 70) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const STATUS_LABEL: Record<CoverageStatus, string> = {
  "covered": "covered",
  "needs-review": "NEEDS REVIEW",
  "not-covered": "NOT COVERED",
};

/** One-line overall result; matches the exit code in strict mode. */
export function verdict(cov: Coverage, strict: boolean): string {
  if (!cov.criteria.length) return "Result: NOT CHECKED — no acceptance criteria";
  if (cov.uncovered.length) {
    return strict
      ? `Result: FAIL — not covered: ${cov.uncovered.join(", ")}`
      : `Result: INCOMPLETE — not covered: ${cov.uncovered.join(", ")} (--no-strict)`;
  }
  if (cov.needsReview.length) return `Result: PASS, REVIEW NEEDED — check ${cov.needsReview.join(", ")} before importing`;
  return "Result: PASS — every acceptance criterion has a test case that addresses it";
}

function coverageLines(cov: Coverage): string[] {
  if (!cov.criteria.length) return ["No acceptance criteria found — coverage cannot be checked."];
  const total = cov.criteria.length;
  const mapped = total - cov.uncovered.length;
  const validated = mapped - cov.needsReview.length;
  const lines = [
    `Coverage (mapped):    ${mapped}/${total} acceptance criteria are referenced by at least one test case`,
    `Coverage (validated): ${validated}/${total} also have a mapped test case whose steps mention the criterion`,
  ];
  for (const c of cov.criteria) {
    const cases = c.cases.length ? c.cases.join(", ") : "-";
    lines.push(`  ${c.id.padEnd(5)} ${STATUS_LABEL[c.status].padEnd(12)} ${oneLine(c.text)}`);
    lines.push(`        tests: ${cases}`);
  }
  if (cov.needsReview.length) {
    lines.push("  NEEDS REVIEW: test cases claim these criteria, but their steps don't mention the criterion's key terms.");
  }
  if (cov.unknownRefs.length) lines.push(`  Tests reference unknown criteria: ${cov.unknownRefs.join(", ")}`);
  return lines;
}

function countsLine(suite: TestSuite): string {
  const n = (k: string) => suite.test_cases.filter((c) => c.category === k).length;
  return `${suite.test_cases.length} test cases (positive ${n("positive")}, negative ${n("negative")}, edge ${n("edge")})`;
}

export function printSummary(suite: TestSuite, cov: Coverage, log: (msg: string) => void = console.log): void {
  log(`Generated ${countsLine(suite)}`);
  coverageLines(cov).forEach((l) => log(l));
  suite.assumptions?.forEach((s) => log(`  - assumption: ${s}`));
  suite.open_questions?.forEach((q) => log(`  ? ${q}`));
  suite.warnings?.forEach((w) => log(`  ! ${w}`));
}

export function writeReviewFile(
  path: string, req: Requirement, suite: TestSuite, cov: Coverage, strict: boolean,
): void {
  const section = (title: string, items?: string[]) =>
    items?.length ? [``, title, ...items.map((i) => `  - ${i}`)] : [];
  const lines = [
    `User story: ${req.source === "azure" ? `#${req.id} ` : ""}${req.title}`,
    ``,
    verdict(cov, strict),
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
