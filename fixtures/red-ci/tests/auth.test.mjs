import assert from "node:assert/strict";
import test from "node:test";
import { validateToken } from "../src/auth.mjs";

test("validates active token", () => {
  const now = Date.now();
  assert.equal(validateToken({ expiresAt: now + 60_000 }, now), true);
});

test("rejects expired token", () => {
  const now = Date.now();
  assert.equal(validateToken({ expiresAt: now }, now), false);
});
