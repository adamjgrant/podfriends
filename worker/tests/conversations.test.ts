import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
test("the inbox switches private conversations without carrying messages across chats", async () => {
  const dom = new JSDOM(readFileSync("../frontend/index.html", "utf8"), {
    url: "https://example.com/",
    runScripts: "outside-only",
  });
  const w = dom.window;
  w.AbortSignal = AbortSignal as any;
  w.setInterval = (() => 0) as any;
  const chats = ["q1", "q2"].map((id, i) => ({
    id,
    partner: { display_name: i ? "Jamie" : "Alex", onboarding_completed: 1 },
    shared_podcasts: [{ id: "123", title: "A Shared Show" }],
  }));
  const calls: string[] = [];
  w.localStorage.setItem("podfriends_token", "session");
  w.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path.endsWith("/me"))
      return new Response(
        JSON.stringify({
          user: { id: "u", name: "User" },
          profile: { onboarding_completed: 1, icebreakers_json: "{}" },
          podcasts: [{ id: "123", title: "Show" }],
          chats,
          quartet: chats[0],
        }),
      );
    const id = path.includes("/q2") ? "q2" : "q1";
    if (path.endsWith("/messages"))
      return new Response(
        JSON.stringify({
          messages: [
            {
              id: id + "-message",
              type: "chat",
              body: "Hello from " + id,
              created_at: new Date().toISOString(),
            },
          ],
        }),
      );
    return new Response(JSON.stringify({ quartet: { name: id }, members: [] }));
  };
  try {
    const result = await build({
      entryPoints: ["../frontend/app.js"],
      bundle: true,
      write: false,
      format: "iife",
    });
    w.eval(result.outputFiles[0].text);
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(w.document.querySelectorAll(".conversation-card").length, 2);
    assert.match(
      w.document.getElementById("messages")!.textContent!,
      /Hello from q1/,
    );
    (
      w.document.querySelectorAll(".conversation-card")[1] as HTMLButtonElement
    ).click();
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(
      w.document.getElementById("quartet-name")!.textContent,
      "Jamie",
    );
    assert.match(
      w.document.getElementById("messages")!.textContent!,
      /Hello from q2/,
    );
    assert.doesNotMatch(
      w.document.getElementById("messages")!.textContent!,
      /Hello from q1/,
    );
    assert.ok(calls.includes("/p/podfriends/quartets/q2/messages"));
  } finally {
    w.close();
  }
});
