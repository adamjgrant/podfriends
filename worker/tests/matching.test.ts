import { test } from "node:test";
import assert from "node:assert/strict";
import { compatibility } from "../src/projects/matching";
const picks = (...ids: string[]) =>
  ids.map((id, i) => ({ id, title: id, rank: i + 1 }));
test("compatibility considers all shared shows and gives top choices more weight", () => {
  const own = picks("a", "b", "c");
  assert.equal(compatibility(own, own).score, 100);
  assert.equal(compatibility(own, picks("x", "y")).score, 0);
  assert.ok(
    compatibility(own, picks("a", "b", "x")).score >
      compatibility(own, picks("a", "x", "y")).score,
  );
  assert.ok(
    compatibility(own, picks("a")).score > compatibility(own, picks("c")).score,
  );
  assert.equal(
    compatibility(own, picks("b", "a")).score,
    compatibility(picks("b", "a"), own).score,
  );
});
