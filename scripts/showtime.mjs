#!/usr/bin/env node
// PatchMarket showtime orchestrator.
//
// Default behavior (browser-driven demo):
//   1. server  (node bin/patchmarket.mjs demo) on PORT (default 3000)
//   2. worker  (node bin/patchmarket-worker.mjs)  — long-running, polls forever
//   Open http://localhost:3000/?demo=1 — the spectator UI auto-fires the
//   buyer for you. Hit Ctrl+C in the terminal when done.
//
// With --with-buyer (CLI-driven demo):
//   3. buyer   (node bin/patchmarket-buyer.mjs --mode auto --quiet)
//   The terminal log itself becomes the demo. Server + worker exit when
//   the buyer completes.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 3000);
const baseUrl = `http://127.0.0.1:${port}`;
const withBuyer = process.argv.includes("--with-buyer");

const processes = [];
let shuttingDown = false;
let exitCode = 0;

const note = (line) => console.log(`\x1b[90m[showtime]\x1b[0m ${line}`);

note("starting PatchMarket showtime");
note(`spectator: ${baseUrl}/?demo=1`);
if (!withBuyer) {
  note("open the spectator URL — auto-runs the live buyer in the browser");
} else {
  note("--with-buyer: CLI buyer will drive the demo; spectator URL is read-only");
}

const server = launch("server", "node", [path.join(rootDir, "bin", "patchmarket.mjs"), "demo"], "\x1b[36m");
processes.push(server);

await waitForServer(baseUrl, 10_000).catch((error) => {
  note(`server did not become ready: ${error.message}`);
  shutdown(1);
});

const workerArgs = [path.join(rootDir, "bin", "patchmarket-worker.mjs"), "--base-url", baseUrl];
if (withBuyer) workerArgs.push("--once");
const worker = launch("worker", "node", workerArgs, "\x1b[33m");
processes.push(worker);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => killAll());

if (!withBuyer) {
  note("ready. open the spectator URL to start a run, Ctrl+C to stop.");
  await new Promise(() => {});
}

await delay(400);

const buyer = launch(
  "buyer",
  "node",
  [
    path.join(rootDir, "bin", "patchmarket-buyer.mjs"),
    "--base-url",
    baseUrl,
    "--mode",
    "auto",
    "--quiet"
  ],
  "\x1b[35m"
);
processes.push(buyer);

await new Promise((resolve) => {
  buyer.on("exit", (code) => {
    note(`buyer exited (${code ?? "?"})`);
    if (code && code !== 0) exitCode = code;
    resolve();
  });
});

note("buyer finished — cleaning up server + worker");
shutdown(exitCode);

function launch(label, command, args, color) {
  const reset = "\x1b[0m";
  const child = spawn(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const prefix = `${color}[${label}]${reset}`;
  const print = (chunk) => {
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      console.log(`${prefix} ${line}`);
    }
  };

  child.stdout.on("data", print);
  child.stderr.on("data", print);
  child.on("error", (error) => {
    note(`${label} error: ${error.message}`);
  });

  return child;
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/v1/jobs/current`, {
        signal: AbortSignal.timeout(500)
      });
      if (response.ok) {
        note("server is ready");
        return;
      }
    } catch {
      // not yet ready, retry
    }
    await delay(250);
  }
  throw new Error("timeout waiting for server");
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  killAll();
  setTimeout(() => process.exit(exitCode), 800).unref();
}

function killAll() {
  for (const child of processes) {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
  setTimeout(() => {
    for (const child of processes) {
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }
  }, 1500).unref();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
