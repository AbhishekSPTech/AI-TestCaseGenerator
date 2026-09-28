# Test Case Generator Agent (TypeScript)

User Story (Azure DevOps / Jira) -> Claude -> positive / negative / edge test cases -> Azure Test Plans CSV, TestRail CSV, JSON (optional direct push).

## Setup (Node 18+)
    npm install
    cp .env.example .env   # fill in keys

## Run
    npm start -- --azure 12345
    npm start -- --jira PROJ-42 --instructions "include accessibility checks"
    npm start -- --azure 12345 --push-azure      # creates Test Cases linked to the story
    npm run build && node dist/main.js --azure 12345   # compiled JS, e.g. for pipelines

## Project layout
    src/types.ts      shared interfaces (Requirement, TestCase, TestSuite)
    src/sources.ts    Azure DevOps / Jira / file input
    src/generator.ts  prompt + Claude call (tune SYSTEM_PROMPT here)
    src/exporters.ts  CSV / JSON export and direct push to Azure / TestRail
    src/main.ts       CLI

## Outputs (in ./output)
- `*_testcases.json` – full suite incl. assumptions and open questions (review this first)
- `*_azure_import.csv` – Azure Test Plans > your suite > "Import test cases from CSV"
- `*_testrail_import.csv` – TestRail > Test Cases > Import > CSV; choose "multiple rows per case", Title starts a new case

## Recommended workflow
Generate -> QA reviews JSON/CSV and answers open questions -> import or re-run with `--push-*`.
