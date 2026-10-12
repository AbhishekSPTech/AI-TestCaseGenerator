// Split acceptance criteria into numbered items and check which ones the test cases cover.
import type { Criterion, TestCase } from "./types.js";

// A line that starts a new criterion: bullet, "1." / "1)", "AC1:", or "Scenario ..."
const MARKER = /^(?:[-*•]|\d+[.)]|AC\s*\d+\b|scenario\b)/i;
const STRIP = /^(?:[-*•]\s*|\d+[.)]\s*|AC\s*\d+\s*[:.)-]?\s*)/i;
// Gherkin lines that continue the current scenario rather than start a new criterion
const CONTINUATION = /^(?:and|but|when|then)\b/i;

// Normalise "ac 1", "AC1: Valid login" etc. to "AC1"; null if it isn't a criterion reference.
export function normaliseRef(ref: string): string | null {
  const m = ref.match(/AC\s*(\d+)/i);
  return m ? `AC${Number(m[1])}` : null;
}

export function parseCriteria(text: string): Criterion[] {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim())
    .filter((l) => l && !/^acceptance criteria\s*:?$/i.test(l));
  const hasMarkers = lines.some((l) => MARKER.test(l));
  const items: string[][] = [];

  for (const line of lines) {
    const body = line.replace(STRIP, "").trim();
    const prev = items[items.length - 1];
    const prevIsScenarioHeader = prev?.length === 1 && /^scenario\b/i.test(prev[0]);
    const continues = prev && (
      CONTINUATION.test(body) ||
      (hasMarkers && !MARKER.test(line)) ||
      (prevIsScenarioHeader && /^given\b/i.test(body))
    );
    if (continues) prev.push(body);
    else if (body) items.push([body]);
  }
  return items.map((parts, i) => ({ id: `AC${i + 1}`, text: parts.join("\n") }));
}

// ------------------------------------------------------------------ evidence check
// The model's `covers` list is only a claim. As an independent check, a mapped test case counts as
// evidence for a criterion only if its title/steps/expected results mention enough of the
// criterion's key terms. This is a lexical heuristic: a miss means "a human should look", not "wrong".

const STOP_WORDS = new Set((
  "the and or but if then when given that this these those with without from into onto for of to in on at by "
  + "is are was were be been being should must will shall can could may might has have had its their there "
  + "user users system able which who what where while also any all each other only same than more"
).split(" "));

/** Minimum share of a criterion's key terms a test case must mention to count as evidence. */
export const EVIDENCE_THRESHOLD = 0.4;

const stem = (w: string) => (/^\d+$/.test(w) ? w : w.replace(/(?:ations?|ments?|ing|ed|es|s)$/, "").slice(0, 6));

export function keyTerms(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !STOP_WORDS.has(w)).map(stem));
}

const caseText = (tc: TestCase) =>
  [tc.title, tc.preconditions, tc.test_data, ...tc.steps.flatMap((s) => [s.action, s.expected])].join(" ");

/** True when the test case mentions enough of the criterion's key terms to plausibly test it. */
export function hasEvidence(criterion: Criterion, tc: TestCase): boolean {
  const terms = keyTerms(criterion.text);
  if (!terms.size) return true; // nothing to compare against
  const found = keyTerms(caseText(tc));
  const hits = [...terms].filter((t) => found.has(t)).length;
  return hits >= Math.min(2, terms.size) && hits / terms.size >= EVIDENCE_THRESHOLD;
}

// ------------------------------------------------------------------ coverage
/**
 * covered      - at least one mapped test case also passes the evidence check
 * needs-review - test cases claim the criterion, but none of them clearly tests it
 * not-covered  - no test case claims the criterion
 */
export type CoverageStatus = "covered" | "needs-review" | "not-covered";

export interface CriterionCoverage extends Criterion {
  cases: string[]; // ids (or titles, before ids are assigned) of the test cases that claim this criterion
  evidenced: string[]; // the subset of `cases` that passed the evidence check
  status: CoverageStatus;
}

export interface Coverage {
  criteria: CriterionCoverage[];
  uncovered: string[]; // no test case at all
  needsReview: string[]; // mapped, but no mapped test case passed the evidence check
  unknownRefs: string[]; // referenced in `covers` but not a real criterion
}

export function computeCoverage(criteria: Criterion[], cases: TestCase[]): Coverage {
  const known = new Map(criteria.map((c) => [c.id, c]));
  const unknown = new Set<string>();
  const mapped = new Map(criteria.map((c) => [c.id, { cases: [] as string[], evidenced: [] as string[] }]));
  for (const tc of cases) {
    const name = tc.id ?? tc.title;
    for (const ref of tc.covers ?? []) {
      const criterion = known.get(ref);
      if (!criterion) {
        unknown.add(ref);
        continue;
      }
      const m = mapped.get(ref)!;
      m.cases.push(name);
      if (hasEvidence(criterion, tc)) m.evidenced.push(name);
    }
  }
  const result: CriterionCoverage[] = criteria.map((c) => {
    const m = mapped.get(c.id)!;
    const status: CoverageStatus = !m.cases.length ? "not-covered" : m.evidenced.length ? "covered" : "needs-review";
    return { ...c, ...m, status };
  });
  const ids = (s: CoverageStatus) => result.filter((c) => c.status === s).map((c) => c.id);
  return {
    criteria: result,
    uncovered: ids("not-covered"),
    needsReview: ids("needs-review"),
    unknownRefs: [...unknown],
  };
}
