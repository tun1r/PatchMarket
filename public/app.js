const buyerEvents = document.querySelector("#buyer-events");
const paymentEvents = document.querySelector("#payment-events");
const proofEvents = document.querySelector("#proof-events");
const workerScore = document.querySelector("#worker-score");
const artifactView = document.querySelector("#artifact-view");
const stateChip = document.querySelector("#state-chip");
const amountChip = document.querySelector("#amount-chip");
const modeChip = document.querySelector("#mode-chip");
const heroPaymentCard = document.querySelector("#hero-payment-card");
const heroRed = document.querySelector("#hero-red");
const heroCommand = document.querySelector("#hero-command");
const hero402 = document.querySelector("#hero-402");
const heroL402 = document.querySelector("#hero-l402");
const heroExit = document.querySelector("#hero-exit");
const heroMode = document.querySelector("#hero-mode");
const heroRelease = document.querySelector("#hero-release");
const heroAgent = document.querySelector("#hero-agent");
const proofMetrics = document.querySelector("#proof-metrics");
const applyBtn = document.querySelector("#apply-btn");
const applyStatus = document.querySelector("#apply-status");
const liveModeBtn = document.querySelector("#mode-live-btn");
const replayModeBtn = document.querySelector("#mode-replay-btn");
const modelMiniBtn = document.querySelector("#model-mini-btn");
const modelGpt5Btn = document.querySelector("#model-gpt5-btn");
const modelGroup = document.querySelector("#model-group");
const demoStatus = document.querySelector("#demo-status");
const runBtn = document.querySelector("#run-btn");
const stepBtn = document.querySelector("#step-btn");
const resetBtn = document.querySelector("#reset-btn");
const tabs = document.querySelectorAll(".tab");

const protoMap = {
  "l402.challenge": "proto-402",
  "l402.proof_accepted": "proto-proof",
  "agent_captcha.challenge": "proto-captcha",
  "agent_captcha.solved": "proto-200",
  "claim.credential_issued": "proto-200",
  "payment.released": "proto-release"
};

let job = null;
let paymentOffer = null;
let agentCaptcha = null;
let claimCredential = null;
let recommendedOffer = null;
let currentStep = 0;
let running = false;
let activeArtifact = "diff";
let workspaceStatus = "Patch not applied to workspace.";
let demoMode = "live";
let selectedModel = "gpt-5.1-codex-mini";
let runState = {
  status: "idle",
  mode: "openai",
  model: selectedModel,
  error: null,
  summary: null
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const steps = [
  createJob,
  selectRecommendedOffer,
  requestClaim,
  retryClaimWithProof,
  solveAgentCaptchaStep,
  submitPatchStep,
  verifyPatchStep
];

runBtn.addEventListener("click", handleRun);
stepBtn.addEventListener("click", stepProtocol);
resetBtn.addEventListener("click", resetDemo);
applyBtn.addEventListener("click", applyWorkspacePatch);
liveModeBtn.addEventListener("click", () => setDemoMode("live"));
replayModeBtn.addEventListener("click", () => setDemoMode("replay"));
modelMiniBtn.addEventListener("click", () => setSelectedModel("gpt-5.1-codex-mini"));
modelGpt5Btn.addEventListener("click", () => setSelectedModel("gpt-5"));

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activeArtifact = tab.dataset.tab;
    tabs.forEach((item) => item.classList.toggle("active", item === tab));
    render();
  });
});

setButtons(false);
render();
await syncCurrentJob();
setInterval(() => {
  Promise.all([syncCurrentJob(), syncRunState()]).catch(console.error);
}, 1000);

async function resetDemo() {
  running = false;
  currentStep = 0;
  const response = await fetchJson("/v1/jobs/reset", { method: "POST" });
  job = response.job;
  paymentOffer = null;
  agentCaptcha = null;
  claimCredential = null;
  recommendedOffer = job.recommendedOffer || null;
  workspaceStatus = "Fixture reset to red baseline.";
  runState = {
    status: "idle",
    mode: "openai",
    model: selectedModel,
    error: null,
    summary: null
  };
  setButtons(false);
  clearProto();
  render();
}

