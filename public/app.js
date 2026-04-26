const buyerEvents = document.querySelector("#buyer-events");
const workerEvents = document.querySelector("#worker-events");
const paymentEvents = document.querySelector("#payment-events");
const proofEvents = document.querySelector("#proof-events");
const workerScore = document.querySelector("#worker-score");
const artifactView = document.querySelector("#artifact-view");
const stateChip = document.querySelector("#state-chip");
const amountChip = document.querySelector("#amount-chip");
const modeChip = document.querySelector("#mode-chip");
const heroPaymentCard = document.querySelector("#hero-payment-card");
const heroReleaseCard = document.querySelector("#hero-release-card");
const heroRed = document.querySelector("#hero-red");
const heroCommand = document.querySelector("#hero-command");
const hero402 = document.querySelector("#hero-402");
const heroL402 = document.querySelector("#hero-l402");
const heroExit = document.querySelector("#hero-exit");
const heroMode = document.querySelector("#hero-mode");
const heroRelease = document.querySelector("#hero-release");
const heroAgent = document.querySelector("#hero-agent");
const buyerMeta = document.querySelector("#buyer-meta");
const workerMeta = document.querySelector("#worker-meta");
const verifierMeta = document.querySelector("#verifier-meta");
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

const isSpectator = new URLSearchParams(window.location.search).get("demo") === "1";
if (isSpectator) {
  document.body.dataset.mode = "demo";
}
const POLL_MS = isSpectator ? 500 : 1000;

// Scene stage — full-screen cinematic overlays for the protocol moments.
const sceneStage = document.querySelector("#scene-stage");
const sceneSeen = new Set();
const sceneQueue = [];
let scenePlaying = false;
let sceneHoldTimer = null;
let sceneExitTimer = null;
let sceneGapTimer = null;
let sceneCurrent = null; // { node, trigger, event }
let sceneHistory = []; // for replay-previous nav
let sceneAutoAdvance = false;

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
}, POLL_MS);

if (isSpectator) {
  setTimeout(() => {
    autoStartSpectator().catch(console.error);
  }, 600);
}

function maybeQueueScenes() {
  if (!isSpectator || !sceneStage || !job?.events) return;
  // Multiple scenes can share an event trigger (e.g. verify.passed fires
  // both "Tests are green" and "Bug fixed" in sequence). Dedupe by scene id.
  const triggerOrder = [
    { id: "ci-failed", on: "ci.red", build: buildSceneCiFailed, hold: 5400 },
    { id: "bidding", on: "worker.scored", build: buildSceneBidding, hold: 5400 },
    { id: "delegating", on: "worker.selected", build: buildSceneDelegating, hold: 3600 },
    { id: "402", on: "l402.challenge", build: buildScene402, hold: 5000 },
    { id: "captcha", on: "agent_captcha.solved", build: buildSceneCaptcha, hold: 5800 },
    { id: "patch", on: "worker.patching", build: buildScenePatch, hold: 5400 },
    { id: "green", on: "verify.passed", build: buildSceneGreen, hold: 4200 },
    { id: "bug-fixed", on: "verify.passed", build: buildSceneBugFixed, hold: 5800 },
    { id: "sats", on: "payment.released", build: buildSceneSats, hold: 5800 }
  ];

  for (const trigger of triggerOrder) {
    if (sceneSeen.has(trigger.id)) continue;
    const event = job.events.find((e) => e.type === trigger.on);
    if (!event) continue;
    sceneSeen.add(trigger.id);
    sceneQueue.push({ trigger, event });
  }
  drainSceneQueue();
}

function drainSceneQueue() {
  if (scenePlaying) return;
  const next = sceneQueue.shift();
  if (!next) return;
  playScene(next);
}

function playScene({ trigger, event }) {
  scenePlaying = true;
  const node = trigger.build(event, job);
  sceneCurrent = { node, trigger, event };
  if (sceneHistory[sceneHistory.length - 1]?.trigger?.id !== trigger.id) {
    sceneHistory.push({ trigger, event });
  }

  sceneStage.innerHTML = "";
  sceneStage.appendChild(node);
  sceneStage.classList.add("is-active");
  sceneStage.setAttribute("aria-hidden", "false");
  // Force reflow then add is-playing so the animation runs.
  // eslint-disable-next-line no-unused-expressions
  node.getBoundingClientRect();
  node.classList.add("is-playing");

  // Per-scene custom animation hooks fire after enter.
  if (typeof node.dataset.onEnter === "string") {
    const enterFn = node._onEnter;
    if (typeof enterFn === "function") {
      try {
        enterFn();
      } catch (error) {
        console.error("scene enter error", error);
      }
    }
  }

  scheduleSceneExit(trigger.hold);
}

