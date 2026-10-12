import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeCases, InvalidResponseError, InvalidStoryError, parseSuite, validateRequirement } from "../src/validation.js";
import { invalidLoginCase, LOGIN_AC, story, toolOutput, validLoginCase } from "./helpers.js";

describe("parseSuite", () => {
  it("accepts a well-formed response and normalises criterion refs", () => {
    const { suite, rejected } = parseSuite(toolOutput(validLoginCase, invalidLoginCase));
    assert.equal(suite.test_cases.length, 2);
    assert.deepEqual(suite.test_cases[1].covers, ["AC2"]);
    assert.deepEqual(rejected, []);
  });

  it("drops malformed test cases with a reason and keeps the rest", () => {
    const { suite, rejected } = parseSuite(toolOutput(
      validLoginCase,
      { ...validLoginCase, title: "  " },
      { ...validLoginCase, title: "Bad category", category: "happy" },
      { ...validLoginCase, title: "Bad priority", priority: 9 },
      { ...validLoginCase, title: "No steps", steps: [] },
      { ...validLoginCase, title: "Step without expected", steps: [{ action: "Click" }] },
      "not an object",
    ));
    assert.equal(suite.test_cases.length, 1);
    assert.deepEqual(rejected, [
      "Rejected test case #2: no title",
      'Rejected test case #3 "Bad category": invalid category "happy"',
      'Rejected test case #4 "Bad priority": invalid priority 9',
      'Rejected test case #5 "No steps": no steps',
      'Rejected test case #6 "Step without expected": step 1 has no expected result',
      "Rejected test case #7: not an object",
    ]);
  });

  it("accepts a numeric-string priority and upper-case category", () => {
    const { suite } = parseSuite(toolOutput({ ...validLoginCase, priority: "2", category: "Positive" }));
    assert.equal(suite.test_cases[0].priority, 2);
    assert.equal(suite.test_cases[0].category, "positive");
  });

  it("throws an actionable error when nothing is usable", () => {
    assert.throws(() => parseSuite("oops"), InvalidResponseError);
    assert.throws(() => parseSuite({ summary: "x" }), /"test_cases" is missing/);
    assert.throws(() => parseSuite(toolOutput()), /no test cases were returned/);
    assert.throws(() => parseSuite(toolOutput({ title: "x" })), /all 1 test cases were malformed/);
  });
});

describe("dedupeCases", () => {
  it("removes titles that differ only in case, spacing or punctuation", () => {
    const { suite } = parseSuite(toolOutput(
      validLoginCase,
      { ...validLoginCase, title: "verify user is redirected to dashboard, when email and password are valid." },
      invalidLoginCase,
    ));
    const { cases, removed } = dedupeCases(suite.test_cases);
    assert.equal(cases.length, 2);
    assert.equal(removed.length, 1);
  });
});

describe("validateRequirement", () => {
  it("passes a story with acceptance criteria", () => {
    assert.deepEqual(validateRequirement(story(LOGIN_AC), true), []);
  });

  it("rejects a story without a title", () => {
    assert.throws(() => validateRequirement(story(LOGIN_AC, { title: " " }), true), InvalidStoryError);
  });

  it("rejects a story without acceptance criteria in strict mode", () => {
    assert.throws(() => validateRequirement(story(""), true), /No acceptance criteria.*--no-strict/s);
  });

  it("only warns without acceptance criteria when not strict", () => {
    const warnings = validateRequirement(story(""), false);
    assert.match(warnings[0], /coverage was not checked/);
  });

  it("rejects an empty story even when not strict", () => {
    assert.throws(() => validateRequirement(story("", { description: "" }), false), /nothing to test/);
  });
});
