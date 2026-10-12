# Test Case Generator Agent (TypeScript)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![LLM: Claude | Azure OpenAI](https://img.shields.io/badge/LLM-Claude%20%7C%20Azure%20OpenAI-6E56CF)](#choosing-the-llm)

A command-line agent that turns a user story into a ready-to-import set of manual test cases.
Give it a story from an Azure DevOps board, a text file or the terminal; it asks an LLM (Claude or
Azure OpenAI) for positive, negative and edge-case tests, checks that every acceptance criterion
is covered, and writes a CSV you can import straight into Azure Test Plans plus a review file
with coverage, open questions and assumptions.

User Story (Azure DevOps board or manual input) -> Claude (or Azure OpenAI) -> positive / negative / edge test cases -> Azure Test Plans import CSV.

**Features**
- Reads user stories from Azure DevOps (`--azure <id>`), a text file or typed input
- Splits acceptance criteria into AC1..n and tracks which test cases cover each one
- Treats LLM output as untrusted: every response is validated, malformed test cases are dropped
  (and reported), duplicates are removed
- Checks coverage independently of the model's own claims (mapped vs. validated coverage)
- Re-asks the LLM for any criterion left uncovered; exits 1 if one is still missing (CI-friendly)
- Uses `{TestPlaceholder}` values instead of invented test data
- Exports Azure Test Plans-compatible CSV (same columns as an Azure export)
- Unit and end-to-end tests run against a fake LLM: no API keys, no cost, deterministic

## Setup (Node 18+)
    npm install
    cp .env.example .env   # fill in your API key(s), ADO_PAT (for --azure) and ADO_ASSIGNED_TO

## Configuration
All settings live in `.env` (gitignored). `.env.example` lists every setting with comments on what it
does and where to get each key. Real environment variables (e.g. pipeline variables in CI) take
precedence over `.env`.

## Run
    npm start -- --azure 12345                  # read user story 12345 from the Azure board
    npm start -- --file samples/login_story.txt # manual input from a text file
    npm start                                   # manual input typed into the terminal
    npm start -- --azure 12345 --instructions "include accessibility checks"
    npm start -- --azure 12345 --no-strict      # don't exit 1 when an AC is uncovered
    npm start -- --file story.txt --story-id 12345   # manual story: prefix titles with "12345 | "
    npm start -- --azure 12345 --provider azure-openai   # pick the LLM for this run

## Choosing the LLM
Set `LLM_PROVIDER` in `.env`, or override it per run with `--provider`:

| Value | Uses | Needs |
|-------|------|-------|
| `claude` | Claude (`CLAUDE_MODEL`) | `ANTHROPIC_API_KEY` |
| `azure-openai` | Azure OpenAI deployment | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` |
| `auto` (default) | Azure OpenAI if its endpoint, deployment and key are all set, otherwise Claude | |

Manual text file format: an optional `User Story #<id>` line (e.g. `User Story #12345`), then the title, then the description,
then a line `Acceptance Criteria:` followed by the criteria (see `samples/login_story.txt`;
`samples/login_story_azure_import.csv` is the CSV generated from it, for reference).
The id prefixes every test case title (`12345 | Verify ...`); `--story-id` overrides it.

Acceptance criteria are split into AC1, AC2, ... (one per bullet / numbered line / "ACn:" line,
or one per Gherkin scenario) and every test case records which ACs it covers.

## Output (in ./output)
| File | Contents |
|------|----------|
| `<story>_azure_import.csv` | Azure Test Plans > your test suite > "Import test cases from CSV". Same columns as an Azure Test Plans export (ID, Work Item Type, Title, Test Step, Step Action, Step Expected, Area Path, Assigned To, State). Titles look like `12345 \| Verify ...` (story id prefix for Azure stories); Area Path / Assigned To come from the work item or `ADO_AREA_PATH` / `ADO_ASSIGNED_TO`; preconditions / test data become step 1. Category, priority and covered ACs are in the review file. |
| `<story>_review.txt` | Coverage per AC, open questions, assumptions, warnings and a test case index – read before importing. |

## Coverage check and exit codes
A story without a title, or (in strict mode) without acceptance criteria, is rejected **before** any
LLM call. If the first pass leaves an AC uncovered, the agent asks the LLM once more for tests for
just those ACs; there is never more than one follow-up call. If that call fails, the first pass is
kept and the failure is listed under Warnings.

The model's `covers` list is only a claim, so each AC gets one of three statuses in the review file:

| Status | Meaning |
|--------|---------|
| `covered` | At least one test case claims the AC **and** its title/steps/expected results mention enough of the AC's key terms |
| `NEEDS REVIEW` | Test cases claim the AC, but none of them clearly mentions what it is about — check them by hand |
| `NOT COVERED` | No test case claims the AC |

The review file reports both numbers ("Coverage (mapped)" and "Coverage (validated)"), lists the
test case ids per AC, and starts with a one-line result (`PASS`, `PASS, REVIEW NEEDED`, `FAIL`).
The validation is a keyword check, not proof: it catches tests that are mapped to the wrong AC
or test something else, and it can flag a valid test that uses different wording. That's why it
asks for a review instead of failing the run.

| Code | Meaning |
|------|---------|
| `0` | Every AC has at least one test case (some may need review), or `--no-strict` |
| `1` | An AC is still not covered (files are still written), the story has no ACs, or an error |

## Tests
    npm test            # unit + end-to-end tests with a fake LLM (Node 22 recommended)
    npm run typecheck

What the tests cover: AC parsing (numbered, bulleted, Gherkin, nested HTML lists), HTML entity
decoding, Azure DevOps errors (bad PAT, 404, bad id), response validation (malformed, duplicate and
empty responses), the bounded follow-up call, coverage statuses, CSV escaping against a golden file
(`test/golden/azure_import.csv`; regenerate it with `UPDATE_GOLDEN=1 npm test` after an intended
format change), and the full run with its exit codes. CI runs both on every push
(`.github/workflows/ci.yml`).

## Project layout
    src/types.ts       shared interfaces (Requirement, TestCase, TestSuite)
    src/sources.ts     Azure DevOps fetch + manual input (file / terminal)
    src/generator.ts   prompt + Claude / Azure OpenAI call (tune SYSTEM_PROMPT here)
    src/validation.ts  runtime checks of the LLM output and the loaded story
    src/coverage.ts    split ACs into AC1..n, mapped + validated coverage
    src/exporters.ts   Azure Test Plans CSV export
    src/reporter.ts    console summary + review file
    src/run.ts         the workflow, returns a result (no process.exit; used by the tests)
    src/main.ts        CLI: arguments -> run() -> exit code
    test/              node:test suites, fake LLM in test/helpers.ts
