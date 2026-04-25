import assert from "node:assert/strict";
import test from "node:test";
import {
  createDemoJob,
  issueAgentCaptcha,
  issuePaymentOffer,
  prepareOffers,
  solveAgentCaptchaChallenge,
  submitPatch,
  validateAgentCaptchaSolution,
  validatePaymentProof
} from "../src/core.mjs";
import { verifyPatchWithRunner } from "../src/verifier.mjs";

test("live verifier runs red test, applies patch, reruns green test", async () => {
  const job = createDemoJob();
  prepareOffers(job);
  const offer = issuePaymentOffer(job);
  const auth = `L402 proof="${offer.simulatedProof}", nonce="${offer.nonce}", invoiceHash="${offer.invoiceHash}"`;

  validatePaymentProof(job, auth);
  const captcha = issueAgentCaptcha(job);
  validateAgentCaptchaSolution(job, solveAgentCaptchaChallenge(captcha));
  submitPatch(job);
  const proof = await verifyPatchWithRunner(job);

  assert.equal(job.state, "released");
  assert.equal(proof.result, "passed");
  assert.equal(proof.executionMode, "temp-worktree-runner");
  assert.equal(proof.exitCodeBefore, 1);
  assert.equal(proof.exitCodeAfter, 0);
  assert.match(job.events.find((event) => event.type === "verify.started").data.beforeLog, /not ok/);
  assert.match(job.events.find((event) => event.type === "verify.passed").data.afterLog, /# fail 0/);
});
