import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "../auth";
import type { AppVariables } from "../index";
import { findPairs } from "./matching";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const now = () => new Date().toISOString();
const ICEBREAKERS = {
  day_off: "What's your idea of a great day off?",
  talk_for_hours: "What's something you could happily talk about for hours?",
  small_joy: "What's a small thing that always makes your day?",
};
const LEGACY_ICEBREAKERS = {
  favorite_episode: "Favorite episode",
  listening_habit: "Listening habit",
  bio: "About me",
};
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
app.use("*", bodyLimit({ maxSize: 50000 }));
app.onError((e, c) => {
  if (e instanceof HTTPException) return c.json({ error: e.message }, e.status);
  console.error(e);
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});
const active = (db: D1Database, user: string) =>
  db
    .prepare(
      "SELECT q.* FROM quartets q JOIN quartet_members m ON m.quartet_id=q.id WHERE m.user_id=? AND q.status='active' ORDER BY q.match_score DESC,q.created_at DESC",
    )
    .bind(user)
    .all();
app.get("/me", async (c) => {
  const db = c.get("projectDb"),
    user = c.get("user");
  const profile = await db
    .prepare("SELECT * FROM profiles WHERE user_id=?")
    .bind(user.id)
    .first();
  const chats = (await active(db, user.id)).results;
  const needsIcebreakers = !!chats.length && !profile?.onboarding_completed;
  const visibleChats = needsIcebreakers
    ? []
    : await Promise.all(
        chats.map(async (chat) => ({
          ...chat,
          partner: await db
            .prepare(
              "SELECT p.user_id,p.display_name,p.onboarding_completed FROM quartet_members m JOIN profiles p ON p.user_id=m.user_id WHERE m.quartet_id=? AND m.user_id!=? LIMIT 1",
            )
            .bind(chat.id, user.id)
            .first(),
          shared_podcasts: JSON.parse(
            String(chat.shared_podcasts_json || "[]"),
          ),
        })),
      );
  return c.json({
    user,
    profile,
    match_found: chats.length > 0,
    needs_icebreakers: needsIcebreakers,
    podcasts: (
      await db
        .prepare(
          "SELECT p.*,u.rank FROM user_podcasts u JOIN podcasts p ON p.id=u.podcast_id WHERE u.user_id=? ORDER BY u.rank",
        )
        .bind(user.id)
        .all()
    ).results,
    chats: visibleChats,
    quartet: visibleChats[0] || null,
  });
});
app.put("/profile", async (c) => {
  const b = await c.req.json(),
    name = text(b.display_name, 80),
    answers: Record<string, string> = {};
  // Accept old clients during the Pages rollout without relabeling existing answers.
  const keys = Object.keys(ICEBREAKERS).some(
    (key) => b.icebreakers?.[key] !== undefined,
  )
    ? Object.keys(ICEBREAKERS)
    : Object.keys(LEGACY_ICEBREAKERS);
  for (const key of keys) answers[key] = text(b.icebreakers?.[key], 1000);
  if (!name || Object.values(answers).some((v) => !v))
    return c.json(
      { error: "Please fill in your name and all three icebreakers." },
      400,
    );
  await c
    .get("projectDb")
    .prepare(
      "INSERT INTO profiles (user_id,display_name,icebreakers_json,onboarding_completed,email_notifications_enabled,created_at,updated_at) VALUES (?,?,?,1,?,?,?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,icebreakers_json=excluded.icebreakers_json,onboarding_completed=1,email_notifications_enabled=excluded.email_notifications_enabled,updated_at=excluded.updated_at",
    )
    .bind(
      c.get("user").id,
      name,
      JSON.stringify(answers),
      b.email_notifications_enabled ? 1 : 0,
      now(),
      now(),
    )
    .run();
  c.executionCtx.waitUntil(match(c.env));
  return c.json({ saved: true });
});
// Browser diagnostics so real-user failures (e.g. Safari-only) are visible without a console.
app.post("/client-log", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const kind = text(b.kind, 40) || "error";
  if (!/^[a-z_]+$/.test(kind)) return c.json({ error: "Invalid kind" }, 400);
  const db = c.get("projectDb");
  const uid = c.get("user").id;
  // Cap per-user volume so a crash loop cannot flood the database.
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM client_events WHERE user_id=? AND created_at > ?")
    .bind(uid, new Date(Date.now() - 3600000).toISOString())
    .first<{ n: number }>();
  if ((recent?.n || 0) >= 50) return c.json({ logged: false }, 429);
  await db
    .prepare(
      "INSERT INTO client_events (id,user_id,kind,message,detail,user_agent,app_version,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), uid, kind, text(b.message, 500), text(b.detail, 2000),
      text(c.req.header("User-Agent"), 300), text(b.app_version, 40), now())
    .run();
  return c.json({ logged: true });
});
app.get("/podcasts/search", async (c) => {
  const q = text(c.req.query("q"), 120);
  if (q.length < 2) return c.json({ podcasts: [] });
  let data: { results: any[] };
  try {
    const r = await fetch(
      `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=20&term=${encodeURIComponent(q)}`,
      {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/json", "User-Agent": "Podfriends/1.0" },
        cf: { cacheTtl: 3600, cacheEverything: true },
      },
    );
    if (!r.ok) throw new Error(`Directory HTTP ${r.status}`);
    data = (await r.json()) as { results: any[] };
    if (!Array.isArray(data.results))
      throw new Error("Invalid directory response");
  } catch (error) {
    console.warn("Podcast directory proxy failed:", String(error));
    return c.json({ error: "Podcast search is temporarily unavailable." }, 502);
  }
  return c.json({
    podcasts: data.results
      .filter((p) => p.feedUrl?.startsWith("https://"))
      .map((p) => ({
        id: String(p.collectionId),
        title: p.collectionName,
        author: p.artistName || "",
        artwork_url: p.artworkUrl600 || "",
        feed_url: p.feedUrl,
      })),
  });
});
app.put("/podcasts/rankings", async (c) => {
  const { podcasts, email_notifications_enabled } = await c.req.json();
  if (
    !Array.isArray(podcasts) ||
    podcasts.length > 20 ||
    new Set(podcasts.map((p) => p?.id)).size !== podcasts.length ||
    podcasts.some(
      (p) =>
        !p ||
        !/^\d{1,20}$/.test(p.id) ||
        !text(p.title, 200) ||
        !safeUrl(p.feed_url),
    )
  )
    return c.json(
      { error: "Choose up to 20 unique podcasts with valid HTTPS feeds." },
      400,
    );
  const db = c.get("projectDb"),
    uid = c.get("user").id;
  await db.batch([
    db
      .prepare(
        "INSERT INTO profiles (user_id,display_name,created_at,updated_at,email_notifications_enabled) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email_notifications_enabled=COALESCE(?,profiles.email_notifications_enabled)",
      )
      .bind(
        uid,
        text(c.get("user").name, 80) || "Podfriend",
        now(),
        now(),
        // Match emails default to on unless the user explicitly opts out.
        email_notifications_enabled === false ? 0 : 1,
        typeof email_notifications_enabled === "boolean"
          ? Number(email_notifications_enabled)
          : null,
      ),
    db.prepare("DELETE FROM user_podcasts WHERE user_id=?").bind(uid),
    ...podcasts.flatMap((p, i) => [
      db
        .prepare(
          "INSERT OR IGNORE INTO podcasts (id,title,author,feed_url,artwork_url) VALUES (?,?,?,?,?)",
        )
        .bind(
          p.id,
          text(p.title, 200),
          text(p.author, 200),
          p.feed_url,
          safeUrl(p.artwork_url) ? p.artwork_url : "",
        ),
      db
        .prepare(
          "INSERT INTO user_podcasts (user_id,podcast_id,rank,created_at) VALUES (?,?,?,?)",
        )
        .bind(uid, p.id, i + 1, now()),
    ]),
  ]);
  c.executionCtx.waitUntil(match(c.env));
  return c.json({ saved: true });
});
export function safeUrl(value: unknown): boolean {
  try {
    const u = new URL(String(value));
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !/^(localhost|.*\.local|.*\.internal|[\d.]+|\[.*\])$/.test(u.hostname)
    );
  } catch {
    return false;
  }
}
app.use("/quartets/:id/*", async (c, next) => {
  const member = await c
    .get("projectDb")
    .prepare(
      "SELECT 1 FROM quartet_members m JOIN quartets q ON q.id=m.quartet_id WHERE m.quartet_id=? AND m.user_id=? AND q.status='active'",
    )
    .bind(c.req.param("id"), c.get("user").id)
    .first();
  if (!member) return c.json({ error: "Conversation not found" }, 404);
  // Leaving is always allowed, but matches and messages stay private until icebreakers are complete.
  if (!(c.req.method === "POST" && c.req.path.endsWith("/leave"))) {
    const profile = await c
      .get("projectDb")
      .prepare("SELECT onboarding_completed FROM profiles WHERE user_id=?")
      .bind(c.get("user").id)
      .first();
    if (!profile?.onboarding_completed)
      return c.json(
        {
          error: "Complete your icebreakers to meet your matches.",
          code: "ICEBREAKERS_REQUIRED",
        },
        403,
      );
  }
  await next();
});
app.get("/quartets/:id", async (c) => {
  const db = c.get("projectDb"),
    id = c.req.param("id");
  return c.json({
    quartet: await db
      .prepare(
        "SELECT q.*,p.title,p.artwork_url FROM quartets q JOIN podcasts p ON p.id=q.podcast_id WHERE q.id=?",
      )
      .bind(id)
      .first(),
    members: (
      await db
        .prepare(
          "SELECT p.* FROM profiles p JOIN quartet_members m ON m.user_id=p.user_id WHERE m.quartet_id=? AND p.onboarding_completed=1 ORDER BY m.joined_at",
        )
        .bind(id)
        .all()
    ).results,
  });
});
app.get("/quartets/:id/messages", async (c) => {
  const db = c.get("projectDb"),
    id = c.req.param("id"),
    after = c.req.query("after");
  // IDs are stable cursors; pair timestamp with ID to avoid skipping same-time messages.
  const cursor = after
    ? await db
        .prepare(
          "SELECT created_at,id FROM messages WHERE id=? AND quartet_id=?",
        )
        .bind(after, id)
        .first<{ created_at: string; id: string }>()
    : null;
  const result = cursor
    ? await db
        .prepare(
          "SELECT m.*,p.display_name FROM messages m LEFT JOIN profiles p ON p.user_id=m.user_id WHERE m.quartet_id=? AND (m.created_at>? OR (m.created_at=? AND m.id>?)) ORDER BY m.created_at,m.id LIMIT 100",
        )
        .bind(id, cursor.created_at, cursor.created_at, cursor.id)
        .all()
    : await db
        .prepare(
          "SELECT * FROM (SELECT m.*,p.display_name FROM messages m LEFT JOIN profiles p ON p.user_id=m.user_id WHERE m.quartet_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 100) ORDER BY created_at,id",
        )
        .bind(id)
        .all();
  return c.json({ messages: result.results });
});
app.post("/quartets/:id/messages", async (c) => {
  const db = c.get("projectDb"),
    uid = c.get("user").id;
  const profile = await db
    .prepare("SELECT onboarding_completed FROM profiles WHERE user_id=?")
    .bind(uid)
    .first();
  if (!profile?.onboarding_completed)
    return c.json({ error: "Complete your profile first." }, 403);
  const b = await c.req.json();
  if (typeof b.body !== "string" || !b.body.trim() || b.body.length > 4000)
    return c.json(
      { error: "Messages must contain 1 to 4000 characters." },
      400,
    );
  await db
    .prepare(
      "INSERT INTO messages (id,quartet_id,user_id,type,body,created_at) VALUES (?,?,?,'chat',?,?)",
    )
    .bind(crypto.randomUUID(), c.req.param("id"), uid, b.body.trim(), now())
    .run();
  return c.json({ sent: true }, 201);
});
app.post("/quartets/:id/leave", async (c) => {
  const db = c.get("projectDb"),
    id = c.req.param("id");
  await db.batch([
    db
      .prepare("DELETE FROM quartet_members WHERE quartet_id=? AND user_id=?")
      .bind(id, c.get("user").id),
    db
      .prepare(
        "UPDATE quartets SET status='archived' WHERE id=? AND (kind='pair' OR NOT EXISTS (SELECT 1 FROM quartet_members WHERE quartet_id=?))",
      )
      .bind(id, id),
  ]);
  return c.json({ left: true });
});

