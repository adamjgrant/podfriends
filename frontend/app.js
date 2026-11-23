import { searchPodcasts } from "./podcast-search.js";
import { setupComplete, initialScreen } from "./setup.js";

const API = "https://side-project-bridge.smosa.workers.dev";
const KEY = "podfriends_token";
const ICEBREAKERS = [
  ["day_off", "What's your idea of a great day off?"],
  [
    "talk_for_hours",
    "What's something you could happily talk about for hours?",
  ],
  ["small_joy", "What's a small thing that always makes your day?"],
];
const $ = (id) => document.getElementById(id);
let token = localStorage.getItem(KEY),
  me,
  ranked = [],
  quartetId,
  cursor,
  polling = false,
  currentTab = "home";
function status(message = "", error = false) {
  $("status").textContent = message;
  $("status").hidden = !message;
  $("status").classList.toggle("error", error);
}
function setToken(value) {
  token = value;
  if (value) localStorage.setItem(KEY, value);
  else localStorage.removeItem(KEY);
}
async function request(path, method = "GET", body) {
  const r = await fetch(API + path, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) {
      setToken(null);
      signedOut();
    }
    const error = new Error(
      data.error || data.message || `Request failed (${r.status})`,
    );
    error.status = r.status;
    throw error;
  }
  return data;
}
const api = (path, method, body) =>
  request("/p/podfriends" + path, method, body);