async function handleRun() {
  if (demoMode === "replay") {
    return runProtocol();
  }

  if (runState.status === "running") return;
  demoStatus.textContent = `Starting live buyer with ${selectedModel}...`;
  const response = await fetchJson("/v1/demo/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "openai", model: selectedModel })
  });
  runState = response.run;
  render();
}

async function runProtocol() {
  if (running) return;
  running = true;
  setButtons(true);
  try {
    while (currentStep < steps.length) {
      await stepProtocol();
      await sleep(700);
    }
  } finally {
    running = false;
    setButtons(false);
  }
}

async function stepProtocol() {
  if (currentStep >= steps.length) return;
  setButtons(true);
  try {
    await steps[currentStep]();
    currentStep += 1;
    render();
  } finally {
    if (!running) setButtons(false);
  }
}

async function createJob() {
  const response = await fetchJson("/v1/jobs/fix", { method: "POST" });
  job = response.job;
  recommendedOffer = response.recommended;
  render();
}

async function selectRecommendedOffer() {
  const selected = recommendedOffer || job.recommendedOffer;
  const response = await fetchJson(`/v1/jobs/${job.id}/select`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workerId: selected.workerId,
      rationale: `Manual replay selected ${selected.name} because it is the recommended verified worker.`
    })
  });
  job = response.job;
  render();
}

async function requestClaim() {
  const response = await fetch(`/v1/jobs/${job.id}/claim`, { method: "POST" });
  const body = await response.json();
  if (response.status !== 402) {
    throw new Error("Expected 402 Payment Required");
  }
  paymentOffer = body.paymentOffer;
  job = body.job || (await fetchJson(`/v1/jobs/${job.id}`)).job;
  markProto("proto-claim", "done");
  markProto("proto-402", "active");
  render();
}

async function retryClaimWithProof() {
  const auth = `L402 proof="${paymentOffer.simulatedProof}", nonce="${paymentOffer.nonce}", invoiceHash="${paymentOffer.invoiceHash}"`;
  const response = await fetchJson(`/v1/jobs/${job.id}/claim`, {
    method: "POST",
    headers: { Authorization: auth }
  });
  agentCaptcha = response.captcha;
  job = response.job;
  markProto("proto-402", "done");
  markProto("proto-proof", "done");
  markProto("proto-captcha", "active");
  render();
}

async function solveAgentCaptchaStep() {
  const solution = await solveAgentCaptcha(agentCaptcha);
  const response = await fetchJson(`/v1/jobs/${job.id}/captcha`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(solution)
  });
  claimCredential = response.claim;
  job = response.job;
  markProto("proto-captcha", "done");
  markProto("proto-200", "active");
  render();
}

