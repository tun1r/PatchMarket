#!/usr/bin/env node
// PatchMarket worker daemon — visible second agent on stage.
//
// Polls /v1/jobs/current. When the buyer has paid, solved CAPTCHA, and
// the job is in `claimed` state with this worker selected, the daemon
// emits worker.online → worker.claiming → worker.patching, submits the
// existing deterministic patch via POST /v1/jobs/:id/patch, then emits
// worker.submitted → worker.awaiting_release.
//
// The patch content is server-side and stays canned. The visible
// substance is that this is a separate process with its own pid emitting
// its own event stream into the trace.

import process from "node:process";
import { generateLivePatch, isEngineAvailable } from "../src/live-worker-engine.mjs";

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args.baseUrl || process.env.PATCHMARKET_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const workerId = args.workerId || "patchpro";
const workerPid = process.pid;
const log = args.quiet ? () => {} : (line) => console.log(`[worker] ${line}`);
const pace = args.pace || "normal";
const paceMs = pace === "fast" ? { online: 200, claim: 300, patch: 400 } : { online: 600, claim: 800, patch: 1200 };
const pollMs = args.pollMs || 700;
const maxIdleMs = args.maxIdleMs || 90_000;
const engine = args.engine || process.env.PATCHMARKET_WORKER_ENGINE || "deterministic";

let onlineForJobId = null;
let lastSubmittedJobId = null;
let lastSubmittedReleased = false;
let startedAt = Date.now();

log(`${workerId} polling ${baseUrl} (pid ${workerPid})`);

while (true) {
  try {
    const job = await fetchJob();
    if (!job) {
      await sleep(pollMs);
      continue;
    }

    // Re-announce online for each fresh job id (buyer's `/v1/jobs/fix` swaps
    // currentJob, so an online event posted to the previous baseline gets
    // discarded). The first announcement for a given job id is the one the
    // spectator UI actually renders. We do NOT gate on state because a fast
    // scripted buyer can transition past `posted` between worker polls.
    if (onlineForJobId !== job.id) {
      await announceOnline(job);
      onlineForJobId = job.id;
    }

    const isMine = job.selectedOffer?.workerId === workerId;

    if (isMine && job.state === "claimed" && job.id !== lastSubmittedJobId) {
      await fulfillJob(job);
      lastSubmittedJobId = job.id;
      lastSubmittedReleased = false;
    }

    if (lastSubmittedJobId === job.id && job.state === "released" && !lastSubmittedReleased) {
      await postEvent(job, {
        type: "worker.awaiting_release",
        title: "Escrow released",
        detail: `${job.reputationEvent?.deltaEarnedSats || job.selectedOffer?.priceSats || 0} sats received. Verifier proof signed.`
      });
      lastSubmittedReleased = true;
      log(`released for job ${job.id}, ${job.reputationEvent?.deltaEarnedSats} sats`);

      if (args.once) {
        log("--once flag set, exiting after release");
        process.exit(0);
      }
    }

    if (Date.now() - startedAt > maxIdleMs && !lastSubmittedJobId) {
      log(`idle for ${Math.round(maxIdleMs / 1000)}s, exiting`);
      process.exit(0);
    }

    await sleep(pollMs);
  } catch (error) {
    log(`error: ${error.message}`);
    await sleep(pollMs * 2);
  }
}

async function announceOnline(job) {
  startedAt = Date.now();
  log(`${workerId} online for job ${job.id}`);
  await postEvent(job, {
    type: "worker.online",
    title: `${workerId} online`,
    detail: `Worker daemon (pid ${workerPid}) is listening for claim assignments.`,
    data: { workerId, pid: workerPid, baseUrl }
  });
}

