import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCoverage, hasEvidence, normaliseRef, parseCriteria } from "../src/coverage.js";
import { htmlToText } from "../src/sources.js";
import type { TestCase } from "../src/types.js";

const tc = (over: Partial<TestCase>): TestCase => ({
  title: "t", category: "positive", priority: 2, covers: [], steps: [], ...over,
});

describe("parseCriteria", () => {
  it("splits AC-numbered lines", () => {
    const c = parseCriteria("AC1: Login works.\nAC2: Errors are shown.");
    assert.deepEqual(c, [{ id: "AC1", text: "Login works." }, { id: "AC2", text: "Errors are shown." }]);
  });

  it("splits bullets and numbered lines and keeps wrapped lines with their item", () => {
    const c = parseCriteria("Acceptance Criteria:\n1. First rule\n   continues here\n2) Second rule\n- Third rule");
    assert.deepEqual(c.map((x) => x.text), ["First rule\ncontinues here", "Second rule", "Third rule"]);
  });

  it("keeps a Gherkin scenario together as one criterion", () => {
    const c = parseCriteria(`Scenario: valid login
Given a registered user
When they submit valid credentials
Then the dashboard is shown
Scenario: invalid login
Given a registered user
When they submit a wrong password
Then an error is shown`);
    assert.equal(c.length, 2);
    assert.match(c[1].text, /wrong password[\s\S]*error is shown/);
  });

  it("extracts each item of a nested HTML list separately", () => {
    const html = "<ul><li>Login form<ul><li>Email is required</li><li>Password is required</li></ul></li><li>Errors are shown</li></ul>";
    const c = parseCriteria(htmlToText(html));
    assert.deepEqual(c.map((x) => x.text), ["Login form", "Email is required", "Password is required", "Errors are shown"]);
  });

  it("returns nothing for empty or header-only text", () => {
    assert.deepEqual(parseCriteria(""), []);
    assert.deepEqual(parseCriteria("  \nAcceptance Criteria:\n"), []);
  });
});

describe("normaliseRef", () => {
  it("normalises criterion references", () => {
    assert.equal(normaliseRef("ac 1"), "AC1");
    assert.equal(normaliseRef("AC01: Valid login"), "AC1");
    assert.equal(normaliseRef("login"), null);
  });
});

describe("computeCoverage", () => {
  const criteria = [{
    id: "AC1",
    text: "Given an invalid email address, when the user submits the form, then an appropriate validation error is displayed.",
  }];

  it("does not validate a criterion that is only claimed (the case checks something else)", () => {
    const onlyChecksField = tc({
      id: "TC-001", title: "Verify email field is present on the form", covers: ["AC1"],
      steps: [{ action: "Open the registration form", expected: "Email field is displayed" }],
    });
    assert.equal(hasEvidence(criteria[0], onlyChecksField), false);
    const cov = computeCoverage(criteria, [onlyChecksField]);
    assert.equal(cov.criteria[0].status, "needs-review");
    assert.deepEqual(cov.needsReview, ["AC1"]);
    assert.deepEqual(cov.uncovered, []);
  });

  it("validates a criterion when a mapped case's steps address it", () => {
    const real = tc({
      id: "TC-002", title: "Verify validation error when an invalid email address is submitted", covers: ["AC1"],
      steps: [
        { action: "Enter {TestInvalidEmail} in the email address field", expected: "Value is entered" },
        { action: "Submit the form", expected: "A validation error for the email is displayed" },
      ],
    });
    const cov = computeCoverage(criteria, [real]);
    assert.equal(cov.criteria[0].status, "covered");
    assert.deepEqual(cov.criteria[0].evidenced, ["TC-002"]);
  });

  it("reports unknown and missing criteria", () => {
    const cov = computeCoverage(criteria, [tc({ id: "TC-001", covers: ["AC7"] })]);
    assert.deepEqual(cov.unknownRefs, ["AC7"]);
    assert.deepEqual(cov.uncovered, ["AC1"]);
    assert.equal(cov.criteria[0].status, "not-covered");
  });
});