async function submitPatchStep() {
  const response = await fetchJson(`/v1/jobs/${job.id}/patch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimCredential })
  });
  job = response.job;
  markProto("proto-200", "done");
  render();
}

async function verifyPatchStep() {
  const response = await fetchJson(`/v1/jobs/${job.id}/verify`, { method: "POST" });
  job = response.job;
  markProto("proto-release", "done");
  render();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) {
    const message = body.error
      ? `${body.error.code}: ${body.error.message} ${body.error.fix}`
      : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function syncCurrentJob() {
  const response = await fetchJson("/v1/jobs/current");
  if (!response.job) return;
  if (!job || response.job.id !== job.id || response.job.events.length !== job.events.length || response.job.state !== job.state) {
    job = response.job;
    recommendedOffer = response.job.recommendedOffer || recommendedOffer;
    render();
  }
}

async function syncRunState() {
  const response = await fetchJson("/v1/demo/run-state");
  if (JSON.stringify(response.run) !== JSON.stringify(runState)) {
    runState = response.run;
    render();
  }
}

function render() {
  renderStatus();
  renderControls();
  renderHero();
  renderEvents();
  renderScores();
  renderProofMetrics();
  renderProofActions();
  renderArtifact();
}

function renderControls() {
  liveModeBtn.classList.toggle("active", demoMode === "live");
  replayModeBtn.classList.toggle("active", demoMode === "replay");
  modelMiniBtn.classList.toggle("active", selectedModel === "gpt-5.1-codex-mini");
  modelGpt5Btn.classList.toggle("active", selectedModel === "gpt-5");
  modelGroup.style.opacity = demoMode === "live" ? "1" : "0.45";
  modelMiniBtn.disabled = demoMode !== "live";
  modelGpt5Btn.disabled = demoMode !== "live";
  stepBtn.disabled = demoMode !== "replay" || (running && demoMode === "replay");
  demoStatus.textContent = renderDemoStatus();
}

function renderStatus() {
  if (!job) {
    stateChip.textContent = "waiting";
    stateChip.className = "chip chip-waiting";
    modeChip.textContent = "simulated L402";
    amountChip.textContent = "awaiting buyer";
    return;
  }

  stateChip.textContent = job.state;
  stateChip.className = `chip ${job.state === "released" ? "chip-green" : job.state === "posted" ? "chip-red" : "chip-waiting"}`;
  modeChip.textContent = `${job.paymentMode} L402`;
  amountChip.textContent = job.selectedOffer ? `${job.selectedOffer.name} selected` : "awaiting buyer";
}

function renderHero() {
  if (!job) {
    heroPaymentCard?.classList.remove("is-cleared");
    heroRed.textContent = "Red CI";
    heroCommand.textContent = "waiting for fixture";
    hero402.textContent = "402 Payment Required";
    heroL402.textContent = "WWW-Authenticate: pending";
    heroExit.textContent = "exit --";
    heroMode.textContent = "executionMode: waiting";
    heroRelease.textContent = "0 sats";
    heroAgent.textContent = "awaiting buyer";
    return;
  }

  const proof = job.verificationProof;
  const authHeader = job.paymentOffer?.wwwAuthenticate || "pending";
  const compactHeader = compactAuthHeader(authHeader);
  heroRed.textContent = job.state === "released" ? "Red CI -> Green" : "Red CI";
  heroCommand.textContent = job.fixture.acceptanceCommand;
  hero402.textContent = job.paymentOffer ? "402 Cleared" : "402 Payment Required";
  heroPaymentCard?.classList.toggle("is-cleared", Boolean(job.paymentOffer));
  heroL402.textContent = `WWW-Authenticate: ${compactHeader}`;
  heroL402.title = job.paymentOffer?.wwwAuthenticate || "pending";
  heroExit.textContent = proof ? `exit ${proof.exitCodeBefore} -> ${proof.exitCodeAfter}` : "exit 1 -> ?";
  heroMode.textContent = proof ? `executionMode: ${compactExecutionMode(proof.executionMode)}` : "executionMode: waiting";
  heroRelease.textContent = job.reputationEvent ? `${job.reputationEvent.deltaEarnedSats} sats` : "0 sats";
  heroAgent.textContent = job.selectedOffer ? `${job.selectedOffer.name} ${job.state === "released" ? "paid" : "selected"}` : "awaiting buyer";
}

function renderEvents() {
  const empty = `<div class="event"><h3>Ready</h3><p>Run the protocol to start the trace.</p></div>`;
  buyerEvents.innerHTML = empty;
  paymentEvents.innerHTML = empty;
  proofEvents.innerHTML = empty;

  if (!job) return;

  const groups = {
    buyer: [],
    payment: [],
    proof: []
  };

  job.events.forEach((event) => {
    const panel = groups[event.panel] ? event.panel : "buyer";
    groups[panel].push(event);
  });

  buyerEvents.innerHTML = groups.buyer.map(renderEvent).join("");
  paymentEvents.innerHTML = groups.payment.map(renderEvent).join("");
  proofEvents.innerHTML = groups.proof.map(renderEvent).join("");

  Object.keys(protoMap).forEach((type) => {
    if (job.events.some((event) => event.type === type)) {
      markProto(protoMap[type], "done");
    }
  });
}

function renderEvent(event) {
  const time = new Date(event.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  return `
    <div class="event ${event.panel || ""}">
      <h3>${escapeHtml(event.title)}</h3>
      <p>${escapeHtml(event.detail)}</p>
      <time>${time} | ${escapeHtml(event.state || "")}</time>
    </div>
  `;
}

function renderScores() {
  if (!job?.events) {
    workerScore.innerHTML = "";
    return;
  }
  const scoring = job.events.find((event) => event.type === "worker.scored")?.data;
  if (!scoring) {
    workerScore.innerHTML = "";
    return;
  }

  const selectedWorkerId = job.selectedOffer?.workerId || scoring.selected?.workerId || null;

  workerScore.innerHTML = `
    <span class="eyebrow">Worker scoring</span>
    <table>
      <thead>
        <tr>
          <th>Worker</th>
          <th>Model</th>
          <th>Price</th>
          <th>Pass</th>
          <th>Expected</th>
        </tr>
      </thead>
      <tbody>
        ${scoring.offers
          .map(
            (offer) => `
              <tr class="${offer.workerId === selectedWorkerId ? "selected" : ""}">
                <td>${offer.name}</td>
                <td>${offer.model}</td>
                <td>${offer.priceSats}</td>
                <td>${Math.round(offer.passRate * 100)}%</td>
                <td>${offer.adjustedScore}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderArtifact() {
  if (!job) {
    artifactView.textContent = "No artifact yet.\nRun the protocol to buy a verified patch.";
    return;
  }

  const patch = job.patchSubmission?.patch || "Patch has not been submitted yet.";
  const beforeLog = job.events?.find((event) => event.type === "verify.started")?.data?.beforeLog || job.fixture?.beforeLog || "";
  const afterLog = job.events?.find((event) => event.type === "verify.passed")?.data?.afterLog || job.fixture?.afterLog || "";
  const proof = job.verificationProof
    ? JSON.stringify(job.verificationProof, null, 2)
    : "Verification proof has not been signed yet.";

  const content = {
    diff: patch,
    logs: `BEFORE\n${beforeLog}\n\nAFTER\n${afterLog}`,
    proof
  }[activeArtifact];

  artifactView.innerHTML = activeArtifact === "diff" ? renderDiff(content) : escapeHtml(content);
}

function renderProofMetrics() {
  if (!job) {
    proofMetrics.innerHTML = "";
    return;
  }

  const proof = job.verificationProof;
  const paymentOfferData = job.paymentOffer;
  const captchaSolved = job.agentCaptcha?.solved ? "solved" : "pending";
  const releaseAmount = job.reputationEvent?.deltaEarnedSats ? `${job.reputationEvent.deltaEarnedSats} sats` : "pending";
  const authHeader = paymentOfferData?.wwwAuthenticate || "pending";
  const visibleAuth = paymentOfferData ? `accepted ${compactAuthHeader(authHeader)}` : "pending";

  proofMetrics.innerHTML = `
    <div class="metric-card">
      <span class="label">WWW-Authenticate</span>
      <strong title="${escapeHtml(authHeader)}">${escapeHtml(visibleAuth)}</strong>
    </div>
    <div class="metric-card">
      <span class="label">Agent CAPTCHA</span>
      <strong>${escapeHtml(captchaSolved)}</strong>
    </div>
    <div class="metric-card">
      <span class="label">Verifier Mode</span>
      <strong title="${escapeHtml(proof?.executionMode || "waiting")}">${escapeHtml(compactExecutionMode(proof?.executionMode || "waiting"))}</strong>
    </div>
    <div class="metric-card">
      <span class="label">Exit Codes</span>
      <strong>${escapeHtml(proof ? `${proof.exitCodeBefore} -> ${proof.exitCodeAfter}` : "1 -> ?")}</strong>
    </div>
    <div class="metric-card metric-card-amount">
      <span class="label">Escrow Release</span>
      <strong>${escapeHtml(releaseAmount)}</strong>
    </div>
  `;
}

function renderProofActions() {
  if (!job) {
    applyBtn.disabled = true;
    applyStatus.textContent = "Patch not applied to workspace.";
    return;
  }

  const appliedEvent = job.events?.find((event) => event.type === "workspace.applied");
  if (appliedEvent) {
    workspaceStatus = "Workspace patch applied. Open the fixture in VS Code to review the git diff.";
  }

  applyBtn.disabled = job.state !== "released";
  applyStatus.textContent = workspaceStatus;
}

async function applyWorkspacePatch() {
  if (!job || job.state !== "released") return;
  applyBtn.disabled = true;
  applyStatus.textContent = "Applying patch to fixtures/red-ci/src/auth.mjs...";
  const response = await fetchJson(`/v1/jobs/${job.id}/apply`, { method: "POST" });
  job = response.job;
  workspaceStatus =
    response.workspace?.state === "already_applied"
      ? "Workspace already matches the purchased patch."
      : "Workspace patch applied. Open the fixture in VS Code to review the git diff.";
  render();
}

async function solveAgentCaptcha(challenge) {
  const data = decodeBase64(challenge.dataB64);
  const resolvedOutputs = [];
  for (const step of challenge.program) {
    const slice = data.slice(step.start, step.start + step.length);
    if (step.op === "reverse_xor") {
      resolvedOutputs.push(Uint8Array.from([...slice].reverse().map((byte) => byte ^ step.key)));
    } else if (step.op === "sum_mod_repeat") {
      const sum = [...slice].reduce((total, byte) => (total + byte) % 256, 0);
      resolvedOutputs.push(new Uint8Array(step.repeat).fill(sum));
    } else if (step.op === "sha256_truncate") {
      resolvedOutputs.push((await sha256Bytes(slice)).slice(0, step.bytes));
    }
  }

  const answer = await sha256Hex(concatBytes(resolvedOutputs));
  return {
    sessionId: challenge.sessionId,
    token: challenge.token,
    answer,
    hmac: await hmacSha256Hex(challenge.nonce, answer)
  };
}

function decodeBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function concatBytes(chunks) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    combined.set(chunk, offset);
    offset += chunk.length;
  });
  return combined;
}

async function sha256Bytes(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function sha256Hex(bytes) {
  return bytesToHex(await sha256Bytes(bytes));
}

async function hmacSha256Hex(key, value) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function renderDiff(diff) {
  return diff
    .split("\n")
    .map((line) => {
      const cls = line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : "";
      return cls ? `<span class="${cls}">${escapeHtml(line)}</span>` : escapeHtml(line);
    })
    .join("\n");
}

function markProto(id, state) {
  const node = document.querySelector(`#${id}`);
  if (!node) return;
  node.classList.remove("active", "done");
  node.classList.add(state);
}

function clearProto() {
  document.querySelectorAll(".proto-step").forEach((node) => node.classList.remove("active", "done"));
}

function setButtons(isBusy) {
  if (demoMode === "live") {
    runBtn.textContent = runState.status === "running" ? "Live Buyer Running" : "Run Live Buyer";
    runBtn.disabled = runState.status === "running";
    stepBtn.disabled = true;
    return;
  }

  runBtn.textContent = currentStep >= steps.length ? "Replay" : "Run Replay";
  runBtn.disabled = isBusy;
  stepBtn.disabled = isBusy && running;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function compactAuthHeader(header) {
  if (!header || header === "pending") return "pending";
  const invoiceHash = header.match(/invoiceHash="([^"]+)"/)?.[1] || "";
  const amountSats = header.match(/amountSats="([^"]+)"/)?.[1] || "";
  if (!invoiceHash) return header;
  return `L402 ${compactHash(invoiceHash, 8)}${amountSats ? `, ${amountSats} sats` : ""}`;
}

function compactHash(value, head = 8, tail = 4) {
  if (!value || value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function compactExecutionMode(value) {
  if (value === "temp-worktree-runner") return "temp-worktree";
  return value;
}

function setDemoMode(nextMode) {
  demoMode = nextMode;
  setButtons(running);
  render();
}

function setSelectedModel(model) {
  selectedModel = model;
  if (runState.status === "idle") {
    runState = { ...runState, model };
  }
  render();
}

function renderDemoStatus() {
  if (demoMode === "replay") {
    return "Replay mode runs the deterministic fallback path inside the browser.";
  }

  if (runState.status === "running") {
    return `Live Buyer is running with ${runState.model || selectedModel}.`;
  }

  if (runState.status === "failed") {
    return `Live Buyer failed: ${runState.error}`;
  }

  if (runState.status === "completed") {
    if (runState.summary?.mode && runState.summary.mode !== "openai") {
      return `Live Buyer fell back to ${runState.summary.mode}.`;
    }
    return `Live Buyer completed with ${runState.summary?.model || runState.model || selectedModel}.`;
  }

  return `Live Buyer ready with ${selectedModel}.`;
}