async function fulfillJob(job) {
  log(`claiming job ${job.id}`);
  await sleep(paceMs.online);

  await postEvent(job, {
    type: "worker.claiming",
    title: `${workerId} claiming job`,
    detail: `Buyer cleared 402, solved Agent CAPTCHA, and granted a claim credential.`,
    data: { workerId, jobId: job.id }
  });
  await sleep(paceMs.claim);

  await postEvent(job, {
    type: "worker.patching",
    title: `${workerId} preparing patch`,
    detail:
      engine === "deterministic"
        ? `Reading allowed scope ${job.fixture.allowedPatchPaths.join(", ")}, using deterministic patch.`
        : `Reading allowed scope ${job.fixture.allowedPatchPaths.join(", ")}, invoking ${engine}.`,
    data: { allowedPatchPaths: job.fixture.allowedPatchPaths, engine }
  });
  await sleep(paceMs.patch);

  let patchOptions = null;
  if (engine !== "deterministic") {
    try {
      const generated = await generateLivePatch({
        engine,
        allowedPaths: job.fixture.allowedPatchPaths,
        failingLog: job.fixture.beforeLog,
        log
      });
      patchOptions = {
        patch: generated.patch,
        engine: generated.engine,
        attempts: generated.attempts,
        latencyMs: generated.latencyMs,
        source: "live-engine"
      };
      await postEvent(job, {
        type: "worker.engine_used",
        title: `${workerId} generated patch via ${engine}`,
        detail: `${engine} returned a valid unified diff in ${generated.latencyMs}ms (${generated.attempts} attempt${generated.attempts === 1 ? "" : "s"}).`,
        data: {
          engine: generated.engine,
          attempts: generated.attempts,
          latencyMs: generated.latencyMs
        }
      });
    } catch (error) {
      log(`engine ${engine} failed: ${error.message} — falling back to deterministic`);
      await postEvent(job, {
        type: "worker.engine_fallback",
        title: `${workerId} engine fallback`,
        detail: `${engine} failed: ${error.message}. Using deterministic patch.`,
        data: { engine, attempts: error.attempts || null, error: error.message }
      });
    }
  }

  log(`submitting patch for job ${job.id} (source=${patchOptions ? "live" : "deterministic"})`);
  const submission = await submitPatch(job, patchOptions);

  await postEvent(job, {
    type: "worker.submitted",
    title: `${workerId} submitted patch`,
    detail: `Patch hash ${shortHash(submission?.patch?.patchHash)}. Awaiting verifier.`,
    data: { workerId, patchHash: submission?.patch?.patchHash || null }
  });
}

async function fetchJob() {
  const response = await fetch(`${baseUrl}/v1/jobs/current`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`GET /v1/jobs/current → ${response.status}`);
  }
  const body = await response.json();
  return body.job || null;
}

async function postEvent(job, event) {
  const response = await fetch(`${baseUrl}/v1/jobs/${job.id}/worker-events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event)
  });
  if (!response.ok && response.status !== 400) {
    log(`POST worker-events → ${response.status}`);
  }
}

async function submitPatch(job, options = null) {
  if (!job.claimCredential) {
    throw new Error("Job has no claim credential yet");
  }
  const payload = { claimCredential: job.claimCredential };
  if (options?.patch) {
    payload.patch = options.patch;
    payload.engine = options.engine;
    payload.attempts = options.attempts;
    payload.latencyMs = options.latencyMs;
    payload.source = options.source || "live-engine";
  }
  const response = await fetch(`${baseUrl}/v1/jobs/${job.id}/patch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body.error?.message || `POST /patch → ${response.status}`);
  }
  return body;
}

function shortHash(value) {
  if (!value) return "(pending)";
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const parsed = { quiet: false, once: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--worker-id") parsed.workerId = argv[++i];
    else if (arg === "--base-url") parsed.baseUrl = argv[++i];
    else if (arg === "--pace") parsed.pace = argv[++i];
    else if (arg === "--poll-ms") parsed.pollMs = Number(argv[++i]);
    else if (arg === "--max-idle-ms") parsed.maxIdleMs = Number(argv[++i]);
    else if (arg === "--engine") parsed.engine = argv[++i];
    else if (arg === "--quiet") parsed.quiet = true;
    else if (arg === "--once") parsed.once = true;
    else if (arg === "--help") {
      console.log(
        "Usage: patchmarket-worker [--worker-id ID] [--base-url URL] [--pace fast|normal] [--engine deterministic|claude-code|codex|opencode] [--poll-ms N] [--quiet] [--once]"
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
