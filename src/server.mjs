import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDemoJob,
  issueAgentCaptcha,
  issuePaymentOffer,
  prepareOffers,
  publicJob,
  submitPatch,
  validateAgentCaptchaSolution,
  validatePaymentProof
} from "./core.mjs";
import { verifyPatchWithRunner } from "./verifier.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

let currentJob = createDemoJob();

export async function startServer({ port = 3000, host = "127.0.0.1" } = {}) {
  const server = http.createServer(handleRequest);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return server;
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/v1/jobs/fix" && req.method === "POST") {
      currentJob = createDemoJob();
      const { offers, selected } = prepareOffers(currentJob);
      return json(res, 201, { job: publicJob(currentJob), offers, selected });
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
        const { offers, selected } = currentJob.selectedOffer
          ? { offers: prepareOffersForRead(), selected: currentJob.selectedOffer }
          : prepareOffers(currentJob);
        return json(res, 200, { offers, selected });
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

function prepareOffersForRead() {
  return currentJob.events.find((event) => event.type === "worker.scored")?.data.offers || [];
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
