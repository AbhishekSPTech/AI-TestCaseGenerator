/**
 * Interactive console app:   npm run app
 * A menu for generating test cases from Azure DevOps, a story file or typed input.
 * Same settings (.env) and output as the command-line tool in main.ts.
 */
import "dotenv/config";
import { consoleApp } from "./console.js";
import { openTerminal } from "./sources.js";

const term = openTerminal();
consoleApp({ ask: term.ask, ended: term.ended, print: (msg) => console.log(msg) })
  .then(() => console.log("Bye."))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => term.close());
