import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendEvent,
  appendBuyerEvent,
  createDemoJob,
  demoBrokenAuthSource,
  demoPatchedAuthSource,
  issueAgentCaptcha,
  issuePaymentOffer,
  prepareOffers,
  publicJob,
  selectOffer,
  submitPatch,
  validateAgentCaptchaSolution,
  validatePaymentProof
} from "./core.mjs";
import { applyUnifiedPatch, verifyPatchWithRunner } from "./verifier.mjs";
import { runBuyer } from "./buyer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

let currentJob = createDemoJob();
let currentOrigin = "http://127.0.0.1:3000";
let activeBuyerRun = null;
let lastBuyerRun = {
  status: "idle",
  mode: null,
  model: null,
  error: null,
  summary: null,
  startedAt: null,
  finishedAt: null
};

export async function startServer({ port = 3000, host = "127.0.0.1" } = {}) {
  const server = http.createServer(handleRequest);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (typeof address === "object" && address) {
    currentOrigin = `http://${host}:${address.port}`;
  }
  return server;
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/v1/jobs/current" && req.method === "GET") {
      return json(res, 200, { job: publicJob(currentJob) });
    }

    if (url.pathname === "/v1/demo/run-state" && req.method === "GET") {
      return json(res, 200, { run: lastBuyerRun });
    }

    if (url.pathname === "/v1/demo/run" && req.method === "POST") {
      if (activeBuyerRun) {
        return json(res, 409, {
          error: {
            code: "demo.run_in_progress",
            message: "A live buyer run is already in progress.",
            cause: "PatchMarket only runs one buyer flow at a time in this demo server.",
            fix: "Wait for the current run to finish or reset the demo after it completes.",
            retryable: true
          },
          run: lastBuyerRun
        });
      }

      const body = await readJson(req);
      startBuyerRun({
        mode: body.mode || "openai",
        model: body.model || undefined
      });
      return json(res, 202, { run: lastBuyerRun });
    }

    if (url.pathname === "/v1/jobs/reset" && req.method === "POST") {
      await restoreWorkspaceFixture();
      currentJob = createDemoJob();
      if (!activeBuyerRun) {
        lastBuyerRun = {
          status: "idle",
          mode: null,
          model: null,
          error: null,
          summary: null,
          startedAt: null,
          finishedAt: null
        };
      }
      return json(res, 200, { job: publicJob(currentJob), workspace: { state: "baseline" } });
    }

    if (url.pathname === "/v1/jobs/fix" && req.method === "POST") {
      currentJob = createDemoJob();
      const { offers, recommended } = prepareOffers(currentJob);
      return json(res, 201, { job: publicJob(currentJob), offers, recommended });
    }

    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)(?:\/([^/]+))?$/);
    if (jobMatch) {
      const [, jobId, action] = jobMatch;
      if (jobId !== currentJob.id) {
        return json(res, 404, {
          error: {
            code: "job.not_found",
            message: "Job not found.",
            cause: `No active job with id ${jobId}.`,
            fix: "Create a fresh job with POST /v1/jobs/fix.",
            retryable: true
          }
        });
      }

      if (!action && req.method === "GET") {
        return json(res, 200, { job: publicJob(currentJob) });
      }

      if (action === "offers" && req.method === "GET") {
        const { offers, recommended } = prepareOffers(currentJob);
        return json(res, 200, { offers, recommended, selected: currentJob.selectedOffer });
      }

      if (action === "select" && req.method === "POST") {
        const body = await readJson(req);
        const selected = selectOffer(currentJob, body.workerId, {
          actor: body.actor || "buyer-agent",
          rationale: body.rationale || null
        });
        return json(res, 200, { selected, job: publicJob(currentJob) });
      }

      if (action === "buyer-events" && req.method === "POST") {
        const body = await readJson(req);
        const rawEvents = Array.isArray(body.events) ? body.events : [body];
        const events = rawEvents.filter((event) => event && (event.title || event.detail || event.type));
        events.forEach((event) => appendBuyerEvent(currentJob, event));
        return json(res, 200, { appended: events.length, job: publicJob(currentJob) });
      }

      if (action === "claim" && req.method === "POST") {
        const auth = req.headers.authorization;
        if (!auth) {
          const offer = issuePaymentOffer(currentJob);
          res.setHeader("WWW-Authenticate", `L402 invoiceHash="${offer.invoiceHash}", amountSats="${offer.amountSats}"`);
          return json(res, 402, {
            error: {
              code: "payment.required",
              message: "402 Payment Required.",
              cause: "Worker claim requires L402 payment proof.",
              fix: "Retry this same endpoint with Authorization: L402 proof=..., nonce=..., invoiceHash=...",
              retryable: true
            },
            paymentOffer: offer
          });
        }

        validatePaymentProof(currentJob, auth);
        const captcha = issueAgentCaptcha(currentJob);
        return json(res, 200, { captcha, job: publicJob(currentJob) });
      }

      if (action === "captcha" && req.method === "POST") {
        const body = await readJson(req);
        const credential = validateAgentCaptchaSolution(currentJob, body);
        return json(res, 200, { claim: credential, job: publicJob(currentJob) });
      }

      if (action === "patch" && req.method === "POST") {
        const body = await readJson(req);
        const patch = submitPatch(currentJob, body.claimCredential || currentJob.claimCredential);
        return json(res, 200, { patch, job: publicJob(currentJob) });
      }

      if (action === "verify" && req.method === "POST") {
        const proof = await verifyPatchWithRunner(currentJob, { rootDir });
        return json(res, 200, { proof, job: publicJob(currentJob) });
      }

      if (action === "apply" && req.method === "POST") {
        const workspace = await applyPatchToWorkspace(currentJob);
        return json(res, 200, { workspace, job: publicJob(currentJob) });
      }

      if (action === "events" && req.method === "GET") {
        const cursor = Number(url.searchParams.get("cursor") || 0);
        const events = currentJob.events.slice(cursor);
        return json(res, 200, {
          events,
          nextCursor: cursor + events.length,
          state: currentJob.state
        });
      }
    }

    if (url.pathname.startsWith("/v1/")) {
      return json(res, 404, {
        error: {
          code: "route.not_found",
          message: "Route not found.",
          cause: `${req.method} ${url.pathname} is not a PatchMarket demo route.`,
          fix: "Use POST /v1/jobs/fix to start the protocol demo.",
          retryable: false
        }
      });
    }

    await serveStatic(req, res, url);
  } catch (error) {
    if (error.patchMarket) {
      return json(res, 400, { error: error.patchMarket });
    }

    console.error(error);
    return json(res, 500, {
      error: {
        code: "server.internal",
        message: "Internal server error.",
        cause: error.message,
        fix: "Restart the demo server and use the deterministic path.",
        retryable: true
      }
    });
  }
}

