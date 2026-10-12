/** Runtime checks for untrusted input: the LLM's tool output and the loaded user story. */
import { normaliseRef } from "./coverage.js";
import type { Category, Requirement, TestCase, TestStep, TestSuite } from "./types.js";

/** The model's output could not be used at all. */
export class InvalidResponseError extends Error {
  constructor(reason: string) {
    super(`The model returned unusable test cases: ${reason}`);
    this.name = "InvalidResponseError";
  }
}

/** The user story is not good enough to generate (and check) test cases from. */
export class InvalidStoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStoryError";
  }
}

const CATEGORIES: readonly Category[] = ["positive", "negative", "edge"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

function parseStep(raw: unknown, i: number): TestStep | string {
  if (!isObject(raw)) return `step ${i + 1} is not an object`;
  const action = str(raw.action);
  const expected = str(raw.expected);
  if (!action) return `step ${i + 1} has no action`;
  if (!expected) return `step ${i + 1} has no expected result`;
  return { action, expected };
}

/** A valid TestCase, or the reason it was rejected. */
function parseCase(raw: unknown): TestCase | string {
  if (!isObject(raw)) return "not an object";
  const title = str(raw.title);
  if (!title) return "no title";
  const category = str(raw.category).toLowerCase() as Category;
  if (!CATEGORIES.includes(category)) return `invalid category ${JSON.stringify(raw.category)}`;
  const priority = Number(raw.priority);
  if (![1, 2, 3, 4].includes(priority)) return `invalid priority ${JSON.stringify(raw.priority)}`;
  if (!Array.isArray(raw.steps) || !raw.steps.length) return "no steps";
  const steps: TestStep[] = [];
  for (const [i, s] of raw.steps.entries()) {
    const step = parseStep(s, i);
    if (typeof step === "string") return step;
    steps.push(step);
  }
  const tc: TestCase = {
    title,
    category,
    priority: priority as TestCase["priority"],
    covers: [...new Set(strList(raw.covers).map((r) => normaliseRef(r) ?? r))],
    steps,
  };
  const preconditions = str(raw.preconditions);
  const testData = str(raw.test_data);
  if (preconditions) tc.preconditions = preconditions;
  if (testData) tc.test_data = testData;
  return tc;
}

export interface ParsedSuite {
  suite: TestSuite;
  rejected: string[]; // one message per test case that was dropped
}

/**
 * Check the model's save_test_cases output field by field. Malformed test cases are dropped with a
 * reason, so they never reach the CSV; a response with no usable test case at all is an error.
 */
export function parseSuite(input: unknown): ParsedSuite {
  if (!isObject(input)) throw new InvalidResponseError("the tool input is not a JSON object");
  if (!Array.isArray(input.test_cases)) throw new InvalidResponseError('"test_cases" is missing or not an array');

  const rejected: string[] = [];
  const cases: TestCase[] = [];
  input.test_cases.forEach((raw, i) => {
    const tc = parseCase(raw);
    if (typeof tc !== "string") return void cases.push(tc);
    const title = isObject(raw) && str(raw.title) ? ` "${str(raw.title)}"` : "";
    rejected.push(`Rejected test case #${i + 1}${title}: ${tc}`);
  });
  if (!cases.length) {
    throw new InvalidResponseError(input.test_cases.length
      ? `all ${input.test_cases.length} test cases were malformed (${rejected[0]})`
      : "no test cases were returned");
  }
  return {
    suite: {
      summary: str(input.summary),
      assumptions: strList(input.assumptions),
      open_questions: strList(input.open_questions),
      test_cases: cases,
    },
    rejected,
  };
}

const titleKey = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}{}]+/gu, " ").trim();

/** Drop test cases whose title repeats an earlier one (case, spacing and punctuation ignored). */
export function dedupeCases(cases: TestCase[]): { cases: TestCase[]; removed: string[] } {
  const seen = new Set<string>();
  const kept: TestCase[] = [];
  const removed: string[] = [];
  for (const tc of cases) {
    const key = titleKey(tc.title);
    if (seen.has(key)) removed.push(`Removed duplicate test case: ${tc.title}`);
    else {
      seen.add(key);
      kept.push(tc);
    }
  }
  return { cases: kept, removed };
}

/**
 * Fail before any LLM call when the story can't produce checkable test cases.
 * Without acceptance criteria coverage can't be verified, so that is an error in strict mode
 * and a warning otherwise. Returns the warnings.
 */
export function validateRequirement(req: Requirement, strict: boolean): string[] {
  if (!req.title.trim()) throw new InvalidStoryError("The user story has no title.");
  if (req.criteria.length) return [];
  const where = req.source === "azure"
    ? `work item ${req.id} has an empty Acceptance Criteria field`
    : 'no "Acceptance Criteria:" section with at least one criterion was found';
  if (strict) {
    throw new InvalidStoryError(`No acceptance criteria: ${where}. Coverage can't be checked without them `
      + "(use --no-strict to generate anyway).");
  }
  if (!req.description.trim()) {
    throw new InvalidStoryError("The user story has neither a description nor acceptance criteria — nothing to test.");
  }
  return [`No acceptance criteria (${where}) — coverage was not checked.`];
}
