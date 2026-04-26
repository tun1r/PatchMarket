import { resolveBuyerApiKey, runBuyer } from "../src/buyer.mjs";
import { startServer } from "../src/server.mjs";

const apiKey = await resolveBuyerApiKey(process.cwd());
if (!apiKey) {
  console.log(
    JSON.stringify(
      {
        skipped: true,
        reason: "OPENAI_API_KEY not configured. Live smoke skipped."
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

try {
  const summary = await runBuyer({
    baseUrl,
    mode: "openai",
    apiKey,
    log: () => {}
  });

  if (summary.mode !== "openai") {
    throw new Error("Live smoke fell back to scripted mode.");
  }

  if (summary.finalState !== "released") {
    throw new Error(`Live smoke did not release escrow. Final state: ${summary.finalState}`);
  }

  const output = {
    mode: summary.mode,
    model: summary.model,
    jobId: summary.jobId,
    selectedWorker: summary.selectedWorker,
    finalState: summary.finalState,
    exit: `${summary.exitCodeBefore} -> ${summary.exitCodeAfter}`,
    executionMode: summary.executionMode,
    releasedSats: summary.releasedSats
  };

  console.log(JSON.stringify(output, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
