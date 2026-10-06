# Test Case Generator Agent (TypeScript)

User Story (Azure DevOps board or manual input) -> Claude (or Azure OpenAI) -> positive / negative / edge test cases -> Azure Test Plans import CSV.

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
If the first pass leaves an AC uncovered, the agent asks the LLM once more for tests for just those ACs.

| Code | Meaning |
|------|---------|
| `0` | All acceptance criteria covered (or `--no-strict`) |
| `1` | One or more criteria still not covered (files are still written), or an error |

## Project layout
    src/types.ts      shared interfaces (Requirement, TestCase, TestSuite)
    src/sources.ts    Azure DevOps fetch + manual input (file / terminal)
    src/generator.ts  prompt + Claude / Azure OpenAI call (tune SYSTEM_PROMPT here)
    src/coverage.ts   split ACs into AC1..n, coverage calculation
    src/exporters.ts  Azure Test Plans CSV export
    src/reporter.ts   console summary + review file
    src/main.ts       CLI
