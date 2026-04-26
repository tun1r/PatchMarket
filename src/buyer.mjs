import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { solveAgentCaptchaChallenge } from "./core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(__dirname, "..");
const defaultBaseUrl = process.env.PATCHMARKET_BASE_URL || "http://127.0.0.1:3000";
const defaultModel = process.env.PATCHMARKET_BUYER_MODEL || "gpt-5.1-codex-mini";
const fixtureCommand = "node --test --test-reporter=tap tests/auth.test.mjs";

export async function runBuyer({
  baseUrl = defaultBaseUrl,
  mode = "auto",
  model = defaultModel,
  apiKey = process.env.OPENAI_API_KEY || "",
  rootDir = defaultRootDir,
  log = console.log
} = {}) {
  const resolvedApiKey = apiKey || (await resolveBuyerApiKey(rootDir));
  const runtime = {
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    apiKey: resolvedApiKey,
    rootDir,
    log,
    mode: resolveBuyerMode(mode, resolvedApiKey),
    ciResult: null,
    job: null,
    paymentOffer: null,
    captcha: null,
    claim: null
  };

  runtime.ciResult = await inspectRedCi(runtime);
  if (runtime.ciResult.exitCode === 0) {
    throw new Error("Fixture is already green. Buyer demo requires a red starting point.");
  }

  if (runtime.mode === "openai") {
    try {
      return await runOpenAiBuyer(runtime);
    } catch (error) {
      runtime.log(`OpenAI buyer failed, falling back to scripted mode: ${error.message}`);
      runtime.mode = "scripted";
    }
  }

  return runScriptedBuyer(runtime);
}

export async function resolveBuyerApiKey(rootDir = defaultRootDir) {
  return process.env.OPENAI_API_KEY || (await readLocalSecret(rootDir, "OPENAI_API_KEY"));
}

function resolveBuyerMode(mode, apiKey) {
  if (mode === "openai" || mode === "scripted") return mode;
  return apiKey ? "openai" : "scripted";
}

async function readLocalSecret(rootDir, key) {
  for (const candidate of [".env", ".env.local"]) {
    const filePath = path.join(rootDir, candidate);
    let raw;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(new RegExp(`^${key}\\s*(?:=|:)\\s*(.+)$`));
      if (!match) continue;
      return match[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return "";
}

async function runScriptedBuyer(runtime) {
  const created = await createPatchmarketJob(runtime);
  await postBuyerEvent(runtime, {
    type: "buyer.connected",
    title: "Buyer agent connected",
    detail: `Scripted buyer confirmed red CI exit code ${runtime.ciResult.exitCode} and opened the market.`
  });
  await postBuyerEvent(runtime, {
    title: "Evaluating offers",
    detail: `Recommended worker is ${created.recommended.name} at ${created.recommended.priceSats} sats with ${Math.round(created.recommended.passRate * 100)}% pass rate.`
  });
  await selectWorker(runtime, created.recommended.workerId, {
    rationale: `Selected ${created.recommended.name} because it keeps pass rate above 90% while minimizing expected cost to green.`
  });
  await requestClaim(runtime);
  await submitL402Proof(runtime);
  await solveCaptcha(runtime);
  await requestPatch(runtime);
  await verifyPatch(runtime);
  return finalSummary(runtime, "Scripted buyer completed the escrow flow.");
}

async function runOpenAiBuyer(runtime) {
  const instructions = [
    "You are PatchMarketBuyer, a terse software outsourcing agent.",
    "Use the provided tools to delegate a red CI fix through PatchMarket.",
    "Always begin by inspecting the red CI fixture, then create a PatchMarket job, inspect offers, and choose a worker.",
    "Prefer the lowest expected cost to green while keeping pass rate at or above 90% when available.",
    "Before each material action, call post_buyer_event with type buyer.reasoning and one short factual update suitable for a judge-facing UI.",
    "Use these buyer event titles when they fit: Inspecting red CI, Opening PatchMarket job, Reviewing offers, Selecting worker, Requesting 402 challenge, Submitting L402 proof, Solving Agent CAPTCHA, Requesting worker patch, Verifying patch, Confirming job state.",
    "Do not expose chain-of-thought. Buyer events must be concise operational rationale, not private reasoning.",
    "After selection, complete the claim flow: 402 challenge, L402 proof, Agent CAPTCHA, patch request, verifier run.",
    "Finish with a short summary mentioning the chosen worker, exit code change, and whether escrow released."
  ].join("\n");

  const tools = buildOpenAiTools();
  let response = await openAiResponseCreate(runtime, {
    model: runtime.model,
    instructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Delegate the red-ci fix through PatchMarket and complete the escrow flow."
          }
        ]
      }
    ],
    tools,
    tool_choice: "required",
    parallel_tool_calls: false,
    max_output_tokens: 500
  });

  let guard = 0;
  while (guard < 40) {
    guard += 1;
    const calls = (response.output || []).filter((item) => item.type === "function_call");
    if (!calls.length) {
      if (runtime.job?.state !== "released") {
        response = await openAiResponseCreate(runtime, {
          model: runtime.model,
          instructions,
          previous_response_id: response.id,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `Continue the PatchMarket job. Current state: ${runtime.job?.state || "unknown"}. Use the next tool needed to reach released.`
                }
              ]
            }
          ],
          tools,
          tool_choice: "required",
          parallel_tool_calls: false,
          max_output_tokens: 500
        });
        continue;
      }
      return finalSummary(runtime, extractResponseText(response) || "OpenAI buyer completed the escrow flow.");
    }

    const toolOutputs = [];
    let shouldRetry = false;
    for (const call of calls) {
      let args;
      try {
        args = parseArgs(call.arguments);
      } catch (error) {
        response = await openAiResponseCreate(runtime, {
          model: runtime.model,
          instructions,
          previous_response_id: response.id,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `The previous tool call for ${call.name} had invalid JSON arguments (${error.message}). Reissue that tool call with a valid JSON object.`
                }
              ]
            }
          ],
          tools,
          tool_choice: "required",
          parallel_tool_calls: false,
          max_output_tokens: 500
        });
        shouldRetry = true;
        break;
      }
      let result;
      try {
        result = await executeBuyerTool(runtime, call.name, args);
      } catch (error) {
        result = {
          ok: false,
          error: error.message
        };
      }
      toolOutputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result)
      });
    }

    if (shouldRetry) continue;

    response = await openAiResponseCreate(runtime, {
      model: runtime.model,
      instructions,
      previous_response_id: response.id,
      input: toolOutputs,
      tools,
      tool_choice: runtime.job?.state === "released" ? "auto" : "required",
      parallel_tool_calls: false,
      max_output_tokens: 500
    });
  }

  throw new Error(`OpenAI buyer exceeded tool-call budget at state ${runtime.job?.state || "unknown"}.`);
}

