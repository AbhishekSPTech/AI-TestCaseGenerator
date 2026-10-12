// Shared fixtures: a scripted fake LLM and raw tool outputs shaped like the model's.
import type { Llm } from "../src/generator.js";
import type { Requirement } from "../src/types.js";
import { parseCriteria } from "../src/coverage.js";

export type FakeLlm = Llm & { calls: string[] };

/** Returns the scripted responses in order; an Error is thrown instead of returned. */
export function fakeLlm(...responses: unknown[]): FakeLlm {
  const calls: string[] = [];
  return {
    name: "fake",
    calls,
    async call(msg) {
      calls.push(msg);
      if (calls.length > responses.length) throw new Error(`unexpected LLM call #${calls.length}`);
      const r = responses[calls.length - 1];
      if (r instanceof Error) throw r;
      return structuredClone(r);
    },
  };
}

export const noLog = () => {};

export function story(criteria: string, overrides: Partial<Requirement> = {}): Requirement {
  return {
    source: "manual",
    id: "99999",
    title: "Login with email and password",
    description: "Users log in from the /login page.",
    acceptanceCriteria: criteria,
    criteria: parseCriteria(criteria),
    ...overrides,
  };
}

export const LOGIN_AC = `AC1: Valid email and password redirects the user to /dashboard.
AC2: Invalid credentials show "Invalid email or password" and the user stays on /login.`;

export const validLoginCase = {
  title: "Verify user is redirected to dashboard when email and password are valid",
  category: "positive",
  priority: 1,
  covers: ["AC1"],
  preconditions: "User {TestUserA} is registered",
  test_data: "{TestEmail}: email of {TestUserA}; {TestPassword}: password of {TestUserA}",
  steps: [
    { action: "Open /login and enter {TestEmail} and {TestPassword}", expected: "Fields accept the input" },
    { action: "Click Login", expected: "User is redirected to /dashboard" },
  ],
};

export const invalidLoginCase = {
  title: "Verify error is shown when the password is invalid",
  category: "negative",
  priority: 1,
  covers: ["ac 2"],
  steps: [
    { action: "Open /login, enter {TestEmail} and an invalid password, click Login",
      expected: 'Message "Invalid email or password" is shown and the user stays on /login' },
  ],
};

export const edgeCase = {
  title: "Verify login trims whitespace around the email",
  category: "edge",
  priority: 3,
  covers: ["AC1"],
  steps: [{ action: "Enter \" {TestEmail} \" and {TestPassword}, click Login", expected: "User reaches /dashboard" }],
};

const step = (action: string, expected: string) => ({ action, expected });

// One test case per acceptance criterion of samples/login_story.txt
export const AC_CASES = [
  { title: "Verify redirect to dashboard with valid email and password", category: "positive", priority: 1, covers: ["AC1"],
    steps: [step("Log in with {TestEmail} and {TestPassword}", "User is redirected to /dashboard")] },
  { title: "Verify error with invalid credentials", category: "negative", priority: 1, covers: ["AC2"],
    steps: [step("Log in with {TestEmail} and a wrong password", 'Message "Invalid email or password" is shown; user stays on /login')] },
  { title: "Verify account is locked after 5 consecutive failed attempts", category: "edge", priority: 1, covers: ["AC3"],
    steps: [step("Fail login 5 consecutive times", "The account is locked for 15 minutes")] },
  { title: "Verify Login button is disabled until email and password are filled", category: "negative", priority: 2, covers: ["AC4"],
    steps: [step("Leave the password field empty", "Login button is disabled; both fields are mandatory")] },
];

export const toolOutput = (...cases: unknown[]) => ({
  summary: "Login with email and password.",
  assumptions: ["Emails are case-insensitive"],
  open_questions: ["What is the maximum password length?"],
  test_cases: cases,
});
