import { test } from "node:test";
import assert from "node:assert/strict";
import { initialScreen, setupComplete } from "../../frontend/setup.js";

test("setup is profile, then podcasts, then waiting for a match", () => {
  assert.equal(initialScreen({ profile: null, podcasts: [] }), "profile");
  const profile = { onboarding_completed: 1 };
  assert.equal(initialScreen({ profile, podcasts: [] }), "podcasts");
  assert.equal(setupComplete({ profile, podcasts: [] }), false);
  const ready = { profile, podcasts: [{ id: "123" }], quartet: null };
  assert.equal(initialScreen(ready), "home");
  assert.equal(setupComplete(ready), true);
  assert.equal(initialScreen({ ...ready, quartet: { id: "matched" } }), "home");
});
