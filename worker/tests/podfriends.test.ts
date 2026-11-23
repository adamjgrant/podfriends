import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import podfriends, { match, safeUrl } from "../src/projects/podfriends";
import { parseFeed, pollFeeds } from "../src/projects/feeds";

// Execute actual route and matching SQL against SQLite, including the production triggers.
function database(schema: string) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(schema);
  const db: any = {
    prepare(query: string) {
      let args: any[] = [];
      const stmt: any = {
        bind(...v: any[]) {
          args = v;
          return stmt;
        },
        async first() {
          return sql.prepare(query).get(...args) || null;
        },
        async all() {
          return { results: sql.prepare(query).all(...args) };
        },
        async run() {
          return {
            meta: { changes: Number(sql.prepare(query).run(...args).changes) },
          };
        },
      };
      return stmt;
    },
    async batch(statements: any[]) {
      sql.exec("BEGIN");
      try {
        const result = [];
        for (const s of statements) result.push(await s.run());
        sql.exec("COMMIT");
        return result;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, sql };
}
test("full MVP: profile, rankings, matching, membership, chat, leave, RSS deduplication", async () => {
  const { db, sql } = database(
    readFileSync("migrations/project-podfriends/0001_init.sql", "utf8") +
      readFileSync(
        "migrations/project-podfriends/0002_deferred_icebreakers.sql",
        "utf8",
      ),
  );
  const auth = database("CREATE TABLE user(id TEXT,email TEXT)");
  const env: any = { PROJECT_PODFRIENDS_DB: db, AUTH_DB: auth.db };
  const tasks: Promise<unknown>[] = [];
  const app = new Hono<any>();
  app.use("*", async (c, next) => {
    c.set("projectDb", db);
    c.set("user", {
      id: c.req.header("x-test-user") || "a",
      name: "Tester",
      email: "test@example.com",
    });
    await next();
  });
  app.route("/", podfriends);
  const call = async (path: string, method = "GET", body?: any, user = "a") =>
    app.request(
      path,
      {
        method,
        headers: { "x-test-user": user, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      env,
      {
        waitUntil(p: Promise<unknown>) {
          tasks.push(p);
        },
        passThroughOnException() {},
      } as any,
    );
  for (const id of ["a", "b", "c", "d", "e", "f"]) {
    let r = await call(
      "/profile",
      "PUT",
      {
        display_name: id,
        icebreakers: {
          day_off: "A hike with friends",
          talk_for_hours: "Cooking",
          small_joy: "A dog saying hello",
        },
        email_notifications_enabled: false,
      },
      id,
    );
    assert.equal(r.status, 200);
    await Promise.all(tasks.splice(0));
    r = await call(
      "/podcasts/rankings",
      "PUT",
      {
        podcasts: [
          {
            id: "123",
            title: "Test Show",
            author: "Host",
            feed_url: "https://example.com/feed",
          },
        ],
      },
      id,
    );
    assert.equal(r.status, 200);
    await Promise.all(tasks.splice(0));
  }
  const counts = sql
    .prepare("SELECT count(*) AS n FROM quartet_members GROUP BY quartet_id")
    .all();
  assert.deepEqual(counts.map((x) => x.n).sort(), [2, 4]);
  await match(env);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM messages").get()!.n, 6);
  const me = (await (await call("/me")).json()) as any;
  assert.deepEqual(JSON.parse(me.profile.icebreakers_json), {
    day_off: "A hike with friends",
    talk_for_hours: "Cooking",
    small_joy: "A dog saying hello",
  });
  const intro = sql
    .prepare(
      "SELECT body FROM messages WHERE user_id='a' AND type='system_intro'",
    )
    .get()!;
  assert.match(String(intro.body), /What's your idea of a great day off\?/);
  assert.match(String(intro.body), /Cooking/);
  assert.equal(
    (
      await call("/profile", "PUT", {
        display_name: "a",
        icebreakers: { day_off: "Just one answer" },
      })
    ).status,
    400,
  );
  // A cached frontend can still save its old answers without changing their meaning.
  assert.equal(
    (
      await call(
        "/profile",
        "PUT",
        {
          display_name: "Legacy",
          icebreakers: {
            favorite_episode: "Pilot",
            listening_habit: "Walking",
            bio: "Hello",
          },
        },
        "legacy",
      )
    ).status,
    200,
  );
  await Promise.all(tasks.splice(0));
  const legacy = (await (
    await call("/me", "GET", undefined, "legacy")
  ).json()) as any;
  assert.deepEqual(JSON.parse(legacy.profile.icebreakers_json), {
    favorite_episode: "Pilot",
    listening_habit: "Walking",
    bio: "Hello",
  });
  const originalSearchFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("Forbidden", { status: 403 });
    assert.equal((await call("/podcasts/search?q=mr%20ballen")).status, 502);
    globalThis.fetch = async () => {
      throw new Error("Timed out");
    };
    assert.equal((await call("/podcasts/search?q=mr%20ballen")).status, 502);
  } finally {
    globalThis.fetch = originalSearchFetch;
  }
  const id = me.quartet.id;
  assert.ok(id);
  assert.equal(me.podcasts.length, 1);
  assert.equal(
    (await call(`/quartets/${id}`, "GET", null, "outsider")).status,
    404,
  );
  assert.equal(
    (
      await call(
        `/quartets/${id}/messages`,
        "POST",
        { body: "intruder" },
        "outsider",
      )
    ).status,
    404,
  );
  assert.equal(
    (await call(`/quartets/${id}/messages`, "POST", { body: "Hello friends" }))
      .status,
    201,
  );
  assert.equal(
    (await call(`/quartets/${id}/messages`, "POST", { body: " " })).status,
    400,
  );
  const msgs = (await (await call(`/quartets/${id}/messages`)).json()) as any;
  assert.ok(msgs.messages.some((m: any) => m.body === "Hello friends"));
  const last = msgs.messages.at(-1).id;
  assert.deepEqual(
    (
      (await (
        await call(`/quartets/${id}/messages?after=${last}`)
      ).json()) as any
    ).messages,
    [],
  );
  // Capacity remains safe even when the caller bypasses matching logic.
  sql
    .prepare(
      "INSERT INTO quartet_members(quartet_id,user_id,joined_at) VALUES (?,?,?)",
    )
    .run(id, "outsider", "now");
  assert.equal(
    sql
      .prepare("SELECT count(*) AS n FROM quartet_members WHERE quartet_id=?")
      .get(id)!.n,
    4,
  );
  const other = sql.prepare("SELECT id FROM quartets WHERE id!=?").get(id)!.id;
  sql
    .prepare(
      "INSERT INTO quartet_members(quartet_id,user_id,joined_at) VALUES (?,?,?)",
    )
    .run(other, "a", "now");
  assert.equal(
    sql
      .prepare("SELECT count(*) AS n FROM quartet_members WHERE user_id=?")
      .get("a")!.n,
    1,
  );
  assert.equal(
    (
      await call("/podcasts/rankings", "PUT", {
        podcasts: [{ id: "123", title: "Bad", feed_url: "http://localhost/" }],
      })
    ).status,
    400,
  );
  const original = globalThis.fetch;
  let second = false;
  globalThis.fetch = async () =>
    new Response(
      `<rss><channel><item><guid>${second ? "new" : "old"}</guid><title>Episode</title><pubDate>${second ? "Tue, 02 Jun 2026" : "Mon, 01 Jun 2026"} 12:00:00 GMT</pubDate><link>https://example.com/episode</link></item></channel></rss>`,
    );
  try {
    await pollFeeds(env);
    assert.equal(
      sql
        .prepare(
          "SELECT count(*) AS n FROM messages WHERE type='system_episode'",
        )
        .get()!.n,
      0,
    );
    second = true;
    sql.exec("UPDATE podcasts SET last_checked_at=NULL");
    await pollFeeds(env);
    assert.equal(
      sql
        .prepare(
          "SELECT count(*) AS n FROM messages WHERE type='system_episode'",
        )
        .get()!.n,
      2,
    );
    sql.exec("UPDATE podcasts SET last_checked_at=NULL");
    await pollFeeds(env);
    assert.equal(
      sql
        .prepare(
          "SELECT count(*) AS n FROM messages WHERE type='system_episode'",
        )
        .get()!.n,
      2,
    );
  } finally {
    globalThis.fetch = original;
  }
  assert.equal((await call(`/quartets/${id}/leave`, "POST", {})).status, 200);
  assert.equal((await call(`/quartets/${id}/messages`)).status, 404);

  // New signup: no profile form, only favorite shows. Both draft profiles must match.
  for (const uid of ["new-a", "new-b"]) {
    assert.equal(
      (
        await call(
          "/podcasts/rankings",
          "PUT",
          {
            podcasts: [
              {
                id: "999",
                title: "New Show",
                feed_url: "https://example.com/new",
              },
            ],
            email_notifications_enabled: true,
          },
          uid,
        )
      ).status,
      200,
    );
    await Promise.all(tasks.splice(0));
  }
  const locked = (await (
    await call("/me", "GET", undefined, "new-a")
  ).json()) as any;
  assert.equal(locked.profile.onboarding_completed, 0);
  assert.equal(locked.match_found, true);
  assert.equal(locked.needs_icebreakers, true);
  assert.equal(locked.quartet, null);
  const newId = sql
    .prepare("SELECT quartet_id FROM quartet_members WHERE user_id=?")
    .get("new-a")!.quartet_id;
  for (const path of [`/quartets/${newId}`, `/quartets/${newId}/messages`]) {
    assert.equal((await call(path, "GET", undefined, "new-a")).status, 403);
  }
  assert.equal(
    (
      await call(
        `/quartets/${newId}/messages`,
        "POST",
        { body: "Not yet" },
        "new-a",
      )
    ).status,
    403,
  );
  assert.equal(
    sql
      .prepare("SELECT count(*) AS n FROM messages WHERE quartet_id=?")
      .get(newId)!.n,
    0,
  );
  assert.equal(
    sql
      .prepare(
        "SELECT count(*) AS n FROM email_log WHERE event_type='match_found' AND user_id LIKE 'new-%'",
      )
      .get()!.n,
    2,
  );
  await match(env);
  assert.equal(
    sql
      .prepare(
        "SELECT count(*) AS n FROM email_log WHERE event_type='match_found' AND user_id LIKE 'new-%'",
      )
      .get()!.n,
    2,
  );
  for (const uid of ["new-a", "new-b"]) {
    assert.equal(
      (
        await call(
          "/profile",
          "PUT",
          {
            display_name: uid,
            icebreakers: {
              day_off: "Hiking",
              talk_for_hours: "Cooking",
              small_joy: "Coffee",
            },
            email_notifications_enabled: true,
          },
          uid,
        )
      ).status,
      200,
    );
    await Promise.all(tasks.splice(0));
    const unlocked = (await (
      await call("/me", "GET", undefined, uid)
    ).json()) as any;
    assert.equal(unlocked.needs_icebreakers, false);
    assert.equal(unlocked.quartet.id, newId);
    assert.equal(
      (await call(`/quartets/${newId}`, "GET", undefined, uid)).status,
      200,
    );
    if (uid === "new-a") {
      const details = (await (
        await call(`/quartets/${newId}`, "GET", undefined, uid)
      ).json()) as any;
      assert.equal(details.members.length, 1);
      assert.equal(
        sql
          .prepare(
            "SELECT count(*) AS n FROM email_log WHERE user_id='new-b' AND event_type='member_joined'",
          )
          .get()!.n,
        0,
      );
    }
  }
  assert.equal(
    sql
      .prepare("SELECT count(*) AS n FROM messages WHERE quartet_id=?")
      .get(newId)!.n,
    2,
  );
  assert.equal(
    (
      await call(
        `/quartets/${newId}/messages`,
        "POST",
        { body: "Hello!" },
        "new-a",
      )
    ).status,
    201,
  );
});
test("URL and XML safety", () => {
  for (const u of [
    "http://example.com",
    "https://127.0.0.1",
    "https://[::1]/",
    "https://localhost/",
    "https://user:pass@example.com/",
  ])
    assert.equal(safeUrl(u), false);
  assert.equal(safeUrl("https://feeds.simplecast.com/abc"), true);
  assert.throws(() => parseFeed("<!DOCTYPE x><rss/>"));
});
