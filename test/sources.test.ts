import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, mock } from "node:test";
import { fetchAzureStory, htmlToText, loadFromFile } from "../src/sources.js";

describe("htmlToText", () => {
  it("decodes named, decimal and hex entities, including characters outside the BMP", () => {
    assert.equal(htmlToText("Tom &amp; Jerry&#39;s &quot;app&quot; &#x1F600; &lt;3"), "Tom & Jerry's \"app\" 😀 <3");
  });

  it("decodes each entity only once", () => {
    assert.equal(htmlToText("&amp;lt;b&amp;gt; and &amp;#39;"), "&lt;b&gt; and &#39;");
  });

  it("turns block elements into line breaks and drops tags", () => {
    assert.equal(htmlToText("<div>First</div><div><b>Second</b>&nbsp;line<br>Third</div>"), "First\nSecond line\nThird");
  });

  it("returns an empty string for missing fields", () => {
    assert.equal(htmlToText(undefined), "");
    assert.equal(htmlToText(null), "");
  });
});

describe("loadFromFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "tcg-"));
  const file = (name: string, text: string) => {
    const p = join(dir, name);
    writeFileSync(p, text, "utf8");
    return p;
  };

  it("reads the sample story", () => {
    const r = loadFromFile("samples/login_story.txt");
    assert.equal(r.id, "99999");
    assert.match(r.title, /^As a registered user/);
    assert.equal(r.criteria.length, 4);
    assert.equal(r.criteria[2].id, "AC3");
  });

  it("handles a BOM, CRLF and leading blank lines", () => {
    const r = loadFromFile(file("crlf.txt", "﻿\r\n\r\nMy title\r\nSome text\r\nAcceptance Criteria:\r\n- One\r\n- Two\r\n"));
    assert.equal(r.title, "My title");
    assert.equal(r.description, "Some text");
    assert.deepEqual(r.criteria.map((c) => c.text), ["One", "Two"]);
  });

  it("returns an empty story for an empty file (rejected later by validateRequirement)", () => {
    const r = loadFromFile(file("empty.txt", ""));
    assert.equal(r.title, "");
    assert.deepEqual(r.criteria, []);
  });
});

describe("fetchAzureStory", () => {
  afterEach(() => mock.restoreAll());

  const respond = (status: number, body: string, contentType = "application/json") =>
    mock.method(globalThis, "fetch", async () => new Response(body, { status, headers: { "content-type": contentType } }));

  it("maps the work item fields", async () => {
    const fetchMock = respond(200, JSON.stringify({
      id: 123,
      fields: {
        "System.Title": " Login ",
        "System.Description": "<p>Users log in</p>",
        "Microsoft.VSTS.Common.AcceptanceCriteria": "<ol><li>Valid login works</li><li>Errors &amp; messages</li></ol>",
        "System.AreaPath": "Proj\\Team",
      },
    }));
    const r = await fetchAzureStory("my org", "My Project", "123", "pat");
    assert.equal(r.title, "Login");
    assert.equal(r.areaPath, "Proj\\Team");
    assert.deepEqual(r.criteria.map((c) => c.text), ["Valid login works", "Errors & messages"]);
    const url = String(fetchMock.mock.calls[0].arguments[0]);
    assert.equal(url, "https://dev.azure.com/my%20org/My%20Project/_apis/wit/workitems/123?api-version=7.1");
  });

  it("explains a rejected PAT, including the 203 sign-in page Azure DevOps returns", async () => {
    respond(203, "<html>Sign in</html>", "text/html");
    await assert.rejects(fetchAzureStory("org", "proj", "1", "bad"), /PAT was rejected \(203\)/);
  });

  it("explains a missing work item", async () => {
    respond(404, "{}");
    await assert.rejects(fetchAzureStory("org", "proj", "1", "pat"), /not found \(404\)/);
  });

  it("rejects a non-numeric id without calling Azure DevOps", async () => {
    const fetchMock = respond(200, "{}");
    await assert.rejects(fetchAzureStory("org", "proj", "12/../../x", "pat"), /must be a number/);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