function scheduleSceneExit(holdMs) {
  clearSceneTimers();
  if (!sceneAutoAdvance) return;
  sceneHoldTimer = setTimeout(() => {
    finishCurrentScene({ next: true });
  }, holdMs);
}

function finishCurrentScene({ next = true } = {}) {
  clearSceneTimers();
  if (!sceneCurrent) {
    if (next) drainSceneQueue();
    return;
  }
  const { node } = sceneCurrent;
  sceneCurrent = null;
  node.classList.add("is-leaving");
  sceneExitTimer = setTimeout(() => {
    sceneStage.innerHTML = "";
    sceneStage.classList.remove("is-active");
    sceneStage.setAttribute("aria-hidden", "true");
    scenePlaying = false;
    if (next) {
      sceneGapTimer = setTimeout(drainSceneQueue, 100);
    }
  }, 220);
}

function clearSceneTimers() {
  if (sceneHoldTimer) clearTimeout(sceneHoldTimer);
  if (sceneExitTimer) clearTimeout(sceneExitTimer);
  if (sceneGapTimer) clearTimeout(sceneGapTimer);
  sceneHoldTimer = null;
  sceneExitTimer = null;
  sceneGapTimer = null;
}

// Keyboard nav for recording: → / Space advance, ← replay, ↑ pause auto, Esc dismiss.
if (isSpectator) {
  window.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "ArrowRight" || e.key === " ") {
      e.preventDefault();
      finishCurrentScene({ next: true });
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      // Replay current; if no current, replay last from history.
      const replay = sceneCurrent
        ? { trigger: sceneCurrent.trigger, event: sceneCurrent.event }
        : sceneHistory[sceneHistory.length - 1];
      if (!replay) return;
      clearSceneTimers();
      if (sceneCurrent) {
        finishCurrentScene({ next: false });
        setTimeout(() => playScene(replay), 240);
      } else {
        playScene(replay);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      sceneAutoAdvance = !sceneAutoAdvance;
      if (sceneAutoAdvance && sceneCurrent) {
        scheduleSceneExit(sceneCurrent.trigger.hold);
      } else {
        clearSceneTimers();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      finishCurrentScene({ next: false });
    }
  });
}

function makeSceneEl(className, content = "") {
  const el = document.createElement("section");
  el.className = `scene ${className}`;
  el.innerHTML = content;
  return el;
}

function buildSceneCiFailed(event, currentJob) {
  const file = currentJob.fixture?.acceptanceCommand?.split(" ").pop() || "tests/auth.test.mjs";
  const failingLine =
    currentJob.fixture?.beforeLog
      ?.split("\n")
      .find((line) => line.startsWith("not ok")) || "not ok 2 - rejects expired token";

  const codeLines = [
    { n: 1, code: "export function isTokenExpired(expiresAt, now = Date.now()) {" },
    { n: 2, code: "  return expiresAt < now - 30000;", bug: true },
    { n: 3, code: "}" },
    { n: 4, code: "" },
    { n: 5, code: "export function validateToken(token, now = Date.now()) {" },
    { n: 6, code: '  if (!token || typeof token.expiresAt !== "number") {' },
    { n: 7, code: "    return false;" },
    { n: 8, code: "  }" },
    { n: 9, code: "  return !isTokenExpired(token.expiresAt, now);" },
    { n: 10, code: "}" }
  ];

  const codeMarkup = codeLines
    .map(
      (line) =>
        `<div class="code-row${line.bug ? " is-bug" : ""}"><span class="ln">${line.n}</span><span class="src">${escapeHtml(line.code) || "&nbsp;"}</span>${
          line.bug ? '<span class="bug-pin">bug</span>' : ""
        }</div>`
    )
    .join("");

  return makeSceneEl(
    "scene-ci-failed",
    `
    <span class="scene-eyebrow">CI failed · auth.test.mjs</span>
    <h2 class="scene-title is-red">A bug ships expired tokens as valid</h2>
    <p class="scene-subtitle">The 30-second grace lets expired sessions through. The buyer's agent is stuck — continuing on tokens won't fix it.</p>
    <div class="code-panel">
      <div class="code-panel-head">
        <span class="dot dot-red"></span><span class="dot dot-amber"></span><span class="dot dot-green"></span>
        <span class="path">fixtures/red-ci/src/auth.mjs</span>
      </div>
      <div class="code-body">${codeMarkup}</div>
    </div>
    <div class="scene-tap">$ node --test ${escapeHtml(file)}\n${escapeHtml(failingLine)}</div>
    `
  );
}

