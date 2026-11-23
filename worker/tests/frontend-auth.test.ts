import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { ensureCurrentPage, PAGE_VERSION } from "../../frontend/bootstrap.js";

const html = readFileSync("../frontend/index.html", "utf8");
const bundle = build({
  entryPoints: ["../frontend/app.js"],
  bundle: true,
  write: false,
  format: "iife",
}).then((r) => r.outputFiles[0].text);
const me = {
  user: { id: "test", name: "Test" },
  profile: {
    display_name: "Test",
    onboarding_completed: 1,
    icebreakers_json: "{}",
  },
  podcasts: [],
  quartet: null,
};
const delay = () => new Promise((resolve) => setTimeout(resolve, 20));
function page(hash = "") {
  const dom = new JSDOM(html, {
    url: "https://adamjgrant.github.io/podfriends/" + hash,
    runScripts: "outside-only",
  });
  dom.window.AbortSignal = AbortSignal as any;
  dom.window.setInterval = (() => 0) as any;
  return dom;
}
test("a returning user goes straight to setup, without showing the sign-in button", async () => {
  const dom = page();
  const w = dom.window;
  try {
    w.localStorage.setItem("podfriends_token", "stored-session");
    let finish: any;
    w.fetch = async (url, options) => {
      assert.ok(String(url).endsWith("/me"));
      assert.equal(options!.headers.Authorization, "Bearer stored-session");
      await new Promise((resolve) => {
        finish = resolve;
      });
      return new Response(JSON.stringify(me));
    };
    w.eval(await bundle);
    assert.equal(w.document.getElementById("signin")!.disabled, true);
    assert.equal(w.document.getElementById("welcome")!.hidden, true);
    finish();
    await delay();
    assert.equal(w.document.getElementById("workspace")!.hidden, false);
    assert.equal(w.document.getElementById("podcasts")!.hidden, false);
    assert.equal(w.document.getElementById("welcome")!.hidden, true);
  } finally {
    dom.window.close();
  }
});
test("Google callback exchanges its code exactly once and loads the account", async () => {
  const dom = page("?ui=" + PAGE_VERSION + "#auth_code=single-use-code");
  const w = dom.window;
  const calls: string[] = [];
  try {
    w.fetch = async (url, options) => {
      calls.push(String(url));
      if (String(url).endsWith("/api/exchange")) {
        assert.deepEqual(JSON.parse(options!.body as string), {
          code: "single-use-code",
        });
        return new Response(JSON.stringify({ token: "new-session" }));
      }
      return new Response(JSON.stringify(me));
    };
    w.eval(await bundle);
    await delay();
    assert.equal(calls.filter((u) => u.endsWith("/api/exchange")).length, 1);
    assert.equal(w.localStorage.getItem("podfriends_token"), "new-session");
    assert.equal(w.location.hash, "");
    assert.equal(w.location.search, "?ui=" + PAGE_VERSION);
    assert.equal(w.document.getElementById("welcome")!.hidden, true);
    assert.equal(w.document.getElementById("podcasts")!.hidden, false);
  } finally {
    dom.window.close();
  }
});
test("old markup reloads once, preserving the OAuth code, rather than crashing or looping", () => {
  const dom = page("#auth_code=keep-me");
  const doc = dom.window.document;
  const redirects: string[] = [];
  try {
    delete doc.documentElement.dataset.appVersion;
    doc.getElementById("edit-profile")!.remove();
    assert.equal(
      ensureCurrentPage(doc, {
        href: dom.window.location.href,
        replace: (url) => redirects.push(url),
      }),
      false,
    );
    assert.equal(new URL(redirects[0]).hash, "#auth_code=keep-me");
    assert.equal(new URL(redirects[0]).searchParams.get("ui"), PAGE_VERSION);
    assert.equal(
      ensureCurrentPage(doc, {
        href: redirects[0],
        replace: (url) => redirects.push(url),
      }),
      false,
    );
    assert.equal(redirects.length, 1);
    assert.match(doc.body.textContent!, /site is still updating/);
  } finally {
    dom.window.close();
  }
});
test("a new user chooses shows immediately, without icebreakers", async () => {
  const dom = page();
  const w = dom.window;
  try {
    w.localStorage.setItem("podfriends_token", "session");
    w.fetch = async () =>
      new Response(JSON.stringify({ ...me, profile: null }));
    w.eval(await bundle);
    await delay();
    assert.equal(w.document.getElementById("podcasts")!.hidden, false);
    assert.equal(w.document.getElementById("profile")!.hidden, true);
    assert.equal(w.document.getElementById("main-nav")!.hidden, true);
  } finally {
    dom.window.close();
  }
});
test("a matched user completes icebreakers before any group details are fetched", async () => {
  const dom = page();
  const w = dom.window;
  let completed = false;
  const calls: string[] = [];
  try {
    w.localStorage.setItem("podfriends_token", "session");
    w.fetch = async (url, options) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path.endsWith("/profile")) {
        completed = true;
        return new Response("{}");
      }
      if (path.endsWith("/me"))
        return new Response(
          JSON.stringify({
            ...me,
            podcasts: [{ id: "123", title: "Show" }],
            profile: { ...me.profile, onboarding_completed: completed ? 1 : 0 },
            match_found: true,
            needs_icebreakers: !completed,
            quartet: completed ? { id: "q" } : null,
          }),
        );
      if (path.endsWith("/messages"))
        return new Response(JSON.stringify({ messages: [] }));
      return new Response(
        JSON.stringify({ quartet: { name: "Test quartet" }, members: [] }),
      );
    };
    w.eval(await bundle);
    await delay();
    assert.equal(w.document.getElementById("profile")!.hidden, false);
    assert.match(
      w.document.getElementById("profile-heading")!.textContent!,
      /Good news/,
    );
    assert.equal(w.document.getElementById("main-nav")!.hidden, true);
    assert.equal(
      calls.some((p) => p.includes("/quartets/")),
      false,
    );
    for (const id of ["day_off", "talk_for_hours", "small_joy"])
      w.document.getElementById(id)!.value = "Hello";
    w.document
      .getElementById("profile-form")!
      .dispatchEvent(
        new w.Event("submit", { bubbles: true, cancelable: true }),
      );
    await delay();
    assert.equal(completed, true);
    assert.equal(w.document.getElementById("home")!.hidden, false);
    assert.equal(w.document.getElementById("quartet")!.hidden, false);
    assert.equal(w.document.getElementById("main-nav")!.hidden, false);
    assert.ok(calls.includes("/p/podfriends/quartets/q"));
  } finally {
    dom.window.close();
  }
});

test("expired sessions return an actionable error and allow sign-in again", async () => {
  const dom = page();
  const w = dom.window;
  try {
    w.localStorage.setItem("podfriends_token", "expired");
    w.fetch = async () =>
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    w.eval(await bundle);
    await delay();
    assert.equal(w.localStorage.getItem("podfriends_token"), null);
    assert.equal(w.document.getElementById("welcome")!.hidden, false);
    assert.equal(w.document.getElementById("signin")!.disabled, false);
    assert.equal(w.document.getElementById("status")!.hidden, false);
  } finally {
    dom.window.close();
  }
});
