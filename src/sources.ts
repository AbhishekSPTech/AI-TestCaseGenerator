// Get a requirement (user story) from Azure DevOps or from manual input (text file or typed in).
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseCriteria } from "./coverage.js";
import type { Requirement } from "./types.js";

function basicAuth(user: string, secret: string): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}` };
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
};

/** Azure DevOps stores Description / Acceptance Criteria as HTML. */
export function htmlToText(s?: string | null): string {
  if (!s) return "";
  return s
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>|<\/h\d>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function requirementToPrompt(r: Requirement): string {
  return [
    `<user_story id="${r.id}" source="${r.source}">`,
    `<title>${r.title}</title>`,
    `<description>\n${r.description || "(none provided)"}\n</description>`,
    `<acceptance_criteria>\n${r.criteria.length
      ? r.criteria.map((c) => `<criterion id="${c.id}">${c.text}</criterion>`).join("\n")
      : "(none provided)"}\n</acceptance_criteria>`,
    `</user_story>`,
  ].join("\n");
}

// ------------------------------------------------------------------ Azure DevOps
export async function fetchAzureStory(
  org: string, project: string, workItemId: string, pat: string,
): Promise<Requirement> {
  const url = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/wit/workitems/${workItemId}?api-version=7.1`;
  const res = await fetch(url, { headers: basicAuth("", pat) });
  if (!res.ok) throw new Error(`Azure DevOps GET work item ${workItemId} failed: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  const f = data.fields ?? {};
  const acceptanceCriteria = htmlToText(f["Microsoft.VSTS.Common.AcceptanceCriteria"]);
  return {
    source: "azure",
    id: String(data.id),
    title: f["System.Title"] ?? "",
    description: htmlToText(f["System.Description"]),
    acceptanceCriteria,
    criteria: parseCriteria(acceptanceCriteria),
    areaPath: f["System.AreaPath"],
  };
}

// Manual input
const STORY_ID_LINE = /^\s*(?:user\s*story|story|id)\s*(?:id)?\s*[:#]?\s*(\d+)\s*$/i;

// Text file: optional "User Story <id>" line, then title; an "Acceptance Criteria:" line splits description from AC.
export function loadFromFile(path: string): Requirement {
  let [first, ...rest] = readFileSync(path, "utf8").replace(/\r/g, "").split("\n");
  const storyId = first.match(STORY_ID_LINE)?.[1];
  if (storyId) [first, ...rest] = rest;
  const body = rest.join("\n");
  const m = body.match(/^\s*acceptance criteria\s*:?\s*$/im);
  const description = (m ? body.slice(0, m.index) : body).replace(/^\s*description\s*:\s*/i, "").trim();
  const acceptanceCriteria = m ? body.slice(m.index! + m[0].length).trim() : "";
  return {
    source: "manual", id: storyId ?? "MANUAL", title: (first ?? "").trim(), description,
    acceptanceCriteria, criteria: parseCriteria(acceptanceCriteria),
  };
}

// Interactive entry in the terminal. Multi-line fields end with an empty line.
export async function promptForStory(): Promise<Requirement> {
  // Read via the line iterator (not rl.question) so piped input isn't dropped.
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string> => {
    process.stdout.write(prompt);
    const next = await lines.next();
    return next.done ? "" : next.value;
  };
  const multiline = async (label: string): Promise<string> => {
    console.log(`${label} (finish with an empty line):`);
    const out: string[] = [];
    for (;;) {
      const line = await ask("> ");
      if (!line.trim()) break;
      out.push(line);
    }
    return out.join("\n");
  };
  try {
    const storyId = (await ask("User story ID (optional): ")).trim();
    const title = (await ask("User story title: ")).trim();
    if (!title) throw new Error("A title is required.");
    const description = await multiline("Description");
    const acceptanceCriteria = await multiline("Acceptance criteria");
    return {
      source: "manual", id: storyId || "MANUAL", title, description,
      acceptanceCriteria, criteria: parseCriteria(acceptanceCriteria),
    };
  } finally {
    rl.close();
  }
}
