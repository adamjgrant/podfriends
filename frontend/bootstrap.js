export const PAGE_VERSION = "20261122-3";

// GitHub Pages caches HTML and JS separately. Never run a new UI against old markup.
// Keep the OAuth hash intact so the refreshed page can still exchange its code.
export function ensureCurrentPage(document, location) {
  if (document.documentElement.dataset.appVersion === PAGE_VERSION) return true;
  const url = new URL(location.href);
  if (url.searchParams.get("ui") !== PAGE_VERSION) {
    url.searchParams.set("ui", PAGE_VERSION);
    location.replace(url.href);
  } else {
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent =
      "The site is still updating. Please wait a moment and refresh this page. You do not need to sign in again.";
    document.body.replaceChildren(message);
  }
  return false;
}