function buildSceneBidding(event) {
  const offers = event.data?.offers || [];
  const recommended = event.data?.recommended || offers[0];
  const card = (offer) => `
    <div class="bidding-card${offer.workerId === recommended?.workerId ? " is-winner-target" : ""}" data-worker="${escapeHtml(offer.workerId)}">
      <span class="winner-badge">Selected</span>
      <span class="card-eyebrow">Worker</span>
      <div class="card-name">${escapeHtml(offer.name)}</div>
      <div class="card-meta">${escapeHtml(offer.model)} · ${escapeHtml(offer.harness)}</div>
      <div class="card-row"><span class="k">price</span><span class="v">${offer.priceSats.toLocaleString()} sats</span></div>
      <div class="card-row"><span class="k">pass rate</span><span class="v">${Math.round(offer.passRate * 100)}%</span></div>
      <div class="card-row"><span class="k">latency</span><span class="v">${offer.latencySec}s</span></div>
      <div class="card-row"><span class="k">expected to green</span><span class="v">${offer.expectedCostToGreen.toLocaleString()} sats</span></div>
    </div>
  `;
  const node = makeSceneEl(
    "scene-bidding",
    `
    <span class="scene-eyebrow">Bidding</span>
    <h2 class="scene-title">Two workers quote the job</h2>
    <p class="scene-subtitle">Buyer compares price, pass rate, and latency. Picks the lowest expected cost to green.</p>
    <div class="bidding-cards">${offers.map(card).join("")}</div>
    `
  );
  node._onEnter = () => {
    setTimeout(() => {
      node.querySelectorAll(".bidding-card.is-winner-target").forEach((el) => {
        el.classList.add("is-winner");
      });
    }, 1800);
  };
  node.dataset.onEnter = "1";
  return node;
}

function buildSceneDelegating(event) {
  const buyerName = event.data?.actor || "Codex buyer agent";
  const workerName = event.data?.selected?.name || "PatchPro";
  const workerId = event.data?.selected?.workerId || "patchpro";
  return makeSceneEl(
    "scene-delegating",
    `
    <span class="scene-eyebrow">Delegating</span>
    <h2 class="scene-title">Agent hires agent</h2>
    <p class="scene-subtitle">Buyer agent delegates the bounded work order to a separate worker process.</p>
    <div class="delegating-flow">
      <div class="agent-node">
        <span class="role">Buyer</span>
        <div class="name">${escapeHtml(buyerName.includes("buyer") ? buyerName : "Buyer · gpt-5.1-codex-mini")}</div>
        <div class="pid">posted /v1/jobs/fix</div>
      </div>
      <div class="agent-arrow"><span class="arrow-label">L402 escrow</span></div>
      <div class="agent-node">
        <span class="role">Worker</span>
        <div class="name">${escapeHtml(workerName)}</div>
        <div class="pid">${escapeHtml(workerId)} · ready</div>
      </div>
    </div>
    `
  );
}

function buildScene402(event) {
  const offer = event.data || {};
  const sats = offer.amountSats ? offer.amountSats.toLocaleString() : "2,800";
  const invoice = offer.invoiceHash || "";
  const compact = invoice
    ? `${invoice.slice(0, 12)}…${invoice.slice(-6)}`
    : "pending";
  return makeSceneEl(
    "scene-402",
    `
    <span class="scene-eyebrow">Money moment</span>
    <h2 class="scene-hero-number is-amber">402</h2>
    <p class="scene-subtitle">Payment Required — server returns L402 challenge before granting claim.</p>
    <div class="auth-line">WWW-Authenticate: L402 invoiceHash="${escapeHtml(compact)}", amountSats="${escapeHtml(String(offer.amountSats || ""))}"</div>
    <div class="amount">${sats} sats</div>
    `
  );
}

