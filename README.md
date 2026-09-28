# Test Case Generator Agent (TypeScript)

User Story (Azure DevOps board or manual input) -> Claude -> positive / negative / edge test cases -> Azure Test Plans import CSV.

## Setup (Node 18+)
    npm install
    cp .env.example .env   # fill in ANTHROPIC_API_KEY (+ ADO_* for --azure)

## Run
    npm start -- --azure 12345                  # read user story 12345 from the Azure board
    npm start -- --file samples/login_story.txt # manual input from a text file
    npm start                                   # manual input typed into the terminal
    npm start -- --azure 12345 --instructions "include accessibility checks"
    npm start -- --azure 12345 --no-strict      # don't exit 1 when an AC is uncovered

Manual text file format: first line is the title, then the description, then a line
`Acceptance Criteria:` followed by the criteria (see `samples/login_story.txt`).

Acceptance criteria are split into AC1, AC2, ... (one per bullet / numbered line / "ACn:" line,
or one per Gherkin scenario) and every test case records which ACs it covers.

## Output (in ./output)
| File | Contents |
|------|----------|
| `<story>_azure_import.csv` | Azure Test Plans > your test suite > "Import test cases from CSV". Titles look like `TC-001 [NEGATIVE] Verify ...`; tagged `ai-generated`, category and covered ACs; preconditions / test data become step 1. |
| `<story>_review.txt` | Coverage per AC, open questions, assumptions, warnings and a test case index – read before importing. |

## Coverage check and exit codes
If the first pass leaves an AC uncovered, the agent asks Claude once more for tests for just those ACs.

| Code | Meaning |
|------|---------|
| `0` | All acceptance criteria covered (or `--no-strict`) |
| `1` | One or more criteria still not covered (files are still written), or an error |

## Project layout
    src/types.ts      shared interfaces (Requirement, TestCase, TestSuite)
    src/sources.ts    Azure DevOps fetch + manual input (file / terminal)
    src/generator.ts  prompt + Claude call (tune SYSTEM_PROMPT here)
    src/coverage.ts   split ACs into AC1..n, coverage calculation
    src/exporters.ts  Azure Test Plans CSV export
    src/reporter.ts   console summary + review file
    src/main.ts       CLI
