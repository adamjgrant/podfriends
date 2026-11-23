export function createPodcastPicker({
  document,
  search,
  onChange = () => {},
  announce = () => {},
}) {
  const $ = (id) => document.getElementById(id);
  let ranked = [],
    results = [],
    saved = "",
    query = "",
    sequence = 0,
    timer,
    storageKey,
    busy = false;
  const cache = new Map();
  const signature = () => JSON.stringify(ranked.map((p) => p.id));
  const element = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  function art(p) {
    const cover = element("div", "♫", "cover");
    if (p.artwork_url?.startsWith("https://")) {
      const img = element("img");
      img.src = p.artwork_url;
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => img.remove();
      cover.append(img);
    }
    return cover;
  }
  function persist() {
    if (!storageKey) return;
    try {
      document.defaultView.localStorage.setItem(
        storageKey,
        JSON.stringify({ podcasts: ranked, saved }),
      );
    } catch {
      /* Storage can be unavailable. Selection still works. */
    }
  }
  function changed(message) {
    persist();
    render();
    renderResults();
    onChange();
    if (message) $("picker-announcement").textContent = message;
  }
  function move(id, offset) {
    const index = ranked.findIndex((p) => p.id === id),
      target = index + offset;
    if (busy || index < 0 || target < 0 || target >= ranked.length) return;
    [ranked[index], ranked[target]] = [ranked[target], ranked[index]];
    changed(`${ranked[target].title} is now number ${target + 1}.`);
    const row = [...$("rankings").children].find((el) => el.dataset.id === id);
    const control = row?.querySelector(offset < 0 ? ".move-up" : ".move-down");
    (control?.disabled ? row.querySelector(".remove-show") : control)?.focus();
  }
  function remove(id) {
    if (busy) return;
    const index = ranked.findIndex((p) => p.id === id);
    if (index < 0) return;
    const [podcast] = ranked.splice(index, 1);
    changed(`${podcast.title} removed.`);
    announce("Removed from your favorites", () => {
      if (busy || ranked.some((p) => p.id === id) || ranked.length >= 20)
        return;
      ranked.splice(Math.min(index, ranked.length), 0, podcast);
      changed(`${podcast.title} restored.`);
    });
  }
  function toggle(p) {
    if (busy) return;
    if (ranked.some((x) => x.id === p.id)) {
      remove(p.id);
      return;
    }
    if (ranked.length >= 20) {
      $("picker-announcement").textContent =
        "Your list is full. Remove a show to add another.";
      return;
    }
    ranked.push(p);
    changed(`${p.title} added. ${ranked.length} shows selected.`);
  }
  function render() {
    $("rankings").replaceChildren();
    $("selection-empty").hidden = ranked.length > 0;
    $("selection-count").textContent = String(ranked.length);
    $("review-selection").hidden = !ranked.length;
    $("review-selection").textContent =
      `${ranked.length} ${ranked.length === 1 ? "show" : "shows"} selected · Review favorites ↓`;
    $("selection-hint").textContent = ranked.length
      ? "Your top shows come first. Drag or use the arrows to reorder."
      : "Start with one show you love. You can always add more.";
    $("selection-state").textContent = !ranked.length
      ? "Choose at least one show to get started"
      : signature() !== saved
        ? "Changes kept on this device. Save to start matching."
        : "Your favorites are saved";
    ranked.forEach((p, i) => {
      const row = element("li", null, "favorite-row");
      row.dataset.id = p.id;
      row.draggable = !busy;
      const rank = element(
        "span",
        String(i + 1).padStart(2, "0"),
        "rank-number",
      );
      rank.title = "Drag to reorder";
      const info = element("div", null, "favorite-info");
      info.append(
        element("b", p.title),
        element("small", i === 0 ? "Your top pick" : p.author),
      );
      const controls = element("div", null, "rank-controls");
      for (const [label, offset, cls] of [
        ["↑", -1, "move-up"],
        ["↓", 1, "move-down"],
      ]) {
        const b = element("button", label, cls);
        b.type = "button";
        b.setAttribute(
          "aria-label",
          `Move ${p.title} ${offset < 0 ? "up" : "down"}`,
        );
        b.disabled = busy || (offset < 0 ? i === 0 : i === ranked.length - 1);
        b.onclick = () => move(p.id, offset);
        controls.append(b);
      }
      const del = element("button", "×", "remove-show");
      del.type = "button";
      del.disabled = busy;
      del.setAttribute("aria-label", `Remove ${p.title}`);
      del.onclick = () => remove(p.id);
      controls.append(del);
      row.append(rank, art(p), info, controls);
      row.ondragstart = (e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("text/plain", p.id);
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
      };
      row.ondragend = () => row.classList.remove("dragging");
      row.ondragover = (e) => {
        if (!busy) e.preventDefault();
      };
      row.ondrop = (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        const from = ranked.findIndex((p) => p.id === id);
        if (from >= 0) move(id, i - from);
      };
      $("rankings").append(row);
    });
    $("save-rankings").disabled = busy || !ranked.length;
  }
  function renderResults() {
    const focused = document.activeElement?.dataset.podcast;
    $("results").replaceChildren();
    results.forEach((p) => {
      const selected = ranked.some((x) => x.id === p.id);
      const row = element(
        "li",
        null,
        `podcast-card${selected ? " selected" : ""}`,
      );
      const info = element("div", null, "card-info");
      info.append(element("b", p.title), element("small", p.author));
      const b = element("button", selected ? "✓ Added" : "+ Add", "add-show");
      b.type = "button";
      b.dataset.podcast = p.id;
      b.disabled = busy || (!selected && ranked.length >= 20);
      b.setAttribute("aria-pressed", String(selected));
      b.setAttribute("aria-label", `${selected ? "Remove" : "Add"} ${p.title}`);
      b.onclick = () => toggle(p);
      row.append(art(p), info, b);
      $("results").append(row);
    });
    if (focused)
      [...$("results").querySelectorAll("button")]
        .find((b) => b.dataset.podcast === focused)
        ?.focus();
  }
  async function runSearch() {
    clearTimeout(timer);
    const term = $("search").value.trim();
    query = term;
    const ticket = ++sequence;
    $("clear-search").hidden = !term;
    if (term.length < 2) {
      results = [];
      renderResults();
      $("results").setAttribute("aria-busy", "false");
      $("search-feedback").textContent = term
        ? "Keep typing to search."
        : "Search your favorites, or try a suggestion below.";
      $("search-feedback").classList.remove("error");
      return;
    }
    $("search-feedback").classList.remove("error");
    $("search-feedback").textContent = `Searching for “${term}”…`;
    $("results").setAttribute("aria-busy", "true");
    $("results").replaceChildren(
      ...Array.from({ length: 4 }, () => element("li", null, "skeleton-card")),
    );
    try {
      let data = cache.get(term.toLowerCase());
      if (!data) {
        data = await search(term);
        cache.set(term.toLowerCase(), data);
      }
      if (ticket !== sequence) return;
      results = data.podcasts;
      renderResults();
      $("search-feedback").textContent = results.length
        ? `${results.length} shows for “${term}”`
        : `No shows found for “${term}”. Try the host's name or a shorter title.`;
    } catch (e) {
      if (ticket !== sequence) return;
      results = [];
      renderResults();
      $("search-feedback").classList.add("error");
      $("search-feedback").textContent = `${e.message} Press Search to retry.`;
    } finally {
      if (ticket === sequence) $("results").setAttribute("aria-busy", "false");
    }
  }
  $("search").addEventListener("input", () => {
    ++sequence;
    clearTimeout(timer);
    $("clear-search").hidden = !$("search").value;
    // Invalidate in-flight results immediately, not only when the debounce fires.
    timer = setTimeout(runSearch, 550);
  });
  $("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch();
  });
  $("review-selection").onclick = () => {
    $("selection-heading").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    $("save-rankings").focus({ preventScroll: true });
  };
  $("clear-search").onclick = () => {
    $("search").value = "";
    runSearch();
    $("search").focus();
  };
  document.querySelectorAll("[data-search]").forEach(
    (b) =>
      (b.onclick = () => {
        $("search").value = b.dataset.search;
        runSearch();
        $("search").focus();
      }),
  );
  return {
    getPodcasts: () => [...ranked],
    isDirty: () => signature() !== saved,
    setBusy(value) {
      busy = value;
      render();
      renderResults();
    },
    markSaved() {
      saved = signature();
      persist();
      render();
    },
    initialize(podcasts, userId) {
      ranked = [...podcasts];
      saved = signature();
      storageKey = `podfriends_draft_${userId}`;
      try {
        const draft = JSON.parse(
          document.defaultView.localStorage.getItem(storageKey) || "null",
        );
        if (
          draft?.saved === saved &&
          Array.isArray(draft.podcasts) &&
          draft.podcasts.length <= 20 &&
          draft.podcasts.every(
            (p) =>
              p &&
              typeof p.id === "string" &&
              typeof p.title === "string" &&
              typeof p.feed_url === "string",
          )
        )
          ranked = draft.podcasts;
      } catch {
        /* A stale draft must never prevent sign-in. */
      }
      render();
      renderResults();
      if (signature() !== saved)
        announce("Your unfinished favorites list has been restored.");
    },
  };
}
