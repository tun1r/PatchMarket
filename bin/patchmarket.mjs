#!/usr/bin/env node
import { startServer } from "../src/server.mjs";

const command = process.argv[2] || "demo";
const port = Number(process.env.PORT || 3000);

if (command === "demo" || command === "start") {
  const server = await startServer({ port });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  console.log("PatchMarket demo running");
  console.log(`UI: http://localhost:${actualPort}`);
  console.log("Fixture: red-ci");
  console.log("Payment mode: simulated");
  console.log("Replay: 402 -> L402 proof -> agent CAPTCHA -> patch -> verify -> release");
  console.log("Live buyer: npm run buyer -- --mode auto --json");
  console.log("");
  console.log("Try:");
  console.log(`  curl -s -X POST http://localhost:${actualPort}/v1/jobs/fix | jq`);
  console.log("");
  console.log("Press Ctrl+C to stop.");
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: patchmarket demo");
  process.exit(1);
}
