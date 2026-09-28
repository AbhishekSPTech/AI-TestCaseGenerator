/** Turn a Requirement into structured test cases using Claude (forced tool use = guaranteed JSON shape). */
import Anthropic from "@anthropic-ai/sdk";
import { requirementToPrompt } from "./sources.js";
import type { Requirement, TestSuite } from "./types.js";

export const SYSTEM_PROMPT = `You are a senior QA engineer writing manual test cases from a user story.

Coverage rules:
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
- Reference which acceptance criterion each test covers (e.g. "AC1") in covers.

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
            covers: { type: "array", items: { type: "string" } },
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

export async function generateTestCases(
  req: Requirement, model: string, extraInstructions = "",
): Promise<TestSuite> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  let userMsg = requirementToPrompt(req);
  if (extraInstructions) {
    userMsg += `\n\n<additional_instructions>\n${extraInstructions}\n</additional_instructions>`;
  }

  const resp = await client.messages.create({
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content: userMsg }],
  });

  const block = resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error(`Model did not return test cases (stop_reason: ${resp.stop_reason})`);
  if (resp.stop_reason === "max_tokens") {
    throw new Error("Output was cut off at max_tokens — split the story or raise max_tokens.");
  }
  const suite = block.input as TestSuite;
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