function buildSceneCaptcha(event) {
  const data = event.data || {};
  const node = makeSceneEl(
    "scene-captcha",
    `
    <span class="scene-eyebrow">Inverse CAPTCHA · agents only</span>
    <h2 class="scene-title is-amber">A puzzle humans can't solve</h2>
    <p class="scene-subtitle">Reverses the human CAPTCHA. 32 random bytes in, byte transforms out, HMAC-signed in under 30 seconds. Keeps human-driven scrapers out of the worker market.</p>
    <div class="captcha-versus">
      <div class="versus-card versus-human">
        <span class="versus-icon">✗</span>
        <div class="versus-name">Human</div>
        <ul class="versus-list">
          <li>can't read 32 random bytes</li>
          <li>can't run transforms in &lt;30s</li>
          <li>can't HMAC by hand</li>
        </ul>
      </div>
      <div class="versus-divider"></div>
      <div class="versus-card versus-agent">
        <span class="versus-icon">✓</span>
        <div class="versus-name">Agent</div>
        <ul class="versus-list">
          <li>parses challenge JSON</li>
          <li>executes byte transforms</li>
          <li>signs HMAC instantly</li>
        </ul>
      </div>
    </div>
    <div class="captcha-chain">
      <div class="captcha-step" data-step="1"><span class="label">32 random bytes issued</span><span class="value">dataB64</span></div>
      <div class="captcha-step" data-step="2"><span class="label">reverse_xor(0..15, key=0xA3)</span><span class="value">→ 16 bytes</span></div>
      <div class="captcha-step" data-step="3"><span class="label">sum_mod_repeat(16..31)</span><span class="value">→ 8 bytes</span></div>
      <div class="captcha-step" data-step="4"><span class="label">sha256_truncate(0..31, 8)</span><span class="value">→ 8 bytes</span></div>
      <div class="captcha-step" data-step="5"><span class="label">hmac(nonce, sha256(concat))</span><span class="value">${escapeHtml(data.hmacHash ? data.hmacHash.slice(0, 12) + "…" : "verified")}</span></div>
    </div>
    `
  );
  node._onEnter = () => {
    const steps = node.querySelectorAll(".captcha-step");
    steps.forEach((step, i) => {
      setTimeout(() => step.classList.add("is-on"), 800 + i * 320);
      setTimeout(() => step.classList.add("is-done"), 800 + i * 320 + 280);
    });
  };
  node.dataset.onEnter = "1";
  return node;
}

function buildScenePatch(event, currentJob) {
  const patch = currentJob.patchSubmission?.patch || "";
  const lines = patch
    ? patch.split("\n").slice(0, 10)
    : [
        "diff --git a/src/auth.mjs b/src/auth.mjs",
        "@@",
        " export function isTokenExpired(expiresAt, now = Date.now()) {",
        "-  return expiresAt < now - 30000;",
        "+  return expiresAt <= now;",
        " }"
      ];

  const lineMarkup = lines
    .map((line) => {
      let cls = "diff-line";
      if (line.startsWith("+") && !line.startsWith("+++")) cls += " add";
      else if (line.startsWith("-") && !line.startsWith("---")) cls += " del";
      return `<span class="${cls}">${escapeHtml(line) || "&nbsp;"}</span>`;
    })
    .join("");

  const node = makeSceneEl(
    "scene-patch",
    `
    <span class="scene-eyebrow">Worker writing patch</span>
    <h2 class="scene-title">PatchPro generates the diff</h2>
    <p class="scene-subtitle">Bounded scope: src/auth.mjs only. Tests and scripts are locked.</p>
    <div class="diff-window">
      <div class="diff-header">$ patchpro generate --allowed src/auth.mjs</div>
      <div class="diff-body">${lineMarkup}</div>
    </div>
    `
  );
  node._onEnter = () => {
    const lineEls = node.querySelectorAll(".diff-line");
    lineEls.forEach((el, i) => {
      setTimeout(() => el.classList.add("is-on"), 200 + i * 220);
    });
  };
  node.dataset.onEnter = "1";
  return node;
}