export async function notify(
  env: Env,
  uid: string,
  event: string,
  subject: string,
  body: string,
) {
  const db = env.PROJECT_PODFRIENDS_DB;
  const p = await db
    .prepare("SELECT email_notifications_enabled FROM profiles WHERE user_id=?")
    .bind(uid)
    .first();
  if (!p?.email_notifications_enabled) return;
  let status = "logged";
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    const user = await env.AUTH_DB.prepare("SELECT email FROM user WHERE id=?")
      .bind(uid)
      .first<{ email: string }>();
    try {
      const r =
        user &&
        (await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: [user.email],
            subject,
            text: body + "\n\nhttps://adamjgrant.github.io/podfriends/",
          }),
          signal: AbortSignal.timeout(10000),
        }));
      status = r?.ok ? "sent" : "failed";
    } catch {
      status = "failed";
    }
  } else console.log("Email delivery not configured:", event);
  await db
    .prepare(
      "INSERT INTO email_log (id,user_id,event_type,subject,status,created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), uid, event, subject, status, now())
    .run();
}
export async function match(env: Env) {
  const db = env.PROJECT_PODFRIENDS_DB;
  await findPairs(db);
  // Claim each match announcement once, independently of profile completion.
  const announcements = (
    await db
      .prepare(
        "UPDATE quartet_members SET match_notified=1 WHERE match_notified=0 AND quartet_id IN (SELECT id FROM quartets WHERE status='active') RETURNING user_id",
      )
      .all<{ user_id: string }>()
  ).results;
  for (const member of announcements) {
    await notify(
      env,
      member.user_id,
      "match_found",
      "Good news, we found your Podfriends!",
      "Someone shares your podcast taste. Open Podfriends to meet them in a private conversation. If you haven't yet, finish your icebreakers to see your matches.",
    );
  }
  const pending = (
    await db
      .prepare(
        "SELECT m.quartet_id,p.* FROM quartet_members m JOIN profiles p ON p.user_id=m.user_id WHERE m.intro_posted=0 AND p.onboarding_completed=1",
      )
      .all<any>()
  ).results;
  for (const p of pending) {
    const answers = JSON.parse(p.icebreakers_json);
    const introduction = Object.entries({
      ...ICEBREAKERS,
      ...LEGACY_ICEBREAKERS,
    })
      .filter(([key]) => answers[key])
      .map(([key, question]) => `${question}\n${answers[key]}`)
      .join("\n\n");
    const body = `${p.display_name} joined!\n\n${introduction}`;
    const result = await db
      .prepare(
        "INSERT OR IGNORE INTO messages (id,quartet_id,user_id,type,body,created_at) VALUES (?,?,?,'system_intro',?,?)",
      )
      .bind(crypto.randomUUID(), p.quartet_id, p.user_id, body, now())
      .run();
    await db
      .prepare(
        "UPDATE quartet_members SET intro_posted=1 WHERE quartet_id=? AND user_id=?",
      )
      .bind(p.quartet_id, p.user_id)
      .run();
    if (result.meta.changes) {
      const members = (
        await db
          .prepare(
            "SELECT m.user_id FROM quartet_members m JOIN profiles p ON p.user_id=m.user_id WHERE m.quartet_id=? AND m.user_id!=? AND p.onboarding_completed=1",
          )
          .bind(p.quartet_id, p.user_id)
          .all<{ user_id: string }>()
      ).results;
      for (const m of members)
        await notify(
          env,
          m.user_id,
          "member_joined",
          "A new Podfriend joined",
          body,
        );
    }
  }
}
export default app;
