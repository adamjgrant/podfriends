import { test } from "node:test";
import assert from "node:assert/strict";
import {
  searchPodcasts,
  normalizePodcasts,
} from "../../frontend/podcast-search.js";

const show = {
  collectionId: 1608813794,
  collectionName: "MrBallen Podcast",
  artistName: "Ballen Studios",
  feedUrl: "https://example.com/feed",
  artworkUrl600: "https://example.com/art.jpg",
};
test("uses proxy results without a second directory request", async () => {
  const expected = { podcasts: [{ id: "123", title: "Show" }] };
  assert.equal(
    await searchPodcasts(
      " mr ballen ",
      async (term) => {
        assert.equal(term, "mr ballen");
        return expected;
      },
      async () => {
        throw new Error("Unexpected fallback");
      },
    ),
    expected,
  );
});
test("falls back to public directory without sending a bearer token or cookies", async () => {
  const result = await searchPodcasts(
    "mr ballen",
    async () => {
      throw Object.assign(new Error("Proxy unavailable"), { status: 502 });
    },
    async (url, options) => {
      const u = new URL(url);
      assert.equal(u.origin, "https://itunes.apple.com");
      assert.equal(u.searchParams.get("term"), "mr ballen");
      assert.equal(options.credentials, "omit");
      assert.equal(options.headers, undefined);
      return new Response(
        JSON.stringify({
          results: [
            show,
            show,
            { ...show, collectionId: 2, feedUrl: "http://example.com/feed" },
          ],
        }),
      );
    },
  );
  assert.deepEqual(result.podcasts, [
    {
      id: "1608813794",
      title: "MrBallen Podcast",
      author: "Ballen Studios",
      feed_url: "https://example.com/feed",
      artwork_url: "https://example.com/art.jpg",
    },
  ]);
});
test("does not hide expired sessions or access denials", async () => {
  for (const status of [401, 403]) {
    const error = Object.assign(new Error("Sign in again"), { status });
    await assert.rejects(
      searchPodcasts(
        "show",
        async () => {
          throw error;
        },
        async () => {
          assert.fail("Must not fall back");
        },
      ),
      error,
    );
  }
});
test("directory failure has an actionable error; empty results remain valid", async () => {
  assert.deepEqual(normalizePodcasts({ results: [] }), []);
  await assert.rejects(
    searchPodcasts(
      "show",
      async () => {
        throw new Error("Timeout");
      },
      async () => new Response("Unavailable", { status: 503 }),
    ),
    /try again/,
  );
  assert.throws(() => normalizePodcasts({ error: "Bad response" }));
});