function buildSceneGreen(event, currentJob) {
  const proof = currentJob.verificationProof || event.data?.proof || {};
  const before = proof.exitCodeBefore ?? 1;
  const after = proof.exitCodeAfter ?? 0;
  const tap =
    currentJob.events?.find((e) => e.type === "verify.passed")?.data?.afterLog ||
    currentJob.fixture?.afterLog ||
    "";
  const greenLine = tap
    .split("\n")
    .filter((line) => /pass|fail 0|ok 2/.test(line))
    .slice(0, 3)
    .join("\n");
  return makeSceneEl(
    "scene-green",
    `
    <span class="scene-eyebrow">Verifier accepted patch</span>
    <h2 class="scene-title is-green">Tests are green</h2>
    <div class="exit-flip">
      <span class="from">exit ${before}</span>
      <span class="arrow">→</span>
      <span class="to">exit ${after}</span>
    </div>
    <p class="scene-subtitle">Real Node subprocess in a temp worktree ran the pinned acceptance command and signed before/after logs.</p>
    ${greenLine ? `<div class="tap-line">${escapeHtml(greenLine)}</div>` : ""}
    `
  );
}

function buildSceneBugFixed(event, currentJob) {
  // Show the actual unified diff PatchPro submitted, formatted as a PR review.
  // Falls back to the demoPatch shape if patchSubmission isn't on the job yet.
  const diffLines = [
    { kind: "ctx", n: 1, code: "export function isTokenExpired(expiresAt, now = Date.now()) {" },
    { kind: "del", n: 2, code: "  return expiresAt < now - 30000;" },
    { kind: "add", n: 2, code: "  return expiresAt <= now;" },
    { kind: "ctx", n: 3, code: "}" }
  ];
  const rows = diffLines
    .map((line) => {
      const sigil = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      const cls = `diff-row diff-${line.kind}`;
      return `<div class="${cls}"><span class="ln">${line.n}</span><span class="sigil">${sigil}</span><span class="src">${escapeHtml(line.code)}</span></div>`;
    })
    .join("");
  return makeSceneEl(
    "scene-bug-fixed",
    `
    <span class="scene-eyebrow">Patch applied · src/auth.mjs</span>
    <h2 class="scene-title is-green">The bug is gone</h2>
    <div class="diff-panel">
      <div class="diff-panel-head">
        <span class="dot dot-red"></span><span class="dot dot-amber"></span><span class="dot dot-green"></span>
        <span class="path">diff --git a/src/auth.mjs b/src/auth.mjs</span>
      </div>
      <div class="diff-panel-body">${rows}</div>
    </div>
    <p class="scene-subtitle">The 30-second grace window is gone. <code>isTokenExpired</code> now returns true the moment <code>now</code> reaches <code>expiresAt</code> — no more shipped expired sessions.</p>
    `
  );
}

function buildSceneSats(event, currentJob) {
  const sats = currentJob.reputationEvent?.deltaEarnedSats || event.data?.deltaEarnedSats || 2800;
  const workerName = currentJob.selectedOffer?.name || "PatchPro";
  return makeSceneEl(
    "scene-sats",
    `
    <span class="scene-eyebrow">Escrow released</span>
    <h2 class="scene-title is-amber">Sats fly to ${escapeHtml(workerName)}</h2>
    <div class="sats-arc">
      <div class="agent-node">
        <span class="role">Buyer</span>
        <div class="name">Codex</div>
        <div class="pid">released escrow</div>
      </div>
      <div class="agent-arrow">
        <span class="arrow-label">⚡ Lightning</span>
        <span class="sat-coin"></span>
        <span class="sat-coin"></span>
        <span class="sat-coin"></span>
      </div>
      <div class="agent-node">
        <span class="role">Worker</span>
        <div class="name">${escapeHtml(workerName)}</div>
        <div class="pid">reputation +1</div>
      </div>
    </div>
    <div class="scene-hero-number is-amber">${sats.toLocaleString()}</div>
    <p class="scene-subtitle">Worker only paid because the verifier signed exit 1 → exit 0. Pay for outcomes, not tokens.</p>
    `
  );
}