function startBuyerRun({ mode = "openai", model } = {}) {
  lastBuyerRun = {
    status: "running",
    mode,
    model: model || null,
    error: null,
    summary: null,
    startedAt: new Date().toISOString(),
    finishedAt: null
  };

  activeBuyerRun = runBuyer({
    baseUrl: currentOrigin,
    mode,
    model,
    log: () => {}
  })
    .then((summary) => {
      lastBuyerRun = {
        ...lastBuyerRun,
        status: "completed",
        summary,
        error: null,
        finishedAt: new Date().toISOString()
      };
    })
    .catch((error) => {
      lastBuyerRun = {
        ...lastBuyerRun,
        status: "failed",
        error: error.message,
        finishedAt: new Date().toISOString()
      };
    })
    .finally(() => {
      activeBuyerRun = null;
    });
}

async function restoreWorkspaceFixture() {
  await fs.writeFile(workspaceFixtureFile(), demoBrokenAuthSource, "utf8");
}

async function applyPatchToWorkspace(job) {
  if (!job.patchSubmission || !job.verificationProof || job.state !== "released") {
    throw new Error("Workspace apply requires a released verified patch.");
  }

  const fixtureFile = workspaceFixtureFile();
  const currentSource = await fs.readFile(fixtureFile, "utf8");
  if (currentSource === demoPatchedAuthSource) {
    return {
      state: "already_applied",
      path: "fixtures/red-ci/src/auth.mjs"
    };
  }

  if (currentSource !== demoBrokenAuthSource) {
    throw new Error("Workspace fixture is not at the expected red baseline.");
  }

  await applyUnifiedPatch(workspaceFixtureDir(), job.patchSubmission.patch, job.fixture.allowedPatchPaths);
  appendEvent(job, {
    type: "workspace.applied",
    title: "Patch applied to workspace",
    detail: "fixtures/red-ci/src/auth.mjs now matches the purchased patch for git diff review.",
    panel: "proof",
    data: {
      path: "fixtures/red-ci/src/auth.mjs",
      patchHash: job.patchSubmission.patchHash
    }
  });

  return {
    state: "applied",
    path: "fixtures/red-ci/src/auth.mjs"
  };
}

function workspaceFixtureDir() {
  return path.join(rootDir, "fixtures", "red-ci");
}

function workspaceFixtureFile() {
  return path.join(workspaceFixtureDir(), "src", "auth.mjs");
}

function prepareOffersForRead() {
  return currentJob.marketOffers || currentJob.events.find((event) => event.type === "worker.scored")?.data.offers || [];
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body, null, 2));
}

async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";

    res.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store"
    });
    res.end(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}
