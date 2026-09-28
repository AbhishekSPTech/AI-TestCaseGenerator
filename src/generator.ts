/** Turn a Requirement into structured test cases using Claude (forced tool use = guaranteed JSON shape). */
import Anthropic from "@anthropic-ai/sdk";
import { computeCoverage, normaliseRef } from "./coverage.js";
import { requirementToPrompt } from "./sources.js";
import type { Requirement, TestSuite } from "./types.js";

export const SYSTEM_PROMPT = `You are a senior QA engineer writing manual test cases from a user story.

Coverage rules:
- Every acceptance criterion (<criterion id="ACn">) must be covered by at least one test case.
- POSITIVE: every acceptance criterion gets at least one happy-path test.
- NEGATIVE: invalid input, missing/required fields, wrong formats, unauthorized users,
  failed dependencies, duplicate submissions.
- EDGE: boundary values (min, max, min-1, max+1), empty/whitespace, very long strings,
  special characters/Unicode, concurrency, timeouts, locale/timezone, first/last item.

Writing rules:
- One behaviour per test case. Title format: "Verify <expected behaviour> when <condition>".
- Steps are concrete user actions; each step has an observable expected result.
- Put concrete test data in test_data (real example values, not "valid data").
- Do NOT invent features the story doesn't describe. If something is ambiguous or missing
  (limits, error messages, roles), list it in open_questions and state the assumption you used.
- Priority: 1 = critical path / AC blocker, 2 = high, 3 = medium, 4 = low.
- In covers, list the ids of the acceptance criteria the test verifies, exactly as given (e.g. "AC1").

Return your answer ONLY by calling the save_test_cases tool.`;

const TOOL: Anthropic.Tool = {
  name: "save_test_cases",
  description: "Save the generated test suite for the user story.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One-paragraph understanding of the feature." },
      assumptions: { type: "array", items: { type: "string" } },
      open_questions: { type: "array", items: { type: "string" } },
      test_cases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            category: { type: "string", enum: ["positive", "negative", "edge"] },
            priority: { type: "integer", enum: [1, 2, 3, 4] },
            covers: { type: "array", items: { type: "string" }, description: 'Criterion ids, e.g. ["AC1"]' },
            preconditions: { type: "string" },
            test_data: { type: "string" },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: { action: { type: "string" }, expected: { type: "string" } },
                required: ["action", "expected"],
              },
            },
          },
          required: ["title", "category", "priority", "steps"],
        },
      },
    },
    required: ["summary", "test_cases"],
  },
};

async function callClaude(client: Anthropic, model: string, userMsg: string): Promise<TestSuite> {
  const resp = await client.messages.create({
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content: userMsg }],
  });
  if (resp.stop_reason === "max_tokens") {
    throw new Error("Output was cut off at max_tokens — split the story or raise max_tokens.");
  }
  const block = resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error(`Model did not return test cases (stop_reason: ${resp.stop_reason})`);
  const suite = block.input as TestSuite;
  suite.test_cases ??= [];
  for (const tc of suite.test_cases) {
    tc.covers = [...new Set((tc.covers ?? []).map((r) => normaliseRef(r) ?? r.trim()))];
  }
  return suite;
}

const union = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])];

/**
 * Generate the suite, then make one follow-up call for any acceptance criteria left uncovered.
 * Test case ids (TC-001, ...) are assigned here, after all calls, so they are gap-free.
 */
export async function generateTestCases(
  req: Requirement, model: string, extraInstructions = "",
): Promise<TestSuite> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const base = requirementToPrompt(req) + (extraInstructions
    ? `\n\n<additional_instructions>\n${extraInstructions}\n</additional_instructions>` : "");

  const suite = await callClaude(client, model, base);

  const missing = computeCoverage(req.criteria, suite.test_cases).uncovered;
  if (missing.length) {
    console.log(`Not covered by the first pass: ${missing.join(", ")} — asking for additional test cases...`);
    const existing = suite.test_cases.map((c) => `- ${c.title}`).join("\n");
    const extra = await callClaude(client, model, `${base}

<existing_test_cases>
${existing}
</existing_test_cases>

The existing test cases above do not cover ${missing.join(", ")}. Generate ADDITIONAL test cases
(positive, negative and edge as relevant) ONLY for those criteria, without repeating the existing ones.
Each new test case must list the criterion it verifies in covers.`);
    suite.test_cases.push(...extra.test_cases);
    suite.assumptions = union(suite.assumptions, extra.assumptions);
    suite.open_questions = union(suite.open_questions, extra.open_questions);
  }

  suite.test_cases.forEach((tc, i) => { tc.id = `TC-${String(i + 1).padStart(3, "0")}`; });
  suite.warnings = qualityChecks(suite);
  return suite;
}

/** Cheap sanity checks so a reviewer knows where to look. */
export function qualityChecks(suite: TestSuite): string[] {
  const warnings: string[] = [];
  const cases = suite.test_cases ?? [];
  for (const cat of ["positive", "negative", "edge"] as const) {
    if (!cases.some((c) => c.category === cat)) warnings.push(`No ${cat} test cases were generated.`);
  }
  const seen = new Set<string>();
  for (const c of cases) {
    const key = c.title.trim().toLowerCase();
    if (seen.has(key)) warnings.push(`Duplicate title: ${c.title}`);
    seen.add(key);
    if (!c.steps?.length) warnings.push(`No steps: ${c.title}`);
  }
  return warnings;
}
