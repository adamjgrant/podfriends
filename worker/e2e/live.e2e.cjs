#!/usr/bin/env node
// Live end-to-end test in a real browser (Chromium) against the deployed site and API.
//
// Two temporary accounts sign in (via seeded sessions, not Google), pick the same shows,
// get matched, complete icebreakers, and message each other. Test accounts use the
// `pf-e2e-` prefix, which the matcher never pairs with real people. All test data is
// removed afterwards, even on failure.
//
// Usage:  npm run e2e            (requires Wrangler access to the D1 databases)
//         SITE=http://localhost:8080/ npm run e2e   (test a local frontend copy)
const { chromium } = require("playwright");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const SITE = process.env.SITE || "https://adamjgrant.github.io/podfriends/";
const RUN = crypto.randomBytes(4).toString("hex");
const USERS = ["a", "b"].map((k) => ({
  id: `pf-e2e-${RUN}-${k}`,
  name: `E2E ${k.toUpperCase()}`,
  email: `pf-e2e-${RUN}-${k}@example.invalid`,
  token: `pfe2e${crypto.randomBytes(16).toString("hex")}`,
}));

function d1(db, sql) {
  execFileSync("npx", ["wrangler", "d1", "execute", db, "--remote", "--command", sql], {
    stdio: "pipe",
    env: { ...process.env, WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || "/tmp/podfriends-e2e-wrangler.log" },
  });
}
function seed() {
  d1("bridge-auth", USERS.map((u) =>
    `INSERT INTO user(id,name,email,emailVerified) VALUES ('${u.id}','${u.name}','${u.email}',1);` +
    `INSERT INTO session(id,expiresAt,token,userId) VALUES ('${u.id}-s',datetime('now','+1 hour'),'${u.token}','${u.id}');`).join(""));
}
function cleanup() {
  const like = `'pf-e2e-${RUN}-%'`;
  try {
    d1("project-podfriends",
      `DELETE FROM messages WHERE quartet_id IN (SELECT quartet_id FROM quartet_members WHERE user_id LIKE ${like});` +
      `DELETE FROM quartets WHERE id IN (SELECT quartet_id FROM quartet_members WHERE user_id LIKE ${like});` +
      `DELETE FROM quartet_members WHERE user_id LIKE ${like};` +
      `DELETE FROM user_podcasts WHERE user_id LIKE ${like};` +
      `DELETE FROM email_log WHERE user_id LIKE ${like};` +
      `DELETE FROM client_events WHERE user_id LIKE ${like};` +
      `DELETE FROM profiles WHERE user_id LIKE ${like};`);
    d1("bridge-auth",
      `DELETE FROM project_members WHERE user_id LIKE ${like};` +
      `DELETE FROM session WHERE userId LIKE ${like};` +
      `DELETE FROM user WHERE id LIKE ${like};`);
  } catch (e) {
    console.error(`Cleanup failed. Remove rows matching pf-e2e-${RUN}-% manually.`, e.message);
  }
}

