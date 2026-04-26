import crypto from "node:crypto";

export const PAYMENT_MODE = "simulated";

export const demoFixture = {
  id: "red-ci",
  repoHash: hashText("fixture:red-ci:v1"),
  acceptanceCommand: "node --test --test-reporter=tap tests/auth.test.mjs",
  commandHash: hashText("node --test --test-reporter=tap tests/auth.test.mjs"),
  allowedPatchPaths: ["src/auth.mjs"],
  timeoutMs: 8000,
  networkMode: "disabled",
  beforeLog: [
    "TAP version 13",
    "# Subtest: validates active token",
    "ok 1 - validates active token",
    "# Subtest: rejects expired token",
    "not ok 2 - rejects expired token",
    "  Expected token expiring at now to be rejected",
    "  actual: false",
    "  expected: true",
    "1..2",
    "# fail 1"
  ].join("\n"),
  afterLog: [
    "TAP version 13",
    "# Subtest: validates active token",
    "ok 1 - validates active token",
    "# Subtest: rejects expired token",
    "ok 2 - rejects expired token",
    "1..2",
    "# pass 2",
    "# fail 0"
  ].join("\n")
};

export const demoPatch = `diff --git a/src/auth.mjs b/src/auth.mjs
index 22c2b89..9c3fe02 100644
--- a/src/auth.mjs
+++ b/src/auth.mjs
@@
 export function isTokenExpired(expiresAt, now = Date.now()) {
-  return expiresAt < now - 30000;
+  return expiresAt <= now;
 }
`;

export const demoBrokenAuthSource = `export function isTokenExpired(expiresAt, now = Date.now()) {
  return expiresAt < now - 30000;
}

export function validateToken(token, now = Date.now()) {
  if (!token || typeof token.expiresAt !== "number") {
    return false;
  }
  return !isTokenExpired(token.expiresAt, now);
}
`;

export const demoPatchedAuthSource = `export function isTokenExpired(expiresAt, now = Date.now()) {
  return expiresAt <= now;
}

export function validateToken(token, now = Date.now()) {
  if (!token || typeof token.expiresAt !== "number") {
    return false;
  }
  return !isTokenExpired(token.expiresAt, now);
}
`;

export const demoWorkers = [
  {
    id: "patchlite",
    name: "PatchLite",
    model: "GLM-4.6",
    harness: "fast-runner",
    priceSats: 1200,
    passRate: 0.35,
    latencySec: 90,
    trustPenalty: 650,
    trustTier: "sandboxed"
  },
  {
    id: "patchpro",
    name: "PatchPro",
    model: "GPT-5.5-Codex",
    harness: "test-runner",
    priceSats: 2800,
    passRate: 0.95,
    latencySec: 140,
    trustPenalty: 0,
    trustTier: "verified-runner"
  }
];

export const transitions = {
  posted: ["payment_required", "expired"],
  payment_required: ["paid", "expired", "rejected"],
  paid: ["captcha_required", "refunded"],
  captcha_required: ["claimed", "refunded", "rejected"],
  claimed: ["running", "timeout"],
  running: ["submitted", "timeout", "runner_failed"],
  submitted: ["verifying", "rejected"],
  verifying: ["verified", "verification_failed"],
  verified: ["released"],
  released: [],
  verification_failed: ["rejected", "reassign"],
  timeout: ["reassign", "refunded"],
  runner_failed: ["reassign", "refunded"],
  rejected: [],
  refunded: [],
  expired: []
};

export function hashText(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hmac(value) {
  return crypto.createHmac("sha256", "patchmarket-demo-verifier-key").update(value).digest("hex");
}

function keyedHmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest("hex");
}

function hashBytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function scoreWorkers(workers = demoWorkers) {
  return workers
    .map((worker) => {
      const expectedCostToGreen = Math.round(worker.priceSats / worker.passRate);
      const latencyPenalty = Math.round(worker.latencySec / 10);
      const adjustedScore = expectedCostToGreen + latencyPenalty + worker.trustPenalty;

      return {
        workerId: worker.id,
        name: worker.name,
        model: worker.model,
        harness: worker.harness,
        trustTier: worker.trustTier,
        priceSats: worker.priceSats,
        passRate: worker.passRate,
        latencySec: worker.latencySec,
        expectedCostToGreen,
        latencyPenalty,
        trustPenalty: worker.trustPenalty,
        adjustedScore
      };
    })
    .sort((a, b) => a.adjustedScore - b.adjustedScore);
}