function buildOpenAiTools() {
  return [
    functionTool("inspect_red_ci", "Inspect the local red CI fixture and return the failing command output.", {}),
    functionTool("create_patchmarket_job", "Create a PatchMarket job for the red CI fixture.", {
      budget_sats: { type: "integer", description: "Maximum sats budget for the job.", minimum: 1 }
    }, ["budget_sats"]),
    functionTool("post_buyer_event", "Append a short buyer-facing update to the PatchMarket UI.", {
      title: { type: "string" },
      detail: { type: "string" },
      type: { type: "string" }
    }, ["title", "detail", "type"]),
    functionTool("list_worker_offers", "Read the currently scored worker offers for the active job.", {}),
    functionTool("select_worker_offer", "Choose one worker offer for the active job.", {
      worker_id: { type: "string" },
      rationale: { type: "string" }
    }, ["worker_id", "rationale"]),
    functionTool("request_claim_challenge", "Hit the protected claim endpoint to receive the 402 challenge.", {}),
    functionTool("submit_l402_proof", "Retry the claim with the issued L402 proof.", {}),
    functionTool("solve_agent_captcha", "Solve the issued Agent CAPTCHA and exchange it for a claim credential.", {}),
    functionTool("request_patch", "Request the worker patch using the issued claim credential.", {}),
    functionTool("verify_patch", "Run the verifier and release escrow if the patch turns red CI green.", {}),
    functionTool("get_job_state", "Read the latest job snapshot for the active job.", {})
  ];
}

function functionTool(name, description, properties, required = []) {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false
    }
  };
}

