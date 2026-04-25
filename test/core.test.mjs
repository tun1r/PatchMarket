import assert from "node:assert/strict";
import test from "node:test";
import {
  createDemoJob,
  issueAgentCaptcha,
  issuePaymentOffer,
  prepareOffers,
  scoreWorkers,
  solveAgentCaptchaChallenge,
  submitPatch,
  validateAgentCaptchaSolution,
  validatePatch,
  validatePaymentProof,
  verifyPatch
} from "../src/core.mjs";

test("worker scoring selects PatchPro by expected cost to green", () => {
  const offers = scoreWorkers();
  assert.equal(offers[0].name, "PatchPro");
  assert.equal(offers[0].workerId, "patchpro");
});

test("happy path reaches released state", () => {
  const job = createDemoJob();
  prepareOffers(job);
  const offer = issuePaymentOffer(job);
  const auth = `L402 proof="${offer.simulatedProof}", nonce="${offer.nonce}", invoiceHash="${offer.invoiceHash}"`;

  validatePaymentProof(job, auth);
  const captcha = issueAgentCaptcha(job);
  const solution = solveAgentCaptchaChallenge(captcha);
  validateAgentCaptchaSolution(job, solution);
  submitPatch(job);
  const proof = verifyPatch(job);

  assert.equal(job.state, "released");
  assert.equal(proof.result, "passed");
  assert.equal(job.reputationEvent.deltaEarnedSats, 2800);
});

test("claim credential requires solved agent captcha after payment", () => {
  const job = createDemoJob();
  prepareOffers(job);
  const offer = issuePaymentOffer(job);
  const auth = `L402 proof="${offer.simulatedProof}", nonce="${offer.nonce}", invoiceHash="${offer.invoiceHash}"`;

  validatePaymentProof(job, auth);
  assert.throws(() => submitPatch(job), /Missing claim credential/);
  const captcha = issueAgentCaptcha(job);
  assert.equal(job.state, "captcha_required");

  const badSolution = { ...solveAgentCaptchaChallenge(captcha), answer: "bad" };
  assert.throws(() => validateAgentCaptchaSolution(job, badSolution), /Agent CAPTCHA solution rejected/);

  validateAgentCaptchaSolution(job, solveAgentCaptchaChallenge(captcha));
  assert.equal(job.state, "claimed");
  assert.equal(job.claimCredential.agentCaptchaSessionId, captcha.sessionId);
});

test("payment proof cannot be replayed", () => {
  const job = createDemoJob();
  prepareOffers(job);
  const offer = issuePaymentOffer(job);
  const auth = `L402 proof="${offer.simulatedProof}", nonce="${offer.nonce}", invoiceHash="${offer.invoiceHash}"`;

  validatePaymentProof(job, auth);
  assert.throws(() => validatePaymentProof(job, auth), /Cannot transition|already used/);
});

test("patch validator rejects edits to tests", () => {
  const patch = `diff --git a/tests/auth.test.mjs b/tests/auth.test.mjs
--- a/tests/auth.test.mjs
+++ b/tests/auth.test.mjs
@@
-assert.equal(false, true)
+assert.equal(true, true)
`;
  const result = validatePatch(patch, ["src/auth.mjs"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.patchMarket.code, "patch.forbidden_path");
});
