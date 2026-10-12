// End to end: sample story file + fake LLM -> CSV, review file and exit code. No API keys needed.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { run, type RunOptions } from "../src/run.js";
import { fakeLlm, noLog, toolOutput } from "./helpers.js";

const step = (action: string, expected: string) => ({ action, expected });

// One test case per acceptance criterion of samples/login_story.txt
const AC_CASES = [
  { title: "Verify redirect to dashboard with valid email and password", category: "positive", priority: 1, covers: ["AC1"],
    steps: [step("Log in with {TestEmail} and {TestPassword}", "User is redirected to /dashboard")] },
  { title: "Verify error with invalid credentials", category: "negative", priority: 1, covers: ["AC2"],
    steps: [step("Log in with {TestEmail} and a wrong password", 'Message "Invalid email or password" is shown; user stays on /login')] },
  { title: "Verify account is locked after 5 consecutive failed attempts", category: "edge", priority: 1, covers: ["AC3"],
    steps: [step("Fail login 5 consecutive times", "The account is locked for 15 minutes")] },
  { title: "Verify Login button is disabled until email and password are filled", category: "negative", priority: 2, covers: ["AC4"],
    steps: [step("Leave the password field empty", "Login button is disabled; both fields are mandatory")] },
];

function options(over: Partial<RunOptions> = {}): RunOptions {
  return {
    source: { kind: "file", path: "samples/login_story.txt" },
    outDir: mkdtempSync(join(tmpdir(), "tcg-out-")),
    provider: "auto",
    strict: true,
    ...over,
  };
}

describe("run", () => {
  it("writes the CSV and review file and exits 0 when every criterion is covered", async () => {
    const r = await run(options(), { llm: fakeLlm(toolOutput(...AC_CASES)), log: noLog });
    assert.equal(r.exitCode, 0);
    assert.ok(existsSync(r.csvPath));
    assert.ok(r.csvPath.endsWith("_azure_import.csv"));
    const review = readFileSync(r.reviewPath, "utf8");
    assert.match(review, /Result: PASS — every acceptance criterion/);
    assert.match(review, /Coverage \(validated\): 4\/4/);
    assert.match(review, /AC3 +covered .*\n +tests: TC-003/);
    assert.match(readFileSync(r.csvPath, "utf8"), /99999 \| Verify account is locked after 5 consecutive failed attempts/);
  });

  it("exits 1 in strict mode when a criterion stays uncovered, but still writes the files", async () => {
    const withoutAc4 = AC_CASES.slice(0, 3);
    const llm = fakeLlm(toolOutput(...withoutAc4), toolOutput(AC_CASES[0])); // follow-up adds nothing new
    const r = await run(options(), { llm, log: noLog });
    assert.equal(r.exitCode, 1);
    assert.deepEqual(r.coverage.uncovered, ["AC4"]);
    assert.match(readFileSync(r.reviewPath, "utf8"), /Result: FAIL — not covered: AC4/);
  });

  it("exits 0 with --no-strict even when a criterion stays uncovered", async () => {
    const llm = fakeLlm(toolOutput(...AC_CASES.slice(0, 3)), toolOutput(AC_CASES[0]));
    const r = await run(options({ strict: false }), { llm, log: noLog });
    assert.equal(r.exitCode, 0);
  });

  it("flags criteria that are only claimed for review instead of passing them", async () => {
    const claimedOnly = { ...AC_CASES[3], title: "Verify the page title", covers: ["AC3", "AC4"] };
    const r = await run(options(), { llm: fakeLlm(toolOutput(...AC_CASES.slice(0, 2), claimedOnly)), log: noLog });
    assert.equal(r.exitCode, 0);
    assert.deepEqual(r.coverage.needsReview, ["AC3"]);
    assert.match(readFileSync(r.reviewPath, "utf8"), /Result: PASS, REVIEW NEEDED — check AC3/);
  });

  it("rejects a story without acceptance criteria before calling the LLM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tcg-in-"));
    const path = join(dir, "no_ac.txt");
    writeFileSync(path, "Some title\nSome description only\n");
    const llm = fakeLlm();
    await assert.rejects(run(options({ source: { kind: "file", path } }), { llm, log: noLog }), /No acceptance criteria/);
    assert.equal(llm.calls.length, 0);
  });

  it("writes no files when generation fails", async () => {
    const opts = options();
    await assert.rejects(run(opts, { llm: fakeLlm(new Error("boom")), log: noLog }), /boom/);
    assert.equal(existsSync(join(opts.outDir, "manual_as-a-registered-user-i-want-to-log-in-with_azure_import.csv")), false);
  });

  it("uses --story-id for manual stories", async () => {
    const r = await run(options({ storyId: " 4242 " }), { llm: fakeLlm(toolOutput(...AC_CASES)), log: noLog });
    assert.equal(r.req.id, "4242");
    assert.match(readFileSync(r.csvPath, "utf8"), /4242 \| Verify/);
  });
});
