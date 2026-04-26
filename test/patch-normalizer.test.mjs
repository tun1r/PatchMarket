import assert from "node:assert/strict";
import test from "node:test";
import { normalizePatch } from "../src/patch-normalizer.mjs";

const ALLOWED = ["src/auth.mjs"];

const GOOD_DIFF = `diff --git a/src/auth.mjs b/src/auth.mjs
index 22c2b89..9c3fe02 100644
--- a/src/auth.mjs
+++ b/src/auth.mjs
@@
 export function isTokenExpired(expiresAt, now = Date.now()) {
-  return expiresAt < now - 30000;
+  return expiresAt <= now;
 }
`;

test("normalizer accepts a clean diff", () => {
  const result = normalizePatch(GOOD_DIFF, { allowedPaths: ALLOWED });
  assert.equal(result.ok, true);
  assert.match(result.patch, /^diff --git a\/src\/auth\.mjs/);
});

test("normalizer strips ```diff fence wrappers", () => {
  const fenced = "```diff\n" + GOOD_DIFF + "```";
  const result = normalizePatch(fenced, { allowedPaths: ALLOWED });
  assert.equal(result.ok, true);
  assert.match(result.patch, /^diff --git a\/src\/auth\.mjs/);
  assert.doesNotMatch(result.patch, /```/);
});

test("normalizer drops leading prose before the diff header", () => {
  const proseBefore = `Here is the patch you requested:\n\n${GOOD_DIFF}`;
  const result = normalizePatch(proseBefore, { allowedPaths: ALLOWED });
  assert.equal(result.ok, true);
  assert.match(result.patch, /^diff --git a\/src\/auth\.mjs/);
});

test("normalizer rewrites ./ path prefixes", () => {
  const dotPrefix = GOOD_DIFF.replace(/a\/src/g, "a/./src").replace(/b\/src/g, "b/./src");
  const result = normalizePatch(dotPrefix, { allowedPaths: ALLOWED });
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.patch, /a\/\.\//);
  assert.doesNotMatch(result.patch, /b\/\.\//);
});

test("normalizer rejects output with no diff header", () => {
  const noHeader = "I think the fix is to change the comparison operator.";
  const result = normalizePatch(noHeader, { allowedPaths: ALLOWED });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "patch.no_header");
});

test("normalizer rejects edits to test files via existing validator", () => {
  const badPath = `diff --git a/tests/auth.test.mjs b/tests/auth.test.mjs
--- a/tests/auth.test.mjs
+++ b/tests/auth.test.mjs
@@
-assert.equal(false, true)
+assert.equal(true, true)
`;
  const result = normalizePatch(badPath, { allowedPaths: ALLOWED });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "patch.forbidden_path");
});

test("normalizer trims trailing prose after the diff", () => {
  const trailing = `${GOOD_DIFF}\nThis patch tightens the comparison so expired tokens are rejected immediately.`;
  const result = normalizePatch(trailing, { allowedPaths: ALLOWED });
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.patch, /tightens the comparison/);
});