async function executeBuyerTool(runtime, name, args) {
  if (name === "inspect_red_ci") {
    return {
      fixtureId: "red-ci",
      repo: "fixtures/red-ci",
      command: fixtureCommand,
      exitCode: runtime.ciResult.exitCode,
      log: runtime.ciResult.log,
      allowedPatchPaths: ["src/auth.mjs"],
      budgetHintSats: 4000
    };
  }

  if (name === "create_patchmarket_job") {
    return createPatchmarketJob(runtime, args.budget_sats);
  }

  if (name === "post_buyer_event") {
    await postBuyerEvent(runtime, {
      ...normalizeBuyerEvent(args)
    });
    return { ok: true };
  }

  if (name === "list_worker_offers") {
    ensureActiveJob(runtime, name);
    const offers = await fetchJson(runtime, `/v1/jobs/${runtime.job.id}/offers`);
    runtime.job = offers.job || runtime.job;
    return offers;
  }

  if (name === "select_worker_offer") {
    ensureActiveJob(runtime, name);
    const selected = await selectWorker(runtime, args.worker_id, { rationale: args.rationale });
    return { selected };
  }

  if (name === "request_claim_challenge") {
    ensureActiveJob(runtime, name);
    const claim402 = await requestClaim(runtime);
    return claim402;
  }

  if (name === "submit_l402_proof") {
    ensureActiveJob(runtime, name);
    return submitL402Proof(runtime);
  }

  if (name === "solve_agent_captcha") {
    ensureActiveJob(runtime, name);
    return solveCaptcha(runtime);
  }

  if (name === "request_patch") {
    ensureActiveJob(runtime, name);
    return requestPatch(runtime);
  }

  if (name === "verify_patch") {
    ensureActiveJob(runtime, name);
    return verifyPatch(runtime);
  }

  if (name === "get_job_state") {
    ensureActiveJob(runtime, name);
    return fetchJson(runtime, `/v1/jobs/${runtime.job.id}`);
  }

  throw new Error(`Unknown buyer tool: ${name}`);
}

async function createPatchmarketJob(runtime, budgetSats = 4000) {
  const response = await fetchJson(runtime, "/v1/jobs/fix", {
    method: "POST",
    body: {
      repo: "fixtures/red-ci",
      command: fixtureCommand,
      budget: budgetSats
    }
  });
  runtime.job = response.job;
  if (runtime.mode === "openai") {
    await postBuyerEvent(runtime, {
      type: "buyer.connected",
      title: "Buyer agent connected",
      detail: `OpenAI buyer opened a job after confirming red CI exit code ${runtime.ciResult.exitCode}.`
    });
  }
  return response;
}

async function selectWorker(runtime, workerId, { rationale } = {}) {
  const response = await fetchJson(runtime, `/v1/jobs/${runtime.job.id}/select`, {
    method: "POST",
    body: {
      workerId,
      rationale,
      actor: runtime.mode === "openai" ? "buyer-agent/openai" : "buyer-agent/scripted"
    }
  });
  runtime.job = response.job;
  return response.selected;
}

async function requestClaim(runtime) {
  const response = await fetchJson(runtime, `/v1/jobs/${runtime.job.id}/claim`, {
    method: "POST",
    allowStatus: [402]
  });
  runtime.paymentOffer = response.paymentOffer;
  runtime.job = response.job || runtime.job;
  return response;
}

async function submitL402Proof(runtime) {
  if (!runtime.paymentOffer) {
    throw new Error("Payment offer missing.");
  }

  const auth = `L402 proof="${runtime.paymentOffer.simulatedProof}", nonce="${runtime.paymentOffer.nonce}", invoiceHash="${runtime.paymentOffer.invoiceHash}"`;
  const response = await fetchJson(runtime, `/v1/jobs/${runtime.job.id}/claim`, {
    method: "POST",
    headers: { Authorization: auth }
  });
  runtime.captcha = response.captcha;
  runtime.job = response.job;
  return response;
}

async function solveCaptcha(runtime) {
  if (!runtime.captcha) {
    throw new Error("Agent CAPTCHA missing.");
  }

  const solution = solveAgentCaptchaChallenge(runtime.captcha);
  const response = await fetchJson(runtime, `/v1/jobs/${runtime.job.id}/captcha`, {
    method: "POST",
    body: solution
  });
  runtime.claim = response.claim;
  runtime.job = response.job;
  return response;
}

