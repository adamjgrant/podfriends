import { Hono } from "hono";
import { createAuth, type Env } from "./auth";
import {
  getAllAllowedOrigins,
  PROJECTS,
  type ProjectConfig,
} from "./projects";

import podfriends, { match } from "./projects/podfriends";
import { pollFeeds } from "./projects/feeds";

export type AppVariables = {
  project: ProjectConfig;
  projectDb: D1Database;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function applyCorsHeaders(headers: Headers, origin: string | null) {
  if (!origin) return;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  headers.set("Access-Control-Expose-Headers", "set-auth-token");
  headers.append("Vary", "Origin");
}

function parseOwnerEmails(env: Env): Set<string> {
  return new Set(
    (env.OWNER_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

app.get("/health", (c) => {
  return c.json({ ok: true, projects: Object.keys(PROJECTS) });
});

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin") ?? null;
  const allowed = new Set([
    ...getAllAllowedOrigins(),
    "https://appleid.apple.com",
  ]);

  if (c.req.method === "OPTIONS") {
    if (!origin || !allowed.has(origin)) {
      return c.text("Origin not allowed", 403);
    }
    const headers = new Headers();
    applyCorsHeaders(headers, origin);
    return new Response(null, { status: 204, headers });
  }

  await next();

  if (origin && allowed.has(origin)) {
    applyCorsHeaders(c.res.headers, origin);
  }
});

app.post("/api/exchange", async (c) => {
  const body = await c.req
    .json<{ code?: string }>()
    .catch((): { code?: string } => ({}));
  const code = body.code?.trim();
  if (!code) {
    return c.json({ error: "Missing code" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const row = await c.env.AUTH_DB.prepare(
    "DELETE FROM auth_exchange_codes WHERE code = ? RETURNING token, expires_at"
  )
    .bind(code)
    .first<{ token: string; expires_at: number }>();

  await c.env.AUTH_DB.prepare(
    "DELETE FROM auth_exchange_codes WHERE code = ? OR expires_at < ?"
  )
    .bind(code, now)
    .run();

  if (!row || row.expires_at < now) {
    return c.json({ error: "Invalid or expired code" }, 400);
  }

  return c.json({ token: row.token });
});

// Start OAuth as a top-level navigation so its CSRF cookie is first-party.
// A cross-site fetch from GitHub Pages cannot reliably set this cookie.
app.get("/api/login", async (c) => {
  let callback: URL;
  try { callback = new URL(c.req.query("callbackURL") || ""); }
  catch { return c.json({ error: "Invalid callback URL" }, 400); }
  if (!getAllAllowedOrigins().includes(callback.origin) || callback.username || callback.password) {
    return c.json({ error: "Callback origin not allowed" }, 400);
  }
  const origin = new URL(c.req.url).origin;
  const request = new Request(`${origin}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ provider: "google", callbackURL: callback.href, disableRedirect: true }),
  });
  const response = await createAuth(c.env, request).handler(request);
  if (!response.ok) return response;
  const data = await response.json() as { url?: string };
  if (!data.url || new URL(data.url).origin !== "https://accounts.google.com") {
    return c.json({ error: "Could not start Google sign-in" }, 502);
  }
  const headers = new Headers(response.headers);
  headers.set("Location", data.url);
  headers.set("Cache-Control", "no-store");
  headers.delete("Content-Length");
  return new Response(null, { status: 302, headers });
});

app.all("/api/auth/*", async (c) => {
  const auth = createAuth(c.env, c.req.raw);
  const response = await auth.handler(c.req.raw);

  const url = new URL(c.req.url);
  const isOAuthCallback = url.pathname.startsWith("/api/auth/callback/");
  const authToken = response.headers.get("set-auth-token");
  const location = response.headers.get("Location");

  if (
    isOAuthCallback &&
    response.status >= 300 &&
    response.status < 400 &&
    location &&
    authToken
  ) {
    const code = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    await c.env.AUTH_DB.prepare(
      "INSERT INTO auth_exchange_codes (code, token, expires_at) VALUES (?, ?, ?)"
    )
      .bind(code, authToken, expiresAt)
      .run();

    const redirectUrl = new URL(location, url.origin);
    redirectUrl.hash = `auth_code=${encodeURIComponent(code)}`;

    const newHeaders = new Headers(response.headers);
    newHeaders.set("Location", redirectUrl.toString());
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  return response;
});

app.use("/p/:projectId/*", async (c, next) => {
  const projectId = c.req.param("projectId");
  const project = PROJECTS[projectId];
  if (!project) {
    return c.json({ error: "Unknown project" }, 404);
  }

  const origin = c.req.header("Origin") ?? null;
  const originAllowed = origin ? project.allowedOrigins.includes(origin) : false;

  if (c.req.method === "OPTIONS") {
    if (!originAllowed) {
      return c.text("Origin not allowed for this project", 403);
    }
    const headers = new Headers();
    applyCorsHeaders(headers, origin);
    return new Response(null, { status: 204, headers });
  }

  if (origin && !originAllowed) {
    return c.json({ error: "Origin not allowed for this project" }, 403);
  }

  const auth = createAuth(c.env, c.req.raw);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session?.user) {
    const res = c.json({ error: "Unauthorized" }, 401);
    if (originAllowed) applyCorsHeaders(res.headers, origin);
    return res;
  }

  const userEmail = session.user.email.toLowerCase();
  const owners = parseOwnerEmails(c.env);

  if (project.accessMode === "owner_only" && !owners.has(userEmail)) {
    const res = c.json({ error: "Forbidden: owner only" }, 403);
    if (originAllowed) applyCorsHeaders(res.headers, origin);
    return res;
  }

  if (project.accessMode === "allowlist") {
    const allowlist = new Set(
      (project.allowedEmails || []).map((e) => e.toLowerCase())
    );
    if (!owners.has(userEmail) && !allowlist.has(userEmail)) {
      const res = c.json({ error: "Forbidden: not on project allowlist" }, 403);
      if (originAllowed) applyCorsHeaders(res.headers, origin);
      return res;
    }
  }

  await c.env.AUTH_DB.prepare(
    "INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)"
  )
    .bind(
      project.id,
      session.user.id,
      owners.has(userEmail) ? "owner" : "member"
    )
    .run();

  c.set("project", project);
  c.set("projectDb", c.env[project.dbBinding]);
  c.set("user", {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  await next();

  if (originAllowed) {
    applyCorsHeaders(c.res.headers, origin);
  }
});

app.route("/p/podfriends", podfriends);

app.get("/p/:projectId/me", (c) => {
  return c.json({
    project: c.get("project").id,
    user: c.get("user"),
  });
});

app.get("/p/notes/notes", async (c) => {
  const db = c.get("projectDb");
  const user = c.get("user");
  const { results } = await db
    .prepare(
      "SELECT id, title, body, created_at, updated_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC"
    )
    .bind(user.id)
    .all();

  return c.json({ notes: results });
});

app.post("/p/notes/notes", async (c) => {
  const db = c.get("projectDb");
  const user = c.get("user");
  const input = await c.req
    .json<{ title?: string; body?: string }>()
    .catch((): { title?: string; body?: string } => ({}));

  const title = (input.title || "").trim();
  const body = (input.body || "").trim();
  if (!title) {
    return c.json({ error: "Title is required" }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      "INSERT INTO notes (id, user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, user.id, title, body, now, now)
    .run();

  return c.json(
    { note: { id, title, body, created_at: now, updated_at: now } },
    201
  );
});

app.delete("/p/notes/notes/:noteId", async (c) => {
  const db = c.get("projectDb");
  const user = c.get("user");
  const noteId = c.req.param("noteId");

  const result = await db
    .prepare("DELETE FROM notes WHERE id = ? AND user_id = ?")
    .bind(noteId, user.id)
    .run();

  if (!result.meta.changes) {
    return c.json({ error: "Note not found" }, 404);
  }

  return c.json({ deleted: true, id: noteId });
});

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => { await match(env); await pollFeeds(env); })());
  },
};
