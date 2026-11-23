// iTunes allows public, credential-free browser requests with CORS.
// Fall back to that path when its edge rejects or times out the Worker request.
export function normalizePodcasts(data) {
  if (!Array.isArray(data?.results)) {
    throw new Error("The podcast directory returned an unexpected response.");
  }
  const seen = new Set();
  return data.results
    .filter((p) => {
      if (
        !p.collectionId ||
        !p.collectionName ||
        !p.feedUrl?.startsWith("https://")
      )
        return false;
      const id = String(p.collectionId);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((p) => ({
      id: String(p.collectionId),
      title: p.collectionName,
      author: p.artistName || "",
      feed_url: p.feedUrl,
      artwork_url: p.artworkUrl600 || "",
    }));
}

export async function searchPodcasts(query, proxySearch, fetcher = fetch) {
  const term = query.trim().slice(0, 120);
  if (term.length < 2) return { podcasts: [] };
  try {
    return await proxySearch(term);
  } catch (error) {
    // A directory fallback must not mask an expired session or denied access.
    if (error.status === 401 || error.status === 403) throw error;
    try {
      const url = new URL("https://itunes.apple.com/search");
      url.search = new URLSearchParams({
        media: "podcast",
        entity: "podcast",
        limit: "20",
        term,
      }).toString();
      const response = await fetcher(url.href, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(`Directory returned ${response.status}`);
      return { podcasts: normalizePodcasts(await response.json()) };
    } catch {
      throw new Error(
        "We couldn't reach the podcast directory. Please try again in a moment.",
      );
    }
  }
}