export function createDemoJob() {
  const job = {
    id: `job_${Date.now()}`,
    escrowId: `escrow_${crypto.randomUUID().slice(0, 8)}`,
    fixture: demoFixture,
    state: "posted",
    paymentMode: PAYMENT_MODE,
    marketOffers: null,
    selectedOffer: null,
    paymentOffer: null,
    agentCaptcha: null,
    claimCredential: null,
    patchSubmission: null,
    verificationProof: null,
    reputationEvent: null,
    usedProofs: [],
    idempotencyKeys: [],
    events: []
  };

  appendEvent(job, {
    type: "ci.red",
    title: "Red CI detected",
    detail: `${demoFixture.acceptanceCommand} failed in auth.test.mjs`,
    panel: "buyer",
    data: {
      command: demoFixture.acceptanceCommand,
      repoHash: demoFixture.repoHash,
      beforeLog: demoFixture.beforeLog
    }
  });

  appendEvent(job, {
    type: "job.packaged",
    title: "Buyer agent packaged work order",
    detail: "Allowed patch scope: src/auth.mjs. Tests and scripts are locked.",
    panel: "buyer",
    data: {
      allowedPatchPaths: demoFixture.allowedPatchPaths,
      deadlineSec: 180,
      maxPriceSats: 4000
    }
  });

  return job;
}

export function appendEvent(job, event) {
  const next = {
    eventId: `evt_${String(job.events.length + 1).padStart(3, "0")}`,
    jobId: job.id,
    state: job.state,
    timestamp: new Date().toISOString(),
    ...event
  };
  job.events.push(next);
  return next;
}

export function transition(job, toState, reason, actor = "system") {
  const allowed = transitions[job.state] || [];
  if (!allowed.includes(toState)) {
    throw patchMarketError({
      code: "escrow.invalid_transition",
      message: `Cannot transition ${job.state} -> ${toState}`,
      cause: `State ${job.state} only allows: ${allowed.join(", ") || "no transitions"}`,
      fix: "Refresh the job event stream and retry from the current state.",
      retryable: false
    });
  }

  const fromState = job.state;
  job.state = toState;
  appendEvent(job, {
    type: "escrow.transition",
    title: `Escrow ${fromState} -> ${toState}`,
    detail: reason,
    panel: "payment",
    data: {
      fromState,
      toState,
      actor,
      idempotencyKey: hashText(`${job.id}:${fromState}:${toState}:${reason}`)
    }
  });
}

export function prepareOffers(job) {
  if (job.marketOffers) {
    return { offers: job.marketOffers, recommended: job.marketOffers[0], selected: job.selectedOffer };
  }

  const offers = scoreWorkers();
  const recommended = offers[0];
  job.marketOffers = offers;

  appendEvent(job, {
    type: "worker.scored",
    title: "Worker market quoted offers",
    detail: `${recommended.name} leads on expected cost to green at ${recommended.expectedCostToGreen} sats.`,
    panel: "buyer",
    data: { offers, recommended, selected: job.selectedOffer }
  });

  return { offers, recommended, selected: job.selectedOffer };
}

export function selectOffer(job, workerId, { actor = "buyer-agent", rationale = null } = {}) {
  const { offers, recommended } = prepareOffers(job);
  const next = offers.find((offer) => offer.workerId === workerId);
  if (!next) {
    throw patchMarketError({
      code: "worker.not_found",
      message: "Worker offer not found.",
      cause: `No scored offer exists for worker ${workerId}.`,
      fix: "Read the scored offers and select one of the advertised worker ids.",
      retryable: true
    });
  }

  if (job.state !== "posted") {
    throw patchMarketError({
      code: "worker.selection_locked",
      message: "Worker selection is already locked.",
      cause: `Current state is ${job.state}.`,
      fix: "Create a fresh job to change the selected worker.",
      retryable: false
    });
  }

  job.selectedOffer = next;
  appendEvent(job, {
    type: "worker.selected",
    title: `${next.name} selected`,
    detail:
      rationale ||
      `${next.name} chosen at ${next.priceSats} sats with ${Math.round(next.passRate * 100)}% pass rate.`,
    panel: "buyer",
    data: {
      selected: next,
      recommended,
      offers
    }
  });

  return next;
}

