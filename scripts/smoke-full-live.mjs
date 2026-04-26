// Full-live smoke: buyer-via-OpenAI + worker-via-Claude-Code + real verifier
// + escrow release. Asserts both agents are live and no fallback fired.
//
// Skips gracefully when:
//   - OPENAI_API_KEY is not set (buyer can't run live)
//   - the `claude` CLI is not on PATH (worker can't run live)
//
// This is the strongest smoke we have; it exercises every real path.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuyerApiKey, runBuyer } from "../src/buyer.mjs";
import { isEngineAvailable } from "../src/live-worker-engine.mjs";
import { startServer } from "../src/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const ENGINE = process.env.PATCHMARKET_WORKER_ENGINE || "claude-code";

const apiKey = await resolveBuyerApiKey(rootDir);
if (!apiKey) {
  console.log(
    JSON.stringify(
      { skipped: true, reason: "OPENAI_API_KEY not configured. Full-live smoke skipped." },
      null,
      2
    )
  );
  process.exit(0);
}

const engineAvailable = await isEngineAvailable(ENGINE);
if (!engineAvailable) {
  console.log(
    JSON.stringify(
      {
        skipped: true,
        reason: `Worker engine "${ENGINE}" not available on PATH. Full-live smoke skipped.`
      },
      null,
      2
    )
  );
  process.exit(0);
}

const server = await startServer({ port: 0 });
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

const worker = spawn(
  "node",
  [
    path.join(rootDir, "bin", "patchmarket-worker.mjs"),
    "--base-url",
    baseUrl,
    "--once",
    "--pace",
    "fast",
    "--engine",
    ENGINE,
    "--quiet"
  ],
  { stdio: ["ignore", "inherit", "inherit"] }
);

let workerExitCode = null;
worker.on("exit", (code) => {
  workerExitCode = code;
});

const failures = [];
let summary = null;

try {
  summary = await runBuyer({
    baseUrl,
    mode: "openai",
    apiKey,
    rootDir,
    log: (line) => console.error(`[buyer] ${line}`)
  });

  if (summary.mode !== "openai") {
    failures.push(`buyer fell back: mode=${summary.mode}`);
  }
  if (summary.finalState !== "released") {
    failures.push(`escrow did not release: state=${summary.finalState}`);
  }

  // Pull the job to confirm the worker engine actually fired.
  const response = await fetch(`${baseUrl}/v1/jobs/current`);
  const body = await response.json();
  const job = body.job;
  const submission = job?.patchSubmission || {};
  const usedFallback = job?.events?.find((e) => e.type === "worker.engine_fallback");

  if (submission.source !== "live-engine") {
    failures.push(
      `patch source !== live-engine (got "${submission.source}"); ${usedFallback ? "fallback fired" : "buyer probably submitted"}`
    );
  }
  if (submission.engine !== ENGINE) {
    failures.push(`patch engine !== ${ENGINE} (got "${submission.engine}")`);
  }
  if (usedFallback) {
    failures.push(`worker.engine_fallback fired: ${usedFallback.detail}`);
  }

  const out = {
    ok: failures.length === 0,
    buyer: {
      mode: summary.mode,
      model: summary.model,
      jobId: summary.jobId,
      finalState: summary.finalState,
      releasedSats: summary.releasedSats,
      exit: `${summary.exitCodeBefore} -> ${summary.exitCodeAfter}`
    },
    worker: {
      engine: submission.engine,
      attempts: submission.attempts,
      latencyMs: submission.latencyMs,
      source: submission.source,
      patchHash: submission.patchHash?.slice(0, 16) + "…"
    },
    verifier: {
      executionMode: summary.executionMode,
      result: job?.verificationProof?.result
    },
    failures
  };

  console.log(JSON.stringify(out, null, 2));
} finally {
  // Clean up worker if it's still running.
  if (workerExitCode === null) {
    try {
      worker.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  await new Promise((resolve) => server.close(resolve));
}

if (failures.length > 0) {
  process.exit(1);
}
