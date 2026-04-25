import { solveAgentCaptchaChallenge } from "../src/core.mjs";
import { startServer } from "../src/server.mjs";

const server = await startServer({ port: 0 });
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  const post = async (path, body, headers = {}) => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body ?? {})
    });
    const json = await response.json();
    return { status: response.status, headers: Object.fromEntries(response.headers), json };
  };

  const jobResponse = await post("/v1/jobs/fix", {
    repo: "fixtures/red-ci",
    command: "node --test --test-reporter=tap tests/auth.test.mjs",
    budget: 5000
  });
  const jobId = jobResponse.json.job.id;

  const claim402 = await post(`/v1/jobs/${jobId}/claim`, {});
  const offer = claim402.json.paymentOffer;
  const auth = `L402 proof="${offer.simulatedProof}", nonce="${offer.nonce}", invoiceHash="${offer.invoiceHash}"`;
  const paid = await post(`/v1/jobs/${jobId}/claim`, {}, { authorization: auth });
  const captchaSolution = solveAgentCaptchaChallenge(paid.json.captcha);
  const claim = await post(`/v1/jobs/${jobId}/captcha`, captchaSolution);
  await post(`/v1/jobs/${jobId}/patch`, { claimCredential: claim.json.claim });
  const verified = await post(`/v1/jobs/${jobId}/verify`, {});

  const proof = verified.json.job.verificationProof;
  const summary = {
    jobId,
    l402Status: claim402.status,
    wwwAuthenticate: claim402.headers["www-authenticate"],
    captchaSolved: verified.json.job.agentCaptcha.solved,
    finalState: verified.json.job.state,
    executionMode: proof.executionMode,
    exit: `${proof.exitCodeBefore} -> ${proof.exitCodeAfter}`,
    releasedSats: verified.json.job.reputationEvent.deltaEarnedSats
  };

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