async function autoStartSpectator() {
  if (runState.status === "running" || job?.state === "released") return;
  if (job && job.state !== "posted") {
    await fetchJson("/v1/jobs/reset", { method: "POST" }).catch(() => {});
  }
  const response = await fetchJson("/v1/demo/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "openai", model: selectedModel })
  }).catch((error) => ({ error }));
  if (response?.run) {
    runState = response.run;
    render();
  }
}

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
  sceneSeen.clear();
  sceneQueue.length = 0;
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
  maybeQueueScenes();
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
    heroReleaseCard?.classList.remove("is-released");
    heroRed.textContent = "Red CI";
    heroCommand.textContent = "waiting for fixture";
    hero402.textContent = "402 Payment Required";
    heroL402.textContent = "WWW-Authenticate: pending";
    heroExit.textContent = "exit --";
    heroMode.textContent = "executionMode: waiting";
    heroRelease.textContent = "0 sats";
    heroAgent.textContent = "awaiting buyer";
    if (buyerMeta) buyerMeta.textContent = `${selectedModel} · awaiting`;
    if (workerMeta) workerMeta.textContent = "patchpro · offline";
    if (verifierMeta) verifierMeta.textContent = "temp-worktree · awaiting";
    return;
  }

  const proof = job.verificationProof;
  const authHeader = job.paymentOffer?.wwwAuthenticate || "pending";
  const compactHeader = compactAuthHeader(authHeader);
  heroRed.textContent = job.state === "released" ? "Red CI → Green" : "Red CI";
  heroCommand.textContent = job.fixture.acceptanceCommand;
  hero402.textContent = job.paymentOffer ? "402 Cleared" : "402 Payment Required";
  heroPaymentCard?.classList.toggle("is-cleared", Boolean(job.paymentOffer));
  heroL402.textContent = `WWW-Authenticate: ${compactHeader}`;
  heroL402.title = job.paymentOffer?.wwwAuthenticate || "pending";
  heroExit.textContent = proof ? `exit ${proof.exitCodeBefore} → ${proof.exitCodeAfter}` : "exit 1 → ?";
  heroMode.textContent = proof ? `executionMode: ${compactExecutionMode(proof.executionMode)}` : "executionMode: waiting";
  heroRelease.textContent = job.reputationEvent ? `${job.reputationEvent.deltaEarnedSats.toLocaleString()} sats` : "0 sats";
  heroAgent.textContent = job.selectedOffer ? `${job.selectedOffer.name} ${job.state === "released" ? "paid" : "selected"}` : "awaiting buyer";
  heroReleaseCard?.classList.toggle("is-released", job.state === "released");

  if (buyerMeta) {
    const stage = job.state === "released" ? "complete" : job.state === "posted" ? "awaiting" : "active";
    const model = runState?.summary?.model || runState?.model || selectedModel;
    buyerMeta.textContent = `${model} · ${stage}`;
  }
  if (workerMeta) {
    const workerName = job.selectedOffer?.workerId || "patchpro";
    const workerEventTypes = ["worker.online", "worker.claiming", "worker.patching", "worker.submitted", "worker.awaiting_release"];
    const lastWorkerEvent = job.events?.slice().reverse().find((event) => workerEventTypes.includes(event.type));
    const stage = lastWorkerEvent?.type?.replace("worker.", "") || (job.selectedOffer ? "selected" : "offline");
    workerMeta.textContent = `${workerName} · ${stage}`;
  }
  if (verifierMeta) {
    const stage = proof ? `exit ${proof.exitCodeBefore} → ${proof.exitCodeAfter}` : job.state === "verifying" ? "running" : "awaiting";
    verifierMeta.textContent = `temp-worktree · ${stage}`;
  }
}

function renderEvents() {
  const empty = `<div class="event"><h3>Awaiting buyer</h3><p>Run the live buyer to start the trace.</p></div>`;
  buyerEvents.innerHTML = empty;
  if (workerEvents) workerEvents.innerHTML = empty;
  proofEvents.innerHTML = empty;
  if (paymentEvents) paymentEvents.innerHTML = "";

  if (!job) return;

  const groups = {
    buyer: [],
    worker: [],
    payment: [],
    proof: []
  };

  job.events.forEach((event) => {
    const panel = groups[event.panel] ? event.panel : "buyer";
    groups[panel].push(event);
  });

  // Merge worker + payment into the worker lane (payment events are protocol
  // moments owned by the claim/escrow flow that the worker participates in).
  const workerLane = [...groups.worker, ...groups.payment].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  buyerEvents.innerHTML = groups.buyer.map(renderEvent).join("") || empty;
  if (workerEvents) {
    workerEvents.innerHTML = workerLane.map(renderEvent).join("") || empty;
  }
  proofEvents.innerHTML = groups.proof.map(renderEvent).join("") || empty;

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
