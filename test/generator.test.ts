import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateTestCases } from "../src/generator.js";
import { InvalidResponseError } from "../src/validation.js";
import { edgeCase, fakeLlm, invalidLoginCase, LOGIN_AC, noLog, story, toolOutput, validLoginCase } from "./helpers.js";

describe("generateTestCases", () => {
  it("makes a single call when the first pass covers every criterion", async () => {
    const llm = fakeLlm(toolOutput(validLoginCase, invalidLoginCase, edgeCase));
    const suite = await generateTestCases(story(LOGIN_AC), llm, { log: noLog });
    assert.equal(llm.calls.length, 1);
    assert.deepEqual(suite.test_cases.map((c) => c.id), ["TC-001", "TC-002", "TC-003"]);
    assert.deepEqual(suite.warnings, []);
  });

  it("asks once more for uncovered criteria and removes duplicates from the second pass", async () => {
    const llm = fakeLlm(
      toolOutput(validLoginCase, edgeCase),
      toolOutput({ ...validLoginCase }, invalidLoginCase), // repeats a first-pass case
    );
    const suite = await generateTestCases(story(LOGIN_AC), llm, { log: noLog });
    assert.equal(llm.calls.length, 2);
    assert.match(llm.calls[1], /do not cover AC2/);
    assert.match(llm.calls[1], /<existing_test_cases>\n- Verify user is redirected/);
    assert.equal(suite.test_cases.length, 3);
    assert.deepEqual(suite.test_cases.map((c) => c.id), ["TC-001", "TC-002", "TC-003"]);
    assert.ok(suite.warnings?.some((w) => w.startsWith("Removed duplicate test case")));
  });

  it("stops after the follow-up call even if a criterion is still uncovered", async () => {
    const llm = fakeLlm(toolOutput(validLoginCase), toolOutput(edgeCase));
    const suite = await generateTestCases(story(LOGIN_AC), llm, { log: noLog });
    assert.equal(llm.calls.length, 2);
    assert.ok(!suite.test_cases.some((c) => c.covers?.includes("AC2")));
  });

  it("keeps the first pass and warns when the follow-up call fails", async () => {
    const llm = fakeLlm(toolOutput(validLoginCase), new Error("Request timed out."));
    const suite = await generateTestCases(story(LOGIN_AC), llm, { log: noLog });
    assert.equal(suite.test_cases.length, 1);
    assert.ok(suite.warnings?.some((w) => /Follow-up call for AC2 failed.*timed out/.test(w)));
  });

  it("fails when the first response is unusable", async () => {
    const llm = fakeLlm({ summary: "no cases" });
    await assert.rejects(generateTestCases(story(LOGIN_AC), llm, { log: noLog }), InvalidResponseError);
  });

  it("fails when the provider fails on the first call", async () => {
    const llm = fakeLlm(new Error("401 invalid x-api-key"));
    await assert.rejects(generateTestCases(story(LOGIN_AC), llm, { log: noLog }), /invalid x-api-key/);
  });

  it("reports malformed cases and missing categories as warnings", async () => {
    const llm = fakeLlm(toolOutput(validLoginCase, invalidLoginCase, { title: "broken" }));
    const suite = await generateTestCases(story(LOGIN_AC), llm, { log: noLog });
    assert.ok(suite.warnings?.includes('Rejected test case #3 "broken": invalid category undefined'));
    assert.ok(suite.warnings?.includes("No edge test cases were generated."));
  });
});