export function issuePaymentOffer(job) {
  if (!job.selectedOffer) {
    throw patchMarketError({
      code: "worker.not_selected",
      message: "Select a worker before claiming.",
      cause: "The buyer has not chosen a worker offer yet.",
      fix: "Read /offers and POST /select before requesting the claim.",
      retryable: true
    });
  }

  if (job.state === "posted") {
    transition(job, "payment_required", "Worker claim requires L402 payment proof.", "payment-gateway");
  }

  if (job.state !== "payment_required") {
    throw patchMarketError({
      code: "payment.not_required",
      message: "This job is not waiting for payment.",
      cause: `Current state is ${job.state}.`,
      fix: "Read the event stream and continue from the current state.",
      retryable: false
    });
  }

  if (!job.paymentOffer) {
    const nonce = crypto.randomUUID();
    const invoiceHash = hashText(`${job.id}:${job.selectedOffer.workerId}:${nonce}:${job.selectedOffer.priceSats}`);
    const offer = {
      jobId: job.id,
      workerId: job.selectedOffer.workerId,
      amountSats: job.selectedOffer.priceSats,
      nonce,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      invoiceHash,
      memo: `PatchMarket claim for ${job.id}`,
      paymentMode: PAYMENT_MODE,
      simulatedProof: simulatedProof({ nonce, invoiceHash }),
      wwwAuthenticate: `L402 invoiceHash="${invoiceHash}", amountSats="${job.selectedOffer.priceSats}"`
    };

    job.paymentOffer = offer;
    appendEvent(job, {
      type: "l402.challenge",
      title: "402 Payment Required",
      detail: `${offer.amountSats} sats required to claim ${job.selectedOffer.name}.`,
      panel: "payment",
      data: offer
    });
  }

  return job.paymentOffer;
}

export function simulatedProof({ nonce, invoiceHash }) {
  return `sim-proof:${invoiceHash}:${nonce}`;
}

export function parseL402Header(header) {
  if (!header || !header.startsWith("L402 ")) return null;
  const pairs = {};
  const rest = header.slice("L402 ".length);
  for (const chunk of rest.split(",")) {
    const [rawKey, rawValue] = chunk.trim().split("=");
    if (!rawKey || !rawValue) continue;
    pairs[rawKey] = rawValue.replace(/^"|"$/g, "");
  }
  return pairs;
}

export function validatePaymentProof(job, header) {
  const offer = job.paymentOffer || issuePaymentOffer(job);
  const proof = parseL402Header(header);
  if (!proof) {
    throw patchMarketError({
      code: "payment.proof_missing",
      message: "Missing L402 payment proof.",
      cause: "The protected claim endpoint was retried without an Authorization header.",
      fix: "Pay the offer and retry with Authorization: L402 proof=..., nonce=..., invoiceHash=...",
      retryable: true
    });
  }

  const now = Date.now();
  if (Date.parse(offer.expiresAt) < now) {
    throw patchMarketError({
      code: "payment.offer_expired",
      message: "Payment offer expired.",
      cause: "The L402 offer lifetime elapsed before proof was submitted.",
      fix: "Request a fresh claim to receive a new payment offer.",
      retryable: true
    });
  }

  if (job.usedProofs.includes(proof.proof)) {
    throw patchMarketError({
      code: "payment.proof_replayed",
      message: "Payment proof was already used.",
      cause: "The submitted proof nonce has already claimed this job.",
      fix: "Request a fresh payment offer.",
      retryable: true
    });
  }

  if (proof.nonce !== offer.nonce || proof.invoiceHash !== offer.invoiceHash) {
    throw patchMarketError({
      code: "payment.invoice_mismatch",
      message: "Payment proof does not match this job.",
      cause: "The nonce or invoice hash differs from the issued offer.",
      fix: "Use the proof for the current job and worker offer.",
      retryable: true
    });
  }

  if (proof.proof !== offer.simulatedProof) {
    throw patchMarketError({
      code: "payment.proof_invalid",
      message: "Payment proof rejected.",
      cause: "The simulated L402 proof did not match the issued offer.",
      fix: "Use the simulated proof provided by this demo offer.",
      retryable: true
    });
  }

  job.usedProofs.push(proof.proof);
  transition(job, "paid", "Valid L402 proof received.", "buyer-agent");
  appendEvent(job, {
    type: "l402.proof_accepted",
    title: "Authorization retry accepted",
    detail: "Payment proof matched job, worker, nonce, amount, and invoice hash.",
    panel: "payment",
    data: {
      invoiceHash: offer.invoiceHash,
      amountSats: offer.amountSats
    }
  });
  return true;
}

