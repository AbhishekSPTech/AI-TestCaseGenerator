/**
 * Interactive console app: a menu around run(), so nobody has to remember command-line flags.
 * Errors are shown and the menu comes back; it only ends on Quit or end of input.
 * I/O and the LLM factory are injected so tests can script a whole session.
 */
import { existsSync, readFileSync } from "node:fs";
import { createLlm, type Llm, PROVIDERS, type Provider } from "./generator.js";
import { run, type StorySource } from "./run.js";
import { type Ask, resolveStoryFile } from "./sources.js";

export interface ConsoleIo {
  ask: Ask;
  ended: () => boolean; // no more input (stdin closed)
  print: (msg: string) => void;
}

export interface Settings {
  provider: Provider;
  outDir: string;
  strict: boolean;
  instructions: string;
}

export interface ConsoleDeps {
  createLlm?: (provider: Provider) => Llm;
  defaults?: Partial<Settings>;
}

const ADO_VARS = ["ADO_ORG", "ADO_PROJECT", "ADO_PAT"];
const SAMPLE = "samples/login_story.txt";
const LINE = "─".repeat(60);

function envProvider(): Provider {
  const p = (process.env.LLM_PROVIDER || "auto").trim().toLowerCase() as Provider;
  return PROVIDERS.includes(p) ? p : "auto";
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function consoleApp(io: ConsoleIo, deps: ConsoleDeps = {}): Promise<void> {
  const makeLlm = deps.createLlm ?? createLlm;
  const settings: Settings = {
    provider: envProvider(), outDir: "output", strict: true, instructions: "", ...deps.defaults,
  };
  let lastFile = existsSync(SAMPLE) ? SAMPLE : "";

  /** The LLM for the current provider, or the reason it isn't configured. */
  const llmStatus = (): { llm?: Llm; text: string } => {
    try {
      const llm = makeLlm(settings.provider);
      return { llm, text: llm.name };
    } catch (err) {
      return { text: `not configured — ${errorText(err)}` };
    }
  };

  const showMenu = () => {
    const missingAdo = ADO_VARS.filter((n) => !process.env[n]);
    io.print("");
    io.print(LINE);
    io.print(" Test Case Generator");
    io.print(LINE);
    io.print(` LLM:          ${llmStatus().text}`);
    io.print(` Azure DevOps: ${missingAdo.length ? `not configured (set ${missingAdo.join(", ")} in .env)` : process.env.ADO_ORG}`);
    io.print(` Output:       ${settings.outDir}    Strict coverage: ${settings.strict ? "on" : "off"}`);
    io.print(LINE);
    io.print("  1) Generate from an Azure DevOps work item");
    io.print("  2) Generate from a story text file");
    io.print("  3) Type in a user story");
    io.print("  4) Settings");
    io.print("  5) Quit");
  };

  async function askAzure(): Promise<StorySource | null> {
    const missing = ADO_VARS.filter((n) => !process.env[n]);
    if (missing.length) {
      io.print(`Azure DevOps is not configured: set ${missing.join(", ")} in .env (see .env.example).`);
      return null;
    }
    const id = (await io.ask("Work item id (Enter to go back): ")).trim();
    if (!id) return null;
    if (!/^\d+$/.test(id)) {
      io.print(`"${id}" is not a work item id — it must be a number.`);
      return null;
    }
    return { kind: "azure", id };
  }

  async function askFile(): Promise<StorySource | null> {
    const hint = lastFile ? ` [${lastFile}]` : "";
    const answer = (await io.ask(`Story file${hint} (Enter ${lastFile ? "for the default" : "to go back"}): `)).trim();
    const path = answer || lastFile;
    if (!path) return null;
    const found = resolveStoryFile(path);
    if (!found) {
      io.print(`File not found: ${path}`);
      return null;
    }
    lastFile = found;
    return { kind: "file", path: found };
  }

  async function settingsMenu(): Promise<void> {
    for (;;) {
      io.print("");
      io.print("Settings");
      io.print(`  1) LLM provider:       ${settings.provider} (${PROVIDERS.join(" / ")})`);
      io.print(`  2) Output folder:      ${settings.outDir}`);
      io.print(`  3) Strict coverage:    ${settings.strict ? "on  (exit code 1 / FAIL when an AC is not covered)" : "off"}`);
      io.print(`  4) Extra instructions: ${settings.instructions || "(none)"}`);
      io.print("  5) Back");
      const choice = (await io.ask("Choose [1-5]: ")).trim();
      if (io.ended() && !choice) return;
      switch (choice) {
        case "1": {
          const p = (await io.ask(`Provider (${PROVIDERS.join(", ")}): `)).trim().toLowerCase() as Provider;
          if (PROVIDERS.includes(p)) settings.provider = p;
          else io.print(`Unknown provider "${p}".`);
          break;
        }
        case "2": {
          const dir = (await io.ask(`Output folder [${settings.outDir}]: `)).trim();
          if (dir) settings.outDir = dir;
          break;
        }
        case "3":
          settings.strict = !settings.strict;
          break;
        case "4":
          settings.instructions = (await io.ask("Extra instructions for the LLM (Enter to clear): ")).trim();
          break;
        case "5":
        case "":
          return;
        default:
          io.print("Please choose 1-5.");
      }
    }
  }

  async function generate(source: StorySource): Promise<void> {
    const { llm, text } = llmStatus();
    if (!llm) {
      io.print(`The LLM is ${text}`);
      return;
    }
    io.print("");
    try {
      const r = await run({ ...settings, source }, { llm, log: io.print });
      io.print("");
      io.print(`Azure import CSV: ${r.csvPath}`);
      io.print(`Review notes:     ${r.reviewPath}`);
      if (r.exitCode) io.print(`Not covered: ${r.coverage.uncovered.join(", ")} — check the review notes before importing.`);
      const show = (await io.ask("Show the review notes now? [y/N]: ")).trim().toLowerCase();
      if (show === "y" || show === "yes") {
        io.print("");
        io.print(readFileSync(r.reviewPath, "utf8").trimEnd());
      }
    } catch (err) {
      io.print(`Error: ${errorText(err)}`);
    }
  }

  for (;;) {
    showMenu();
    const choice = (await io.ask("Choose [1-5]: ")).trim().toLowerCase();
    if (io.ended() && !choice) return;
    let source: StorySource | null = null;
    switch (choice) {
      case "1":
        source = await askAzure();
        break;
      case "2":
        source = await askFile();
        break;
      case "3":
        source = { kind: "prompt", ask: io.ask };
        break;
      case "4":
        await settingsMenu();
        break;
      case "5":
      case "q":
      case "quit":
      case "exit":
        return;
      default:
        io.print("Please choose 1-5.");
    }
    if (source) await generate(source);
  }
}
