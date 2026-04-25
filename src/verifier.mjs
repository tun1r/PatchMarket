import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashText,
  patchMarketError,
  transition,
  validatePatch,
  verifyPatch
} from "./core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(__dirname, "..");

export async function verifyPatchWithRunner(job, { rootDir = defaultRootDir } = {}) {
  if (!job.patchSubmission) {
    throw patchMarketError({
      code: "verification.patch_missing",
      message: "No patch submitted.",
      cause: "The verifier cannot run before a worker submits a patch.",
      fix: "Submit a patch before calling the verification endpoint.",
      retryable: true
    });
  }

  if (job.state === "submitted") {
    transition(job, "verifying", "Verifier copied fixture and started immutable command.", "verifier");
  }

  const fixtureDir = path.join(rootDir, "fixtures", job.fixture.id);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "patchmarket-verify-"));
  await fs.cp(fixtureDir, workDir, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`)
  });

  const before = await runAcceptance(workDir, job.fixture);
  if (before.exitCode === 0) {
    await failVerification(job, "verification.precondition_green", "Fixture was already green before patch.");
  }

  await applyUnifiedPatch(workDir, job.patchSubmission.patch, job.fixture.allowedPatchPaths);
  const after = await runAcceptance(workDir, job.fixture);
  if (after.exitCode !== 0) {
    await failVerification(job, "verification.test_failed", "Acceptance command still failed after patch.");
  }

  return verifyPatch(job, {
    beforeLog: before.log,
    afterLog: after.log,
    exitCodeBefore: before.exitCode,
    exitCodeAfter: after.exitCode,
    verifierVersion: "patchmarket-live-verifier@0.1.0",
    executionMode: "temp-worktree-runner",
    worktreeHash: await hashAllowedFiles(workDir, job.fixture.allowedPatchPaths)
  });
}

export async function applyUnifiedPatch(workDir, patch, allowedPaths) {
  const validation = validatePatch(patch, allowedPaths);
  if (!validation.ok) throw validation.error;

  const sections = patch.split(/^diff --git /m).filter(Boolean);
  for (const section of sections) {
    const header = section.match(/^a\/(.+?) b\/(.+?)\n/);
    if (!header) continue;

    const [, fromPath, toPath] = header;
    if (fromPath !== toPath || !allowedPaths.includes(fromPath)) {
      throw patchMarketError({
        code: "patch.path_not_allowed",
        message: "Patch path is outside allowed scope.",
        cause: `Patch touched ${fromPath} -> ${toPath}.`,
        fix: `Only modify: ${allowedPaths.join(", ")}`,
        retryable: true
      });
    }

    const target = safeJoin(workDir, toPath);
    const original = await fs.readFile(target, "utf8");
    const patched = applySection(original, section);
    await fs.writeFile(target, patched);
  }
}

function applySection(original, section) {
  const lines = section.split("\n");
  let content = original;

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("@@")) continue;

    const oldLines = [];
    const newLines = [];
    index += 1;
    while (index < lines.length && !lines[index].startsWith("@@")) {
      const line = lines[index];
      if (line.startsWith("diff --git ")) break;
      if (line === "\\ No newline at end of file") {
        index += 1;
        continue;
      }
      const marker = line[0];
      const value = line.slice(1);
      if (marker === " " || marker === "-") oldLines.push(value);
      if (marker === " " || marker === "+") newLines.push(value);
      index += 1;
    }
    index -= 1;

    const before = `${oldLines.join("\n")}\n`;
    const after = `${newLines.join("\n")}\n`;
    if (!content.includes(before)) {
      throw patchMarketError({
        code: "patch.apply_failed",
        message: "Patch hunk did not match the clean fixture.",
        cause: "The submitted diff could not be applied to the verifier worktree.",
        fix: "Submit a patch generated against the advertised repo hash.",
        retryable: true
      });
    }
    content = content.replace(before, after);
  }

  return content;
}

function runAcceptance(workDir, fixture) {
  const command = acceptanceCommand(fixture.acceptanceCommand);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, {
      cwd: workDir,
      env: verifierEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, fixture.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        signal,
        durationMs: Date.now() - startedAt,
        log: normalizeLog(`${stdout}${stderr}`)
      });
    });
  });
}

function verifierEnv() {
  const env = { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST")) {
      delete env[key];
    }
  }
  return env;
}

function acceptanceCommand(command) {
  if (command === "node --test --test-reporter=tap tests/auth.test.mjs") {
    return {
      file: process.execPath,
      args: ["--test", "--test-reporter=tap", "tests/auth.test.mjs"]
    };
  }

  throw patchMarketError({
    code: "verification.command_unsupported",
    message: "Acceptance command is not supported by the demo verifier.",
    cause: `Unsupported command: ${command}`,
    fix: "Use a fixture with a pinned verifier command.",
    retryable: false
  });
}

async function hashAllowedFiles(workDir, allowedPaths) {
  const hash = crypto.createHash("sha256");
  for (const allowedPath of [...allowedPaths].sort()) {
    hash.update(allowedPath);
    hash.update(await fs.readFile(safeJoin(workDir, allowedPath)));
  }
  return hash.digest("hex");
}

function safeJoin(root, relativePath) {
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw patchMarketError({
      code: "path.outside_worktree",
      message: "Path escapes verifier worktree.",
      cause: `Rejected path: ${relativePath}`,
      fix: "Use repo-relative patch paths only.",
      retryable: false
    });
  }
  return target;
}

async function failVerification(job, code, cause) {
  if (job.state === "verifying") {
    transition(job, "verification_failed", cause, "verifier");
  }
  throw patchMarketError({
    code,
    message: "Verifier rejected patch.",
    cause,
    fix: "Submit a patch that turns the advertised red test green.",
    retryable: true
  });
}

function normalizeLog(value) {
  return value
    .replaceAll(process.cwd(), "$PWD")
    .replace(/\(\d+(?:\.\d+)?ms\)/g, "(TIMING)")
    .replace(/duration_ms \d+(?:\.\d+)?/g, "duration_ms TIMING")
    .trim();
}