export function issueAgentCaptcha(job) {
  if (job.state === "paid") {
    transition(job, "captcha_required", "Paid worker claim now requires agent CAPTCHA proof.", "agent-captcha");
  }

  if (job.state !== "captcha_required") {
    throw patchMarketError({
      code: "agent_captcha.invalid_state",
      message: "Cannot issue agent CAPTCHA.",
      cause: `Current state is ${job.state}.`,
      fix: "Submit valid L402 payment proof before requesting the agent CAPTCHA.",
      retryable: true
    });
  }

  if (job.agentCaptcha && !job.agentCaptcha.solved && Date.parse(job.agentCaptcha.expiresAt) > Date.now()) {
    return publicAgentCaptcha(job.agentCaptcha);
  }

  const data = crypto.randomBytes(32);
  const nonce = crypto.randomUUID();
  const sessionId = `captcha_${crypto.randomUUID().slice(0, 8)}`;
  const token = hashText(`${job.id}:${sessionId}:${nonce}:agent-captcha`).slice(0, 32);
  const program = [
    { op: "reverse_xor", start: 0, length: 16, key: 0xa3 },
    { op: "sum_mod_repeat", start: 16, length: 16, repeat: 8 },
    { op: "sha256_truncate", start: 0, length: 32, bytes: 8 }
  ];
  const answer = solveAgentCaptchaProgram(data, program);

  job.agentCaptcha = {
    sessionId,
    token,
    dataB64: data.toString("base64"),
    instructions: [
      "Take bytes 0 through 15, reverse their order, then XOR each byte with 0xA3.",
      "Take bytes 16 through 31, sum them modulo 256, then repeat that one-byte result 8 times.",
      "Hash the full 32-byte payload with SHA-256 and keep the first 8 bytes.",
      "Concatenate the three outputs, SHA-256 the result, then HMAC that hex answer with the nonce."
    ],
    program,
    nonce,
    expiresAt: new Date(Date.now() + 30 * 1000).toISOString(),
    issuedAt: new Date().toISOString(),
    answerHash: hashText(answer),
    solved: false,
    attempts: 0
  };

  appendEvent(job, {
    type: "agent_captcha.challenge",
    title: "Agent CAPTCHA issued",
    detail: "Worker must solve byte transforms and submit answer + HMAC within 30 seconds.",
    panel: "payment",
    data: publicAgentCaptcha(job.agentCaptcha)
  });

  return publicAgentCaptcha(job.agentCaptcha);
}

export function solveAgentCaptchaProgram(data, program) {
  const bytes = Buffer.from(data);
  const outputs = program.map((step) => {
    const slice = bytes.subarray(step.start, step.start + step.length);
    if (step.op === "reverse_xor") {
      return Buffer.from([...slice].reverse().map((byte) => byte ^ step.key));
    }
    if (step.op === "sum_mod_repeat") {
      const sum = [...slice].reduce((total, byte) => (total + byte) % 256, 0);
      return Buffer.alloc(step.repeat, sum);
    }
    if (step.op === "sha256_truncate") {
      return crypto.createHash("sha256").update(slice).digest().subarray(0, step.bytes);
    }
    throw patchMarketError({
      code: "agent_captcha.unknown_step",
      message: "Unknown agent CAPTCHA step.",
      cause: `Unsupported op ${step.op}.`,
      fix: "Use the issued challenge program exactly.",
      retryable: false
    });
  });

  return hashBytes(Buffer.concat(outputs));
}

