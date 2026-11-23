import { test } from "node:test";
import assert from "node:assert/strict";
import { initialScreen, setupComplete } from "../../frontend/setup.js";

test("signup only needs podcasts; icebreakers are deferred until a match", () => {
  assert.equal(initialScreen({ profile: null, podcasts: [] }), "podcasts");
  const waiting = {
    profile: { onboarding_completed: 0 },
    podcasts: [{ id: "123" }],
    quartet: null,
  };
  assert.equal(setupComplete(waiting), true);
  assert.equal(initialScreen(waiting), "home");
  assert.equal(
    initialScreen({ ...waiting, match_found: true, needs_icebreakers: true }),
    "profile",
  );
  assert.equal(
    initialScreen({
      ...waiting,
      profile: { onboarding_completed: 1 },
      quartet: { id: "matched" },
    }),
    "home",
  );
  assert.equal(
    initialScreen({ profile: { onboarding_completed: 1 }, podcasts: [] }),
    "podcasts",
  );
});
