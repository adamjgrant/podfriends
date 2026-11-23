import { searchPodcasts } from "./podcast-search.js";
import { setupComplete, initialScreen } from "./setup.js?v=20261122-4";
import { ensureCurrentPage } from "./bootstrap.js?v=20261122-5";
import { createPodcastPicker } from "./podcast-picker.js?v=20261122-5";

function startApp() {
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
    quartetId,
    selectedChatId,
    seenMessageIds = new Set(),
    cursor,
    polling = false,
    currentTab = "home",
    ready = false;
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
        element.tagName === "BUTTON"
          ? element
          : element.querySelector("button");
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
    const heading = $(name).querySelector("h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
  function renderNavigation() {
    const complete = setupComplete(me);
    $("main-nav").hidden = !me?.quartet;
    $("setup-progress").hidden = complete || !!me?.needs_icebreakers;
    $("setup-progress").textContent =
      "PICK YOUR SHOWS. WE'LL FIND YOUR PEOPLE.";
    $("setup-back").hidden =
      !!me?.quartet ||
      currentTab === "home" ||
      !complete ||
      !!me?.needs_icebreakers;
    $("setup-back").textContent = "Back to matching";
    $("edit-profile").hidden = !me?.profile?.onboarding_completed;
    $("profile-heading").textContent = me?.needs_icebreakers
      ? "Good news, we found your people!"
      : "Let them get to know you.";
    $("profile-description").textContent = me?.needs_icebreakers
      ? "Before we introduce you, answer these three quick icebreakers. Your matches will see your answers when you start chatting."
      : "A few conversation starters, like meeting someone at a party. Your name and answers are shared with your matches.";
    $("save-profile").textContent = me?.needs_icebreakers
      ? "Meet my Podfriends"
      : "Save my profile";
    $("save-rankings").textContent = complete
      ? "Save my podcasts"
      : "Find my people";
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
    status("Opening your account...");
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
  let toastTimer;
  function toast(message, undo, actionLabel = "Undo") {
    clearTimeout(toastTimer);
    $("toast-message").textContent = message;
    $("toast").hidden = false;
    $("toast-undo").hidden = !undo;
    $("toast-undo").textContent = actionLabel;
    $("toast-undo").onclick = () => {
      undo?.();
      $("toast").hidden = true;
    };
    // Undo stays available until dismissed or replaced by a later action.
    if (!undo)
      toastTimer = setTimeout(() => {
        $("toast").hidden = true;
      }, 4500);
  }
  $("toast-close").onclick = () => {
    $("toast").hidden = true;
  };
  const picker = createPodcastPicker({
    document,
    search: (term) =>
      searchPodcasts(term, (q) =>
        api("/podcasts/search?q=" + encodeURIComponent(q)),
      ),
    announce: toast,
    onChange: () => status(),
  });
  action($("save-rankings"), async () => {
    const podcasts = picker.getPodcasts();
    if (!podcasts.length) return;
    picker.setBusy(true);
    const label = $("save-rankings").textContent;
    $("save-rankings").textContent = "Saving your favorites…";
    try {
      await api("/podcasts/rankings", "PUT", {
        podcasts,
        email_notifications_enabled: $("match-emails").checked,
      });
      picker.markSaved();
      await refresh();
      tab(initialScreen(me));
      toast("Favorites saved. You're in the matching pool.");
    } finally {
      picker.setBusy(false);
      $("save-rankings").textContent = label;
    }
  });
  action(
    $("profile-form"),
    async () => {
      await api("/profile", "PUT", {
        display_name: $("display-name").value,
        icebreakers: Object.fromEntries(
          ICEBREAKERS.map(([key]) => [key, $(key).value]),
        ),
        email_notifications_enabled: $("emails").checked,
      });
      $("match-emails").checked = $("emails").checked;
      await refresh();
      tab(initialScreen(me));
      toast("Your introduction is ready. Welcome in!");
    },
    "submit",
  );
  $("edit-profile").onclick = () => tab("profile");
  $("edit-podcasts").onclick = () => tab("podcasts");
  $("setup-back").onclick = () => tab("home");
  async function refresh(initial = false) {
    const wasLocked = !!me?.needs_icebreakers;
    me = await api("/me");
    $("welcome").hidden = true;
    $("workspace").hidden = false;
    $("signout").hidden = false;
    if (initial) {
      picker.initialize(me.podcasts, me.user.id);
      $("display-name").value = me.profile?.display_name || me.user.name || "";
      const answers = JSON.parse(me.profile?.icebreakers_json || "{}");
      for (const [key] of ICEBREAKERS) $(key).value = answers[key] || "";
      $("emails").checked = !!me.profile?.email_notifications_enabled;
      $("match-emails").checked = !!me.profile?.email_notifications_enabled;
      tab(initialScreen(me));
    }
    // A newly discovered match interrupts waiting, not an in-progress icebreaker form.
    if (!initial && me.needs_icebreakers && !wasLocked) {
      $("emails").checked = !!me.profile?.email_notifications_enabled;
      if (currentTab === "home") tab("profile");
      else
        toast(
          "Good news, a match is ready!",
          () => tab("profile"),
          "Meet your match",
        );
    } else if (!initial && wasLocked && !me.needs_icebreakers)
      tab(initialScreen(me));
    $("waiting").hidden = !!me.quartet || !!me.needs_icebreakers;
    $("quartet").hidden = !me.quartet;
    renderNavigation();
    $("waiting-shows").replaceChildren();
    for (const podcast of me.podcasts.slice(0, 6)) {
      if (podcast.artwork_url?.startsWith("https://")) {
        const img = node("img");
        img.src = podcast.artwork_url;
        img.alt = podcast.title;
        img.title = podcast.title;
        $("waiting-shows").append(img);
      }
    }
    const chats = me.chats || (me.quartet ? [me.quartet] : []);
    $("conversations").hidden = !chats.length;
    $("chat-list").replaceChildren();
    const activeChat =
      chats.find((chat) => chat.id === selectedChatId) || chats[0];
    for (const chat of chats) {
      const card = button("", async () => {
        selectedChatId = chat.id;
        try {
          await refresh();
          tab("home");
        } catch (e) {
          status(e.message, true);
        }
      });
      card.className =
        "conversation-card" + (activeChat?.id === chat.id ? " active" : "");
      card.setAttribute("aria-pressed", String(activeChat?.id === chat.id));
      const name = chat.partner?.display_name || "Your new Podfriend";
      card.append(
        node("span", name.slice(0, 1).toUpperCase(), "avatar"),
        node("b", name),
      );
      const shared = chat.shared_podcasts || [];
      card.append(
        node(
          "small",
          shared.length
            ? shared.map((p) => p.title).join(" · ")
            : "A shared love of podcasts",
        ),
      );
      const badge = node(
        "span",
        `${shared.length || 1} shared ${shared.length === 1 ? "show" : "shows"}`,
        "overlap-badge",
      );
      badge.title =
        "Matches are ranked by overlap across your favorites, with more weight on your top picks.";
      card.append(badge);
      $("chat-list").append(card);
    }
    if (activeChat) {
      if (quartetId !== activeChat.id) {
        quartetId = activeChat.id;
        cursor = null;
        seenMessageIds.clear();
        $("new-messages").hidden = true;
        $("messages").replaceChildren();
      }
      const requestedId = quartetId;
      const d = await api(`/quartets/${requestedId}`);
      if (requestedId !== quartetId) return;
      $("quartet-name").textContent =
        activeChat.partner?.display_name ||
        d.members.find((m) => m.user_id !== me.user.id)?.display_name ||
        "Your new Podfriend";
      $("chat-empty").textContent =
        activeChat.partner?.onboarding_completed === 0
          ? "Your match is finishing their introduction. Leave a hello for when they're ready."
          : "Your conversation starts here. Say hello or share what you loved about a recent episode.";
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
  $("new-messages").onclick = () => {
    $("messages").scrollTop = $("messages").scrollHeight;
    $("new-messages").hidden = true;
  };
  $("messages").addEventListener("scroll", () => {
    const box = $("messages");
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 100)
      $("new-messages").hidden = true;
  });
  $("profile-form").addEventListener("input", () => {
    const answered = ICEBREAKERS.filter(([key]) => $(key).value.trim()).length;
    $("icebreaker-progress").textContent =
      answered === 3
        ? "You're ready to make your introduction."
        : `${answered} of 3 icebreakers answered. A sentence or two is plenty.`;
  });
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
      if (seenMessageIds.has(m.id)) continue;
      seenMessageIds.add(m.id);
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
    $("chat-empty").hidden = !!box.children.length;
    if (bottom) box.scrollTop = box.scrollHeight;
    else if (d.messages.length) $("new-messages").hidden = false;
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
  $("leave").onclick = () => $("leave-dialog").showModal();
  $("cancel-leave").onclick = () => $("leave-dialog").close();
  action($("confirm-leave"), async () => {
    await api(`/quartets/${quartetId}/leave`, "POST", {});
    $("leave-dialog").close();
    await refresh();
    toast("Conversation ended. Your other connections are still here.");
  });
  let ticks = 0;
  setInterval(async () => {
    if (!ready || !token || document.hidden || polling) return;
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
  $("signin").disabled = true;
  $("welcome").hidden = true;
  status("Checking your sign-in...");
  (async () => {
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.has("auth_code")) {
        history.replaceState(null, "", location.pathname + location.search);
        const d = await request("/api/exchange", "POST", {
          code: params.get("auth_code"),
        });
        if (!d.token)
          throw new Error(
            "Sign-in did not return a session. Please try again.",
          );
        setToken(d.token);
      }
      if (token) await refresh(true);
      else signedOut();
      status();
    } catch (e) {
      signedOut();
      status(e.message, true);
    } finally {
      ready = true;
      $("signin").disabled = false;
    }
  })();
}

if (ensureCurrentPage(document, location)) startApp();