export function solveAgentCaptchaChallenge(challenge) {
  const answer = solveAgentCaptchaProgram(Buffer.from(challenge.dataB64, "base64"), challenge.program);
  return {
    sessionId: challenge.sessionId,
    token: challenge.token,
    answer,
    hmac: keyedHmac(challenge.nonce, answer)
  };
}

export function validateAgentCaptchaSolution(job, solution = {}) {
  const challenge = job.agentCaptcha;
  if (job.state !== "captcha_required" || !challenge) {
    throw patchMarketError({
      code: "agent_captcha.not_required",
      message: "Agent CAPTCHA is not waiting for a solution.",
      cause: `Current state is ${job.state}.`,
      fix: "Follow the protocol from the current job state.",
      retryable: false
    });
  }

  if (challenge.solved) {
    throw patchMarketError({
      code: "agent_captcha.replayed",
      message: "Agent CAPTCHA was already solved.",
      cause: "A solved challenge cannot be reused for another claim.",
      fix: "Create a fresh job or continue with the issued claim credential.",
      retryable: false
    });
  }

  if (Date.parse(challenge.expiresAt) < Date.now()) {
    throw patchMarketError({
      code: "agent_captcha.expired",
      message: "Agent CAPTCHA expired.",
      cause: "The 30-second agent CAPTCHA window elapsed.",
      fix: "Request a fresh challenge.",
      retryable: true
    });
  }

  challenge.attempts += 1;
  const expectedHmac = keyedHmac(challenge.nonce, solution.answer || "");
  const valid =
    solution.sessionId === challenge.sessionId &&
    solution.token === challenge.token &&
    hashText(solution.answer || "") === challenge.answerHash &&
    solution.hmac === expectedHmac;

  if (!valid) {
    throw patchMarketError({
      code: "agent_captcha.invalid_solution",
      message: "Agent CAPTCHA solution rejected.",
      cause: "The submitted answer, token, or HMAC did not match the issued challenge.",
      fix: "Decode the bytes, execute the transforms, and HMAC the answer with the nonce.",
      retryable: true
    });
  }

  challenge.solved = true;
  challenge.solvedAt = new Date().toISOString();
  appendEvent(job, {
    type: "agent_captcha.solved",
    title: "Agent CAPTCHA solved",
    detail: "Claimant proved code execution by solving byte transforms and HMAC proof.",
    panel: "payment",
    data: {
      sessionId: challenge.sessionId,
      answerHash: challenge.answerHash,
      hmacHash: hashText(solution.hmac),
      attempts: challenge.attempts
    }
  });

  return issueClaimCredential(job);
}

export function issueClaimCredential(job) {
  if (job.state === "paid") {
    throw patchMarketError({
      code: "claim.agent_captcha_required",
      message: "Agent CAPTCHA required before claim credential.",
      cause: "Payment was accepted, but the claimant has not solved the agent CAPTCHA.",
      fix: "Solve the issued agent CAPTCHA before requesting the claim credential.",
      retryable: true
    });
  }

  if (job.state === "captcha_required") {
    transition(job, "claimed", "PatchPro received a short-lived claim credential.", "claim-service");
  }
  if (job.state !== "claimed") {
    throw patchMarketError({
      code: "claim.invalid_state",
      message: "Cannot issue claim credential.",
      cause: `Current state is ${job.state}.`,
      fix: "Submit valid payment proof before claiming.",
      retryable: true
    });
  }

  const payload = {
    jobId: job.id,
    workerId: job.selectedOffer.workerId,
    scope: "submit_patch",
    agentCaptchaSessionId: job.agentCaptcha?.sessionId || null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  };
  const signature = hmac(JSON.stringify(payload));
  job.claimCredential = { ...payload, signature };

  appendEvent(job, {
    type: "claim.credential_issued",
    title: "Claim credential issued",
    detail: `${job.selectedOffer.name} may submit one patch before expiry.`,
    panel: "payment",
    data: job.claimCredential
  });

  return job.claimCredential;
}

