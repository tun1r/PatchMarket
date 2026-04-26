// Normalizes raw model output into a clean unified diff that the existing
// verifier can apply. Real-world model outputs have a long tail of bad
// shapes — fenced code blocks, leading prose, "./" path prefixes, no
// header, multiple fences, trailing commentary. This module is the gate
// that turns them into something `applyUnifiedPatch` can swallow.
//
// Returns { ok, patch, error } where error.code is one of:
//   patch.empty            no input
//   patch.no_header        no `diff --git` line found
//   patch.forbidden_path   from validatePatch
//   patch.path_not_allowed from validatePatch

import { validatePatch } from "./core.mjs";

export function normalizePatch(raw, { allowedPaths = ["src/auth.mjs"] } = {}) {
  if (!raw || typeof raw !== "string") {
    return {
      ok: false,
      error: {
        code: "patch.empty",
        message: "No patch text returned by engine.",
        cause: "Engine output was empty or non-string.",
        fix: "Retry the engine with the same prompt."
      }
    };
  }

  let text = raw;

  // 1. Strip markdown code fences. Models love wrapping diffs in ```diff…```
  //    or ```patch…``` or just ```…```. Take the first fenced block if any
  //    fence at all is present; otherwise leave text alone.
  text = stripFences(text);

  // 2. Drop everything before the first `diff --git ` line. Models often
  //    write a prelude like "Here's the patch:" before the diff body.
  const headerIdx = text.search(/^diff --git /m);
  if (headerIdx === -1) {
    return {
      ok: false,
      error: {
        code: "patch.no_header",
        message: "No `diff --git` header in engine output.",
        cause: "Engine emitted prose or partial diff without a header line.",
        fix: "Retry with stricter prompt; first line must be `diff --git a/PATH b/PATH`.",
        sample: raw.slice(0, 200)
      }
    };
  }
  text = text.slice(headerIdx);

  // 3. Trim trailing prose. After the last hunk line, models sometimes add
  //    "This patch fixes...". We cut at the next blank line that's not
  //    followed by another diff/file marker.
  text = trimTrailingProse(text);

  // 4. Normalize "./" path prefixes that some models emit.
  text = text
    .replace(/^(diff --git a\/)\.\//gm, "$1")
    .replace(/^(diff --git a\/[^ ]+ b\/)\.\//gm, "$1")
    .replace(/^(--- a\/)\.\//gm, "$1")
    .replace(/^(\+\+\+ b\/)\.\//gm, "$1");

  // 5. Ensure the final byte is a newline; verifier's hunk applier expects it.
  if (!text.endsWith("\n")) text += "\n";

  // 6. Hand to the existing strict path validator (no test edits, no
  //    package/CI/lockfile edits, no path traversal, allowed paths only).
  const validation = validatePatch(text, allowedPaths);
  if (!validation.ok) {
    const pm = validation.error?.patchMarket || {};
    return {
      ok: false,
      error: {
        code: pm.code || "patch.invalid",
        message: pm.message || "Patch failed validation.",
        cause: pm.cause,
        fix: pm.fix,
        sample: text.slice(0, 200)
      }
    };
  }

  return { ok: true, patch: text };
}

function stripFences(text) {
  const fenced = text.match(/```(?:diff|patch|git|gitdiff)?\s*\n([\s\S]*?)\n```/);
  if (fenced) {
    return fenced[1].trim() + "\n";
  }
  // Naked triple-backtick wrap with no language.
  if (text.trimStart().startsWith("```") && text.trimEnd().endsWith("```")) {
    return text.trim().slice(3, -3).replace(/^[a-z]+\n/, "").trim() + "\n";
  }
  return text;
}

function trimTrailingProse(text) {
  // Walk backwards from the end. A line is "diff content" if it starts
  // with one of: " ", "+", "-", "@@", "diff ", "index ", "+++ ", "--- ",
  // "Binary ", "\\". Anything else after the diff is prose.
  const lines = text.split("\n");
  let lastDiffIdx = lines.length - 1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === "") continue;
    if (/^( |\+|-|@@|diff |index |--- |\+\+\+ |Binary |\\)/.test(line)) {
      lastDiffIdx = i;
      break;
    }
  }
  return lines.slice(0, lastDiffIdx + 1).join("\n");
}
