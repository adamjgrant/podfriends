import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createPodcastPicker } from "../../frontend/podcast-picker.js";
const html = readFileSync("../frontend/index.html", "utf8");
const shows = [
  {
    id: "1",
    title: "First Show",
    author: "Host",
    feed_url: "https://example.com/1",
  },
  {
    id: "2",
    title: "Second Show",
    author: "Host",
    feed_url: "https://example.com/2",
  },
];
const tick = () => new Promise((r) => setTimeout(r, 10));
function setup(search: any = async () => ({ podcasts: shows })) {
  const dom = new JSDOM(html, { url: "https://example.com/" });
  let undo: any;
  const doc = dom.window.document;
  const picker = createPodcastPicker({
    document: doc,
    search,
    announce: (_message, fn) => {
      undo = fn;
    },
  });
  picker.initialize([], "user");
  const submit = (term: string) => {
    (doc.getElementById("search") as HTMLInputElement).value = term;
    doc
      .getElementById("search-form")!
      .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  };
  return { dom, doc, picker, submit, undo: () => undo?.() };
}
test("adding is visible in place; removal has undo; ranking and drafts persist", async () => {
  const s = setup();
  try {
    s.submit("show");
    await tick();
    let buttons = s.doc.querySelectorAll<HTMLButtonElement>(".add-show");
    buttons[0].click();
    assert.equal(
      s.doc.querySelector(".add-show")!.getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(s.doc.getElementById("selection-count")!.textContent, "1");
    assert.equal(s.doc.getElementById("status")!.hidden, true);
    s.doc.querySelectorAll<HTMLButtonElement>(".add-show")[1].click();
    s.doc.querySelectorAll<HTMLButtonElement>(".move-up")[1].click();
    assert.deepEqual(
      s.picker.getPodcasts().map((p) => p.id),
      ["2", "1"],
    );
    s.doc.querySelector<HTMLButtonElement>(".remove-show")!.click();
    s.undo();
    assert.deepEqual(
      s.picker.getPodcasts().map((p) => p.id),
      ["2", "1"],
    );
    assert.equal(s.picker.isDirty(), true);
    s.picker.initialize([], "user");
    assert.deepEqual(
      s.picker.getPodcasts().map((p) => p.id),
      ["2", "1"],
    );
    s.picker.markSaved();
    assert.equal(s.picker.isDirty(), false);
  } finally {
    s.dom.window.close();
  }
});
test("late search responses cannot overwrite a newer search", async () => {
  const resolves = new Map<string, any>();
  const s = setup((term) => new Promise((r) => resolves.set(term, r)));
  try {
    s.submit("first");
    s.submit("second");
    resolves.get("second")({ podcasts: [shows[1]] });
    await tick();
    resolves.get("first")({ podcasts: [shows[0]] });
    await tick();
    assert.match(s.doc.getElementById("results")!.textContent!, /Second Show/);
    assert.doesNotMatch(
      s.doc.getElementById("results")!.textContent!,
      /First Show/,
    );
    assert.equal(
      s.doc.getElementById("results")!.getAttribute("aria-busy"),
      "false",
    );
  } finally {
    s.dom.window.close();
  }
});
test("search failure is contextual and retryable; saving freezes edits", async () => {
  let fail = true;
  const s = setup(async () => {
    if (fail) throw new Error("Directory unavailable");
    return { podcasts: shows };
  });
  try {
    s.submit("show");
    await tick();
    assert.match(
      s.doc.getElementById("search-feedback")!.textContent!,
      /retry/,
    );
    fail = false;
    s.submit("show");
    await tick();
    s.doc.querySelector<HTMLButtonElement>(".add-show")!.click();
    s.picker.setBusy(true);
    assert.ok(
      [
        ...s.doc.querySelectorAll<HTMLButtonElement>(
          ".add-show,.rank-controls button",
        ),
      ].every((b) => b.disabled),
    );
  } finally {
    s.dom.window.close();
  }
});