export function submitPatch(job, credential = job.claimCredential, options = {}) {
  validateCredential(job, credential);

  if (job.state === "claimed") {
    transition(job, "running", "Worker sandbox started with network disabled.", "runner");
  }

  appendEvent(job, {
    type: "worker.running",
    title: "Worker sandbox running",
    detail: "Network disabled. Allowed path: src/auth.mjs.",
    panel: "buyer",
    data: {
      command: job.fixture.acceptanceCommand,
      networkMode: job.fixture.networkMode
    }
  });

  const patchText = options.patch || demoPatch;
  const source = options.patch ? options.source || "live-engine" : "deterministic";

  const validation = validatePatch(patchText, job.fixture.allowedPatchPaths);
  if (!validation.ok) {
    transition(job, "runner_failed", validation.error.message, "verifier");
    throw validation.error;
  }

  job.patchSubmission = {
    jobId: job.id,
    workerId: credential.workerId,
    patch: patchText,
    patchHash: hashText(patchText),
    submittedAt: new Date().toISOString(),
    source,
    engine: options.engine || null,
    attempts: options.attempts || null,
    latencyMs: options.latencyMs || null
  };

  transition(job, "submitted", "Patch submitted with allowed file changes only.", "worker-agent");
  appendEvent(job, {
    type: "patch.submitted",
    title: "Patch submitted",
    detail:
      source === "deterministic"
        ? "Deterministic patch. Touches src/auth.mjs only."
        : `Live patch from ${options.engine || "engine"} (${options.attempts || 1} attempt${options.attempts === 1 ? "" : "s"}, ${options.latencyMs || "?"}ms). Touches src/auth.mjs only.`,
    panel: "proof",
    data: job.patchSubmission
  });

  return job.patchSubmission;
}

export function verifyPatch(job, evidence = {}) {
  if (!job.patchSubmission) {
    submitPatch(job);
  }

  if (job.state === "submitted") {
    transition(job, "verifying", "Verifier applying patch to clean fixture.", "verifier");
  }

  const beforeLog = evidence.beforeLog || job.fixture.beforeLog;
  const afterLog = evidence.afterLog || job.fixture.afterLog;
  const exitCodeBefore = Number.isInteger(evidence.exitCodeBefore) ? evidence.exitCodeBefore : 1;
  const exitCodeAfter = Number.isInteger(evidence.exitCodeAfter) ? evidence.exitCodeAfter : 0;

  const proofPayload = {
    jobId: job.id,
    escrowId: job.escrowId,
    repoHash: job.fixture.repoHash,
    patchHash: job.patchSubmission.patchHash,
    commandHash: job.fixture.commandHash,
    beforeLogHash: hashText(beforeLog),
    afterLogHash: hashText(afterLog),
    exitCodeBefore,
    exitCodeAfter,
    verifierVersion: evidence.verifierVersion || "patchmarket-demo-verifier@0.1.0",
    executionMode: evidence.executionMode || "deterministic-replay",
    worktreeHash: evidence.worktreeHash || null,
    verifiedAt: new Date().toISOString(),
    result: "passed"
  };

  job.verificationProof = {
    ...proofPayload,
    signature: hmac(JSON.stringify(proofPayload))
  };

  appendEvent(job, {
    type: "verify.started",
    title: "Verifier running immutable command",
    detail: job.fixture.acceptanceCommand,
    panel: "proof",
    data: {
      commandHash: job.fixture.commandHash,
      beforeLog,
      executionMode: proofPayload.executionMode
    }
  });

  transition(job, "verified", "Acceptance command passed after patch.", "verifier");
  appendEvent(job, {
    type: "verify.passed",
    title: "Verifier green, proof signed",
    detail: "Patch hash, command hash, and logs are sealed into proof.",
    panel: "proof",
    data: {
      proof: job.verificationProof,
      afterLog
    }
  });

  transition(job, "released", `${job.selectedOffer.priceSats} sats released to ${job.selectedOffer.name}.`, "escrow");
  job.reputationEvent = {
    workerId: job.selectedOffer.workerId,
    deltaAcceptedJobs: 1,
    deltaEarnedSats: job.selectedOffer.priceSats,
    newPassRate: 0.96
  };
  appendEvent(job, {
    type: "payment.released",
    title: `${job.selectedOffer.priceSats} sats released`,
    detail: `${job.selectedOffer.name} reputation updated: 95% -> 96%.`,
    panel: "payment",
    data: job.reputationEvent
  });

  return job.verificationProof;
}