async function openAs(user, viewport) {
  // One browser per user: single-process Chromium cannot host multiple contexts.
  const browser = await launch();
  browsers.push(browser);
  const context = await browser.newContext({ viewport });
  await context.addInitScript((t) => { try { localStorage.setItem("podfriends_token", t); } catch {} }, user.token);
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("dialog", (d) => page.errors.push(`Unexpected dialog: ${d.message()}`));
  await page.goto(`${SITE}?e2e=${RUN}`, { waitUntil: "networkidle", timeout: 45000 });
  return page;
}
async function addShow(page, query) {
  await page.fill("#search", query);
  await page.waitForFunction((q) => document.querySelector("#search-feedback").textContent.includes(q) &&
    document.querySelector("#results").getAttribute("aria-busy") === "false", query, { timeout: 25000 });
  const add = page.locator(".add-show[aria-pressed=false]").first();
  await add.click();
  await page.waitForFunction(() => document.querySelector(".add-show[aria-pressed=true]"));
}
async function pickShowsAndSave(page) {
  assert.ok(await page.isVisible("#podcasts"), "new users start on podcast selection");
  assert.ok(await page.isChecked("#match-emails"), "match emails are on by default");
  assert.ok(await page.isVisible("#match-emails + .switch"), "email switch is visible without expanding anything");
  await addShow(page, "conan o'brien needs a friend");
  await addShow(page, "mrballen");
  assert.equal(await page.textContent("#selection-count"), "2");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    "no horizontal overflow with long show titles selected");
  // Wait for the actual save request, not just a screen change.
  const saved = page.waitForResponse((r) => r.url().includes("/podcasts/rankings") && r.request().method() === "PUT", { timeout: 15000 })
    .catch(() => null);
  await page.click("#save-rankings");
  const response = await saved;
  assert.ok(response, "clicking Find my people sends the save request");
  assert.equal(response.status(), 200, "save request succeeds");
  await page.waitForFunction(() => !document.querySelector("#home").hidden ||
    !document.querySelector("#profile").hidden, null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    "no horizontal overflow after choosing shows");
}
async function waitForIcebreakers(page) {
  for (let i = 0; i < 10; i++) {
    await page.reload({ waitUntil: "networkidle" });
    if (await page.isVisible("#profile")) return;
    await page.waitForTimeout(2000);
  }
  const me = await page.evaluate(async () => (await fetch("https://side-project-bridge.smosa.workers.dev/p/podfriends/me",
    { headers: { Authorization: "Bearer " + localStorage.getItem("podfriends_token") } })).json());
  throw new Error(`Match did not unlock the icebreaker step. /me: match_found=${me.match_found} needs_icebreakers=${me.needs_icebreakers} chats=${me.chats?.length}; visible: ${JSON.stringify(await page.evaluate(() => ["podcasts","home","profile","waiting"].filter(id => !document.getElementById(id).hidden)))}`);
}
async function introduce(page) {
  assert.match(await page.textContent("#profile-heading"), /Good news/);
  await page.fill("#day_off", "A long walk and a good episode");
  await page.fill("#talk_for_hours", "Old movies");
  await page.fill("#small_joy", "Fresh coffee");
  await page.click("#save-profile");
  await page.waitForSelector(".conversation-card", { timeout: 20000 });
}

const browsers = [];
function launch() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  // --single-process works around sandboxed environments that block Chromium's helpers.
  return chromium.launch({ headless: true, proxy: proxy ? { server: proxy } : undefined,
    args: process.env.E2E_SANDBOXED === "0" ? [] : ["--no-sandbox", "--single-process", "--no-zygote"] });
}
(async () => {
  seed();
  let failed = false;
  try {
    const a = await openAs(USERS[0], { width: 1280, height: 900 });
    await pickShowsAndSave(a);
    console.log("✓ A: picked shows and saved (desktop)");

    const b = await openAs(USERS[1], { width: 390, height: 844 });
    const overflow = await b.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, "no horizontal overflow on mobile");
    await pickShowsAndSave(b);
    console.log("✓ B: picked shows and saved (mobile, no overflow)");

    await waitForIcebreakers(b);
    await introduce(b);
    await b.fill("#message", "Hello from B");
    await b.click("#message-form button");
    await b.waitForFunction(() => document.querySelector("#messages").textContent.includes("Hello from B"));
    console.log("✓ B: matched, introduced, sent a message");

    await waitForIcebreakers(a);
    await introduce(a);
    await a.waitForFunction(() => document.querySelector("#messages").textContent.includes("Hello from B"), null, { timeout: 15000 });
    console.log("✓ A: matched, introduced, received B's message");

    for (const [name, page] of [["A", a], ["B", b]]) assert.deepEqual(page.errors, [], `${name} had page errors`);
    console.log("✓ No uncaught page errors");
  } catch (e) {
    failed = true;
    console.error("✗ E2E failed:", e.message);
    // Save a screenshot of every open page for diagnosis.
    for (const [i, b] of browsers.entries()) for (const ctx of b.contexts()) for (const pg of ctx.pages())
      await pg.screenshot({ path: `/tmp/podfriends-e2e-failure-${i}.png`, fullPage: true }).catch(() => {});
    console.error("  Screenshots: /tmp/podfriends-e2e-failure-*.png");
  } finally {
    await Promise.all(browsers.map((b) => b.close().catch(() => {})));
    if (process.env.KEEP) console.log(`KEEP set: test data pf-e2e-${RUN}-% left in place`); else cleanup();
  }
  process.exit(failed ? 1 : 0);
})();
