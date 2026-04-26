// Live worker patch generation. Spawns a coding-agent CLI (Claude Code,
// OpenCode, Codex) as a subprocess, hands it a bounded prompt with the
// failing test + source + allowed paths, parses the diff out, and runs
// it through the patch normalizer. Up to 3 attempts before the caller's
// fallback ladder kicks in.
//
// The engine is the part that's "really" autonomous. The buyer pays for
// a verified outcome; this module is what produces the outcome.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePatch } from "./patch-normalizer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(__dirname, "..");

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;

const SYSTEM_PROMPT = [
  "You are PatchPro, an autonomous worker agent in PatchMarket.",
  "Output ONLY a unified git diff that fixes the failing test described in the user message.",
  "",
  "Hard rules:",
  "- The first line MUST be `diff --git a/PATH b/PATH`.",
  "- Touch ONLY the files listed in <allowed_paths>.",
  "- Do NOT modify the test file.",
  "- Do NOT include any prose, commentary, or explanation. No code fences. No markdown. No <think> tags.",
  "- Use standard unified diff format with `@@` hunk headers and ` `, `+`, `-` line prefixes.",
  "- Keep the diff minimal — touch the smallest set of lines that flips the failing assertion to passing."
].join("\n");

export async function generateLivePatch({
  engine = "claude-code",
  rootDir = defaultRootDir,
  failingTestPath = "fixtures/red-ci/tests/auth.test.mjs",
  sourcePath = "fixtures/red-ci/src/auth.mjs",
  allowedPaths = ["src/auth.mjs"],
  failingLog = "",
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = () => {}
} = {}) {
  const failingTest = await fs.readFile(path.join(rootDir, failingTestPath), "utf8");
  const source = await fs.readFile(path.join(rootDir, sourcePath), "utf8");

  const userPrompt = buildUserPrompt({
    failingTest,
    source,
    failingLog,
    allowedPaths,
    sourcePath,
    failingTestPath
  });

  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    let raw;
    try {
      raw = await invokeEngine(engine, SYSTEM_PROMPT, userPrompt, { timeoutMs });
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      attempts.push({ attempt, latencyMs, ok: false, reason: error.message });
      log(`[${engine}] attempt ${attempt} failed: ${error.message}`);
      continue;
    }

    const latencyMs = Date.now() - startedAt;
    const normalized = normalizePatch(raw, { allowedPaths });
    if (normalized.ok) {
      log(`[${engine}] attempt ${attempt} produced valid patch in ${latencyMs}ms`);
      return {
        patch: normalized.patch,
        engine,
        attempts: attempt,
        latencyMs,
        history: [...attempts, { attempt, latencyMs, ok: true }]
      };
    }
    attempts.push({
      attempt,
      latencyMs,
      ok: false,
      reason: normalized.error?.code,
      sample: normalized.error?.sample
    });
    log(
      `[${engine}] attempt ${attempt} normalize failed: ${normalized.error?.code} (${latencyMs}ms)`
    );
  }

  const error = new Error(
    `Live engine "${engine}" exhausted ${maxAttempts} attempts without a valid patch.`
  );
  error.engine = engine;
  error.attempts = attempts;
  throw error;
}

function buildUserPrompt({
  failingTest,
  source,
  failingLog,
  allowedPaths,
  sourcePath,
  failingTestPath
}) {
  return [
    `<failing_test path="${failingTestPath}">`,
    failingTest.trimEnd(),
    "</failing_test>",
    "",
    `<source path="${sourcePath}">`,
    source.trimEnd(),
    "</source>",
    "",
    "<failing_log>",
    (failingLog || "(see test above)").trimEnd(),
    "</failing_log>",
    "",
    "<allowed_paths>",
    allowedPaths.join("\n"),
    "</allowed_paths>",
    "",
    "Output a unified git diff that fixes the failing test. Output ONLY the diff. No prose, no fences."
  ].join("\n");
}

async function invokeEngine(engine, systemPrompt, userPrompt, { timeoutMs }) {
  if (engine === "claude-code" || engine === "claude") {
    // --print: non-interactive single response, prints to stdout.
    // --disallowedTools "*": deny every tool. Worker's job is to emit a
    //   unified diff as text — it does not need file write, shell, web,
    //   or any other capability. Avoiding tools also stops the subprocess
    //   from prompting for permissions, which would hang.
    // --system-prompt: replace the default with the strict PatchPro shape.
    // We deliberately don't pass --bare: that forces ANTHROPIC_API_KEY
    // auth and ignores the existing OAuth login, so the subprocess fails
    // for users who're already logged in via `claude /login`.
    return spawnCli(
      "claude",
      [
        "--print",
        "--disallowedTools",
        "*",
        "--system-prompt",
        systemPrompt,
        userPrompt
      ],
      { timeoutMs }
    );
  }
  if (engine === "codex" || engine === "codex-cli") {
    // Codex CLI accepts a prompt arg; system prompt is folded into user prompt
    // because flag support varies across versions.
    const combined = `${systemPrompt}\n\n${userPrompt}`;
    return spawnCli("codex", ["exec", combined], { timeoutMs });
  }
  if (engine === "opencode") {
    const combined = `${systemPrompt}\n\n${userPrompt}`;
    return spawnCli("opencode", ["run", combined], { timeoutMs });
  }
  if (engine === "echo-test") {
    // Test hook: returns the user prompt verbatim. Useful for unit tests
    // without needing an actual model installed.
    return Promise.resolve(userPrompt);
  }
  throw new Error(`Unknown engine: ${engine}`);
}

function spawnCli(file, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(file, args, {
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(new Error(`engine ${file} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`engine ${file} failed to launch: ${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const tail = stderr.slice(-200) || stdout.slice(-200);
        reject(new Error(`engine ${file} exited ${code}: ${tail}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function isEngineAvailable(engine) {
  if (engine === "deterministic") return true;
  if (engine === "echo-test") return true;
  const file = engine === "claude-code" || engine === "claude" ? "claude" : engine;
  return new Promise((resolve) => {
    const child = spawn(file, ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