async function requestPatch(runtime) {
  // If a worker daemon is running, wait for it to submit the patch instead
  // of submitting directly. Worker has its own pid and emits worker.* events
  // that make the "second agent" visible on stage. Live engines (claude-code,
  // codex, opencode) can take 30–90 seconds to generate, so the wait here is
  // generous. The worker's own retry/timeout logic decides when to fall back.
  const waitMs = Number(process.env.PATCHMARKET_BUYER_WORKER_WAIT_MS || 120_000);
  const workerDeadline = Date.now() + waitMs;
  while (Date.now() < workerDeadline) {
    const polled = await fetchJson(runtime, `/v1/jobs/${runtime.job.id}`);
    runtime.job = polled.job || runtime.job;
    if (runtime.job.patchSubmission) {
      return { patch: runtime.job.patchSubmission, job: runtime.job, source: "worker-daemon" };
    }
    await delay(250);
  }

  // Fallback: no worker daemon detected, buyer submits the patch directly so
  // the buyer-only flow (e.g. tests, npm run smoke) keeps working.
  const response = await fetchJson(runtime, `/v1/jobs/${runtime.job.id}/patch`, {
    method: "POST",
    body: { claimCredential: runtime.claim }
  });
  runtime.job = response.job;
  return { ...response, source: "buyer-fallback" };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyPatch(runtime) {
  const response = await fetchJson(runtime, `/v1/jobs/${runtime.job.id}/verify`, {
    method: "POST"
  });
  runtime.job = response.job;
  return response;
}

async function postBuyerEvent(runtime, event) {
  if (!runtime.job?.id) return null;
  const response = await fetchJson(runtime, `/v1/jobs/${runtime.job.id}/buyer-events`, {
    method: "POST",
    body: normalizeBuyerEvent(event)
  });
  runtime.job = response.job;
  return response;
}

async function fetchJson(runtime, pathname, { method = "GET", headers = {}, body, allowStatus = [] } = {}) {
  const response = await fetch(`${runtime.baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok && !allowStatus.includes(response.status)) {
    const message = json.error
      ? `${json.error.code}: ${json.error.message} ${json.error.fix}`
      : `${method} ${pathname} failed with ${response.status}`;
    throw new Error(message);
  }

  return {
    ...json,
    status: response.status,
    headers: Object.fromEntries(response.headers)
  };
}

async function openAiResponseCreate(runtime, body) {
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${runtime.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new Error("OpenAI API timed out after 20s.");
    }
    throw error;
  }

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(json.error?.message || `OpenAI API failed with ${response.status}`);
  }
  return json;
}

function extractResponseText(response) {
  const chunks = [];
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function parseArgs(value) {
  if (!value) return {};
  return typeof value === "string" ? JSON.parse(value) : value;
}

function ensureActiveJob(runtime, toolName) {
  if (!runtime.job?.id) {
    throw new Error(`${toolName} requires an active PatchMarket job. Create the job first.`);
  }
}

function normalizeBuyerEvent(event = {}) {
  return {
    type: "buyer.reasoning",
    title: normalizeBuyerTitle(String(event.title || "Buyer update").trim()),
    detail: String(event.detail || "").trim(),
    data: event.data || {}
  };
}

function normalizeBuyerTitle(title) {
  const value = title.toLowerCase();
  if (value.includes("inspect") && value.includes("red")) return "Inspecting red CI";
  if (value.includes("job state")) return "Confirming job state";
  if (value.includes("creat") || value.includes("opening") || value.includes("patchmarket job")) return "Opening PatchMarket job";
  if (value.includes("offer") || value.includes("review")) return "Reviewing offers";
  if (value.includes("select")) return "Selecting worker";
  if (value.includes("402") || value.includes("claim challenge")) return "Requesting 402 challenge";
  if (value.includes("l402")) return "Submitting L402 proof";
  if (value.includes("captcha")) return "Solving Agent CAPTCHA";
  if (value.includes("worker patch") || value.includes("requesting patch")) return "Requesting worker patch";
  if (value.includes("verify")) return "Verifying patch";
  return title;
}

async function inspectRedCi(runtime) {
  const fixtureDir = path.join(runtime.rootDir, "fixtures", "red-ci");
  const command = runCommand(process.execPath, ["--test", "--test-reporter=tap", "tests/auth.test.mjs"], {
    cwd: fixtureDir
  });
  return command;
}

function runCommand(file, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        log: `${stdout}${stderr}`.trim()
      });
    });
  });
}

function finalSummary(runtime, buyerMessage) {
  const proof = runtime.job?.verificationProof || {};
  return {
    mode: runtime.mode,
    model: runtime.mode === "openai" ? runtime.model : null,
    buyerMessage,
    jobId: runtime.job?.id || null,
    selectedWorker: runtime.job?.selectedOffer?.name || null,
    selectedWorkerId: runtime.job?.selectedOffer?.workerId || null,
    finalState: runtime.job?.state || null,
    releasedSats: runtime.job?.reputationEvent?.deltaEarnedSats || null,
    exitCodeBefore: proof.exitCodeBefore ?? null,
    exitCodeAfter: proof.exitCodeAfter ?? null,
    executionMode: proof.executionMode || null
  };
}
