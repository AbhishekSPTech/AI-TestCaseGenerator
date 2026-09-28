/** Fetch a requirement (user story) from Azure DevOps, Jira, or a local text file. */
import { readFileSync } from "node:fs";
import type { Requirement } from "./types.js";

export function basicAuth(user: string, secret: string): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}` };
}

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${await res.text()}`);
  return res.json();
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
    `<acceptance_criteria>\n${r.acceptanceCriteria || "(none provided)"}\n</acceptance_criteria>`,
    `</user_story>`,
  ].join("\n");
}

// ------------------------------------------------------------------ Azure DevOps
export async function fetchAzureStory(
  org: string, project: string, workItemId: string, pat: string,
): Promise<Requirement> {
  const url = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/wit/workitems/${workItemId}?api-version=7.1`;
  const data = await getJson(url, basicAuth("", pat));
  const f = data.fields ?? {};
  return {
    source: "azure",
    id: String(data.id),
    title: f["System.Title"] ?? "",
    description: htmlToText(f["System.Description"]),
    acceptanceCriteria: htmlToText(f["Microsoft.VSTS.Common.AcceptanceCriteria"]),
    areaPath: f["System.AreaPath"],
    iterationPath: f["System.IterationPath"],
    apiUrl: data.url,
  };
}

// ------------------------------------------------------------------ Jira
export async function fetchJiraIssue(
  baseUrl: string, key: string, email: string, token: string, acField?: string,
): Promise<Requirement> {
  // API v2 returns description as plain wiki text (v3 returns Atlassian Document Format JSON)
  const data = await getJson(`${baseUrl.replace(/\/$/, "")}/rest/api/2/issue/${key}`, basicAuth(email, token));
  const f = data.fields ?? {};
  return {
    source: "jira",
    id: key,
    title: f.summary ?? "",
    description: f.description ?? "",
    acceptanceCriteria: acField ? (f[acField] ?? "") : "",
  };
}

// ------------------------------------------------------------------ Local file (prompt tuning)
export function loadFromFile(path: string): Requirement {
  const [first, ...rest] = readFileSync(path, "utf8").split("\n");
  return {
    source: "file", id: "LOCAL-1", title: first.trim(),
    description: rest.join("\n").trim(), acceptanceCriteria: "",
  };
}
