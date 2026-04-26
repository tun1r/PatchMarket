#!/usr/bin/env node
import { runBuyer } from "../src/buyer.mjs";

const args = parseArgs(process.argv.slice(2));

try {
  const summary = await runBuyer({
    baseUrl: args.baseUrl,
    mode: args.mode,
    model: args.model,
    log: args.quiet ? () => {} : console.log
  });

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("PatchMarket buyer completed");
    console.log(`mode: ${summary.mode}`);
    if (summary.model) console.log(`model: ${summary.model}`);
    console.log(`job: ${summary.jobId}`);
    console.log(`worker: ${summary.selectedWorker}`);
    console.log(`state: ${summary.finalState}`);
    console.log(`exit: ${summary.exitCodeBefore} -> ${summary.exitCodeAfter}`);
    console.log(`released: ${summary.releasedSats} sats`);
    console.log(summary.buyerMessage);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    baseUrl: process.env.PATCHMARKET_BASE_URL || "http://127.0.0.1:3000",
    mode: "auto",
    model: process.env.PATCHMARKET_BUYER_MODEL || "gpt-5.1-codex-mini",
    json: false,
    quiet: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") parsed.baseUrl = argv[++index];
    else if (arg === "--mode") parsed.mode = argv[++index];
    else if (arg === "--model") parsed.model = argv[++index];
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--quiet") parsed.quiet = true;
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log("Usage: patchmarket-buyer [--base-url URL] [--mode auto|openai|scripted] [--model MODEL] [--json] [--quiet]");
}