export function validateCredential(job, credential) {
  if (!credential) {
    throw patchMarketError({
      code: "claim.missing",
      message: "Missing claim credential.",
      cause: "Worker attempted to submit patch without a claim token.",
      fix: "Claim the job after payment before submitting a patch.",
      retryable: true
    });
  }

  const { signature, ...payload } = credential;
  if (signature !== hmac(JSON.stringify(payload))) {
    throw patchMarketError({
      code: "claim.signature_invalid",
      message: "Claim credential signature is invalid.",
      cause: "The credential payload does not match its signature.",
      fix: "Request a fresh claim credential.",
      retryable: true
    });
  }

  if (credential.jobId !== job.id || credential.workerId !== job.selectedOffer.workerId) {
    throw patchMarketError({
      code: "claim.scope_mismatch",
      message: "Claim credential does not match this job.",
      cause: "The credential references another job or worker.",
      fix: "Use the credential issued for this job.",
      retryable: true
    });
  }

  if (Date.parse(credential.expiresAt) < Date.now()) {
    throw patchMarketError({
      code: "claim.expired",
      message: "Claim credential expired.",
      cause: "The worker missed the claim window.",
      fix: "Request a new claim if the job is still assignable.",
      retryable: true
    });
  }
}

export function validatePatch(patch, allowedPaths) {
  const forbiddenPatterns = [
    /^diff --git a\/tests\//m,
    /^diff --git a\/package\.json/m,
    /^diff --git a\/package-lock\.json/m,
    /^diff --git a\/\.github\//m,
    /\.\.\//
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(patch)) {
      return {
        ok: false,
        error: patchMarketError({
          code: "patch.forbidden_path",
          message: "Patch modifies a forbidden path.",
          cause: "The patch touches tests, package scripts, CI config, lockfiles, or path traversal.",
          fix: `Only modify: ${allowedPaths.join(", ")}`,
          retryable: true
        })
      };
    }
  }

  for (const line of patch.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) continue;
    const [, fromPath, toPath] = match;
    if (!allowedPaths.includes(fromPath) || !allowedPaths.includes(toPath)) {
      return {
        ok: false,
        error: patchMarketError({
          code: "patch.path_not_allowed",
          message: "Patch path is outside allowed scope.",
          cause: `Patch touched ${fromPath} -> ${toPath}.`,
          fix: `Only modify: ${allowedPaths.join(", ")}`,
          retryable: true
        })
      };
    }
  }

  return { ok: true };
}

export function publicJob(job) {
  return {
    id: job.id,
    escrowId: job.escrowId,
    state: job.state,
    paymentMode: job.paymentMode,
    fixture: job.fixture,
    marketOffers: job.marketOffers,
    recommendedOffer: job.marketOffers?.[0] || null,
    selectedOffer: job.selectedOffer,
    paymentOffer: job.paymentOffer,
    agentCaptcha: job.agentCaptcha ? publicAgentCaptcha(job.agentCaptcha) : null,
    claimCredential: job.claimCredential,
    patchSubmission: job.patchSubmission,
    verificationProof: job.verificationProof,
    reputationEvent: job.reputationEvent,
    events: job.events
  };
}

export function appendBuyerEvent(job, event = {}) {
  const title = String(event.title || "Buyer update");
  const detail = String(event.detail || "");
  return appendEvent(job, {
    type: event.type || "buyer.reasoning",
    title,
    detail,
    panel: "buyer",
    data: event.data || {}
  });
}

export function appendWorkerEvent(job, event = {}) {
  const title = String(event.title || "Worker update");
  const detail = String(event.detail || "");
  return appendEvent(job, {
    type: event.type || "worker.update",
    title,
    detail,
    panel: "worker",
    data: event.data || {}
  });
}

function publicAgentCaptcha(challenge) {
  return {
    sessionId: challenge.sessionId,
    token: challenge.token,
    dataB64: challenge.dataB64,
    instructions: challenge.instructions,
    program: challenge.program,
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt,
    issuedAt: challenge.issuedAt,
    solved: challenge.solved,
    attempts: challenge.attempts
  };
}

export function patchMarketError({ code, message, cause, fix, retryable = false, docsUrl, eventId }) {
  const error = new Error(message);
  error.patchMarket = {
    code,
    message,
    cause,
    fix,
    retryable,
    docsUrl,
    eventId
  };
  return error;
}
