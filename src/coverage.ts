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

export interface CriterionCoverage extends Criterion {
  cases: string[]; // ids (or titles, before ids are assigned) of the covering test cases
}

export interface Coverage {
  criteria: CriterionCoverage[];
  uncovered: string[];
  unknownRefs: string[]; // referenced in `covers` but not a real criterion
}

export function computeCoverage(criteria: Criterion[], cases: TestCase[]): Coverage {
  const known = new Set(criteria.map((c) => c.id));
  const unknown = new Set<string>();
  const byId = new Map(criteria.map((c) => [c.id, [] as string[]]));
  for (const tc of cases) {
    for (const ref of tc.covers ?? []) {
      if (known.has(ref)) byId.get(ref)!.push(tc.id ?? tc.title);
      else unknown.add(ref);
    }
  }
  const result = criteria.map((c) => ({ ...c, cases: byId.get(c.id)! }));
  return {
    criteria: result,
    uncovered: result.filter((c) => !c.cases.length).map((c) => c.id),
    unknownRefs: [...unknown],
  };
}