function action(element, fn, event = "click") {
  element.addEventListener(event, async (e) => {
    e.preventDefault();
    const button =
      element.tagName === "BUTTON" ? element : element.querySelector("button");
    if (button) button.disabled = true;
    try {
      await fn(e);
    } catch (err) {
      status(err.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  });
}
function tab(name) {
  currentTab = name;
  for (const n of ["home", "podcasts", "profile"]) $(n).hidden = n !== name;
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  renderNavigation();
}
function renderNavigation() {
  const complete = setupComplete(me);
  $("main-nav").hidden = !me?.quartet;
  $("setup-progress").hidden = complete;
  $("setup-progress").textContent =
    currentTab === "profile"
      ? "STEP 1 OF 2 · A LITTLE ABOUT YOU"
      : "STEP 2 OF 2 · YOUR FAVORITE SHOWS";
  $("setup-back").hidden =
    !!me?.quartet ||
    currentTab === "home" ||
    (!complete && currentTab === "profile");
  $("setup-back").textContent = complete
    ? "Back to matching"
    : "Back to profile";
  $("save-profile").textContent = complete
    ? "Save my profile"
    : "Continue to podcasts";
  $("save-rankings").textContent = complete
    ? "Save my podcasts"
    : "Finish setup & find my people";
}
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
function signedOut() {
  me = null;
  quartetId = null;
  cursor = null;
  $("welcome").hidden = false;
  $("workspace").hidden = true;
  $("signout").hidden = true;
  $("messages").replaceChildren();
}
action($("signin"), async () => {
  status("Taking you to Google...");
  location.assign(
    API +
      "/api/login?callbackURL=" +
      encodeURIComponent(location.origin + location.pathname),
  );
});
action($("signout"), async () => {
  try {
    await request("/api/auth/sign-out", "POST", {});
  } finally {
    setToken(null);
    signedOut();
    status();
  }
});
function node(tag, text, className) {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (className) n.className = className;
  return n;
}
function button(label, fn, title) {
  const b = node("button", label, "quiet");
  b.type = "button";
  if (title) b.setAttribute("aria-label", title);
  b.onclick = fn;
  return b;
}
function podcastRow(p) {
  const row = node("li", null, "podcast");
  if (p.artwork_url?.startsWith("https://")) {
    const img = node("img");
    img.src = p.artwork_url;
    img.alt = "";
    img.loading = "lazy";
    row.append(img);
  }
  const info = node("div", null, "info");
  info.append(node("b", p.title), node("small", p.author));
  row.append(info);
  return row;
}
function renderRankings() {
  $("rankings").replaceChildren();
  ranked.forEach((p, i) => {
    const row = podcastRow(p);
    row.prepend(node("strong", String(i + 1)));
    row.append(
      button(
        "↑",
        () => {
          if (i > 0) {
            [ranked[i - 1], ranked[i]] = [ranked[i], ranked[i - 1]];
            renderRankings();
          }
        },
        `Move ${p.title} up`,
      ),
      button(
        "↓",
        () => {
          if (i < ranked.length - 1) {
            [ranked[i + 1], ranked[i]] = [ranked[i], ranked[i + 1]];
            renderRankings();
          }
        },
        `Move ${p.title} down`,
      ),
      button(
        "×",
        () => {
          ranked.splice(i, 1);
          renderRankings();
        },
        `Remove ${p.title}`,
      ),
    );
    $("rankings").append(row);
  });
}
action(
  $("search-form"),
  async () => {
    status("Searching podcasts...");
    $("results").replaceChildren();
    const d = await searchPodcasts($("search").value, (term) =>
      api("/podcasts/search?q=" + encodeURIComponent(term)),
    );
    for (const p of d.podcasts) {
      const row = podcastRow(p);
      row.append(
        button("Add", () => {
          if (ranked.some((x) => x.id === p.id)) return;
          if (ranked.length >= 20) {
            status("Choose up to 20 favorites.", true);
            return;
          }
          ranked.push(p);
          renderRankings();
          status(`${p.title} added. Save your favorites when you're ready.`);
        }),
      );
      $("results").append(row);
    }
    status(d.podcasts.length ? "" : "No shows found. Try a different search.");
  },
  "submit",
);
action($("save-rankings"), async () => {
  if (!ranked.length)
    throw new Error("Add at least one podcast so we can find your people.");
  await api("/podcasts/rankings", "PUT", { podcasts: ranked });
  await refresh();
  tab("home");
  status("Favorites saved. Matching runs now and every 15 minutes.");
});
action(
  $("profile-form"),
  async () => {
    const wasComplete = setupComplete(me);
    await api("/profile", "PUT", {
      display_name: $("display-name").value,
      icebreakers: Object.fromEntries(
        ICEBREAKERS.map(([key]) => [key, $(key).value]),
      ),
      email_notifications_enabled: $("emails").checked,
    });
    await refresh();
    tab(wasComplete ? "home" : "podcasts");
    status("Profile saved.");
  },
  "submit",
);
$("edit-profile").onclick = () => tab("profile");
$("edit-podcasts").onclick = () => tab("podcasts");
$("setup-back").onclick = () => tab(setupComplete(me) ? "home" : "profile");
async function refresh(initial = false) {
  me = await api("/me");
  $("welcome").hidden = true;
  $("workspace").hidden = false;
  $("signout").hidden = false;
  if (initial) {
    ranked = me.podcasts;
    renderRankings();
    $("display-name").value = me.profile?.display_name || me.user.name || "";
    const answers = JSON.parse(me.profile?.icebreakers_json || "{}");
    for (const [key] of ICEBREAKERS) $(key).value = answers[key] || "";
    $("emails").checked = !!me.profile?.email_notifications_enabled;
    tab(initialScreen(me));
  }
  $("waiting").hidden = !!me.quartet;
  $("quartet").hidden = !me.quartet;
  renderNavigation();
  if (me.quartet) {
    if (quartetId !== me.quartet.id) {
      quartetId = me.quartet.id;
      cursor = null;
      $("messages").replaceChildren();
    }
    const d = await api(`/quartets/${quartetId}`);
    $("quartet-name").textContent = d.quartet.name;
    $("members").replaceChildren();
    for (const m of d.members) {
      $("members").append(
        button(m.display_name, () => {
          $("bio-name").textContent = m.display_name;
          $("bio-answers").replaceChildren();
          const a = JSON.parse(m.icebreakers_json);
          // Keep existing answers under their original labels until members update them.
          for (const [key, label] of [
            ...ICEBREAKERS,
            ["favorite_episode", "Favorite episode"],
            ["listening_habit", "Listening habit"],
            ["bio", "About me"],
          ]) {
            if (a[key])
              $("bio-answers").append(node("h3", label), node("p", a[key]));
          }
          $("bio-dialog").showModal();
        }),
      );
    }
    await messages();
  } else {
    quartetId = null;
    cursor = null;
  }
}
$("close-dialog").onclick = () => $("bio-dialog").close();
async function messages() {
  if (!quartetId) return;
  const id = quartetId;
  const d = await api(
    `/quartets/${id}/messages` +
      (cursor ? "?after=" + encodeURIComponent(cursor) : ""),
  );
  if (id !== quartetId) return;
  const box = $("messages"),
    bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100;
  for (const m of d.messages) {
    const el = node(
      "article",
      null,
      "message" +
        (m.type !== "chat"
          ? " system"
          : m.user_id === me.user.id
            ? " own"
            : ""),
    );
    el.append(
      node(
        "small",
        `${m.type === "chat" ? m.display_name || "Podfriend" : "Podfriends"} · ${new Date(m.created_at).toLocaleString()}`,
      ),
      node("p", m.body),
    );
    if (m.type === "system_episode") {
      const data = JSON.parse(m.metadata_json);
      if (data.link?.startsWith("https://")) {
        const a = node("a", "Listen to episode ↗");
        a.href = data.link;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        el.append(a);
      }
    }
    box.append(el);
    cursor = m.id;
  }
  if (bottom) box.scrollTop = box.scrollHeight;
}
action(
  $("message-form"),
  async () => {
    await api(`/quartets/${quartetId}/messages`, "POST", {
      body: $("message").value,
    });
    $("message").value = "";
    await messages();
  },
  "submit",
);
action($("leave"), async () => {
  if (
    !confirm(
      "Leave this quartet? You will re-enter matching at the next scheduled run and could match with this group again.",
    )
  )
    return;
  await api(`/quartets/${quartetId}/leave`, "POST", {});
  await refresh();
  status("You left the quartet.");
});
let ticks = 0;
setInterval(async () => {
  if (!token || document.hidden || polling) return;
  polling = true;
  try {
    if (++ticks % 6 === 0 || !quartetId) await refresh();
    else if (currentTab === "home") await messages();
  } catch (e) {
    status(e.message, true);
  } finally {
    polling = false;
  }
}, 5000);
(async () => {
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has("auth_code")) {
      history.replaceState(null, "", location.pathname);
      const d = await request("/api/exchange", "POST", {
        code: params.get("auth_code"),
      });
      setToken(d.token);
    }
    if (token) await refresh(true);
    else signedOut();
  } catch (e) {
    status(e.message, true);
  }
})();
