import { XMLParser } from "fast-xml-parser";
import type { Env } from "../auth";
import { safeUrl } from "./podfriends";

export function parseFeed(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unsupported XML declarations");
  const data = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
  }).parse(xml);
  const items = data.rss?.channel?.item ?? data.feed?.entry ?? [];
  const value = (v: any): string =>
    typeof v === "string" ? v : v?.["#text"] || "";
  return (Array.isArray(items) ? items : [items])
    .map((item: any) => {
      const link = value(item.link) || item.link?.["@_href"] || "";
      return {
        guid: value(item.guid) || value(item.id) || link,
        title: value(item.title),
        link: safeUrl(link) ? link : "",
        published_at: new Date(
          value(item.pubDate) || value(item.published) || value(item.updated),
        ).toISOString(),
      };
    })
    .filter((e) => e.guid && e.title)
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
}
export async function pollFeeds(env: Env) {
  const db = env.PROJECT_PODFRIENDS_DB;
  const feeds = (
    await db
      .prepare(
        "SELECT DISTINCT p.* FROM podcasts p JOIN quartets q ON q.podcast_id=p.id WHERE q.status='active' AND (p.last_checked_at IS NULL OR p.last_checked_at < ?) ORDER BY p.last_checked_at LIMIT 10",
      )
      .bind(new Date(Date.now() - 14 * 60000).toISOString())
      .all<any>()
  ).results;
  for (const feed of feeds) {
    try {
      if (!safeUrl(feed.feed_url)) continue;
      let url = feed.feed_url,
        r: Response | undefined;
      for (let i = 0; i < 4; i++) {
        r = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          redirect: "manual",
          headers: { "User-Agent": "Podfriends/1.0" },
        });
        if (r.status < 300 || r.status >= 400) break;
        url = new URL(r.headers.get("location") || "", url).href;
        if (!safeUrl(url)) throw new Error("Unsafe redirect");
      }
      if (!r?.ok || !r.body) throw new Error("Feed unavailable");
      const reader = r.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2000000) {
          await reader.cancel();
          throw new Error("Feed too large");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const episodes = parseFeed(new TextDecoder().decode(bytes)).slice(0, 50);
      const timestamp = new Date().toISOString();
      for (const e of [...episodes].reverse()) {
        const id = `${feed.id}:${e.guid}`;
        const statements = [
          db
            .prepare(
              "INSERT OR IGNORE INTO episodes (id,podcast_id,guid,title,link,published_at,created_at) VALUES (?,?,?,?,?,?,?)",
            )
            .bind(
              id,
              feed.id,
              e.guid,
              e.title,
              e.link,
              e.published_at,
              timestamp,
            ),
        ];
        if (
          feed.latest_episode_guid &&
          e.published_at > (feed.latest_episode_published_at || "")
        ) {
          // Deterministic IDs make cron retries safe without losing messages after a partial run.
          statements.push(
            db
              .prepare(
                "INSERT OR IGNORE INTO messages (id,quartet_id,type,body,metadata_json,created_at) SELECT ? || ':' || id,id,'system_episode',?,?,? FROM quartets WHERE podcast_id=? AND status='active'",
              )
              .bind(
                id,
                `New episode: ${e.title}`,
                JSON.stringify(e),
                timestamp,
                feed.id,
              ),
          );
        }
        await db.batch(statements);
      }
      await db
        .prepare(
          "UPDATE podcasts SET last_checked_at=?,latest_episode_guid=COALESCE(?,latest_episode_guid),latest_episode_published_at=COALESCE(?,latest_episode_published_at) WHERE id=?",
        )
        .bind(
          timestamp,
          episodes[0]?.guid ?? null,
          episodes[0]?.published_at ?? null,
          feed.id,
        )
        .run();
    } catch (e) {
      console.error("Feed check failed", feed.id, String(e));
      await db
        .prepare("UPDATE podcasts SET last_checked_at=? WHERE id=?")
        .bind(new Date().toISOString(), feed.id)
        .run();
    }
  }
}
