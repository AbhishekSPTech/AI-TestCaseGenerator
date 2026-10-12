// Scripted sessions of the interactive console app, with a fake LLM.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { consoleApp, type ConsoleDeps } from "../src/console.js";
import type { Llm } from "../src/generator.js";
import { AC_CASES, fakeLlm, toolOutput } from "./helpers.js";

/** Answers the prompts in order; after the last answer it behaves like closed stdin. */
function scripted(...answers: string[]) {
  const out: string[] = [];
  let i = 0;
  let eof = false;
  return {
    out,
    text: () => out.join("\n"),
    io: {
      ask: async (prompt: string) => {
        out.push(prompt);
        if (i < answers.length) return answers[i++];
        eof = true;
        return "";
      },
      ended: () => eof,
      print: (msg: string) => void out.push(msg),
    },
  };
}

function deps(llm: Llm, outDir = mkdtempSync(join(tmpdir(), "tcg-app-"))): ConsoleDeps & { outDir: string } {
  return { outDir, createLlm: () => llm, defaults: { outDir } };
}

const ADO_VARS = ["ADO_ORG", "ADO_PROJECT", "ADO_PAT"];
let savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  savedEnv = Object.fromEntries(ADO_VARS.map((n) => [n, process.env[n]]));
  ADO_VARS.forEach((n) => delete process.env[n]);
});
afterEach(() => {
  for (const [n, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
});

describe("consoleApp", () => {
  it("generates from the sample file, shows the review notes and quits", async () => {
    const s = scripted("2", "", "y", "5"); // Enter = default sample file
    const d = deps(fakeLlm(toolOutput(...AC_CASES)));
    await consoleApp(s.io, d);
    const text = s.text();
    assert.match(text, /LLM: +fake/);
    assert.match(text, /Story file \[samples[\\/]login_story\.txt\]/);
    assert.match(text, /Result: PASS — every acceptance criterion/);
    assert.match(text, /Coverage \(validated\): 4\/4/); // from the review notes shown on "y"
    const stem = "manual_as-a-registered-user-i-want-to-log-in-wi"; // slug is capped at 40 characters
    assert.deepEqual(readdirSync(d.outDir).sort(), [`${stem}_azure_import.csv`, `${stem}_review.txt`]);
  });

  it("keeps running after an error and after an unknown choice", async () => {
    const s = scripted("9", "2", "missing.txt", "2", "", "n", "q");
    const llm = fakeLlm(toolOutput(...AC_CASES));
    await consoleApp(s.io, deps(llm));
    const text = s.text();
    assert.match(text, /Please choose 1-5/);
    assert.match(text, /File not found: missing\.txt/);
    assert.equal(llm.calls.length, 1);
  });

  it("shows a failed run as an error and returns to the menu", async () => {
    const s = scripted("2", "", "5");
    await consoleApp(s.io, deps(fakeLlm(new Error("401 invalid x-api-key"))));
    assert.match(s.text(), /Error: 401 invalid x-api-key/);
    assert.match(s.text(), /Choose \[1-5\]: [\s\S]*Choose \[1-5\]: /);
  });

  it("explains missing Azure DevOps settings instead of asking for an id", async () => {
    const s = scripted("1", "5");
    await consoleApp(s.io, deps(fakeLlm()));
    assert.match(s.text(), /Azure DevOps is not configured: set ADO_ORG, ADO_PROJECT, ADO_PAT/);
    assert.ok(!s.out.some((l) => l.startsWith("Work item id")));
  });

  it("rejects a non-numeric work item id", async () => {
    ADO_VARS.forEach((n) => { process.env[n] = "x"; });
    const s = scripted("1", "abc", "5");
    const llm = fakeLlm();
    await consoleApp(s.io, deps(llm));
    assert.match(s.text(), /"abc" is not a work item id/);
    assert.equal(llm.calls.length, 0);
  });

  it("changes settings and uses them for the next run", async () => {
    const outDir = join(mkdtempSync(join(tmpdir(), "tcg-app-")), "custom");
    // provider: invalid then valid, output folder, strict off, extra instructions, back; then generate
    const s = scripted("4", "1", "gpt", "1", "claude", "2", outDir, "3", "4", "include accessibility checks", "5",
      "2", "", "n", "5");
    const providers: string[] = [];
    const llm = fakeLlm(toolOutput(AC_CASES[0]), toolOutput(AC_CASES[0])); // AC2-4 stay uncovered
    await consoleApp(s.io, { createLlm: (p) => (providers.push(p), llm) });
    const text = s.text();
    assert.match(text, /Unknown provider "gpt"/);
    assert.ok(providers.includes("claude"));
    assert.match(text, /Strict coverage: off/);
    assert.match(llm.calls[0], /include accessibility checks/);
    assert.match(text, /Result: INCOMPLETE — not covered: AC2, AC3, AC4 \(--no-strict\)/);
    assert.ok(existsSync(outDir));
  });

  it("reads a typed-in story through the same input", async () => {
    const s = scripted("3", "", "Login", "Users log in", "", "AC1: Valid email and password redirects the user to /dashboard.", "", "n", "5");
    const llm = fakeLlm(toolOutput(AC_CASES[0]));
    await consoleApp(s.io, deps(llm));
    assert.match(s.text(), /Loaded manual story MANUAL: Login/);
    assert.match(s.text(), /Result: PASS/);
  });

  it("ends when the input ends", async () => {
    const s = scripted("4");
    await consoleApp(s.io, deps(fakeLlm())); // must return, not loop forever
    assert.ok(s.out.length > 0);
  });
});
