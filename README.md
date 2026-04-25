# PatchMarket

PatchMarket is an L402 escrow demo where a coding agent can buy a verified software outcome from another coding agent.

The wedge is deliberately narrow: red-to-green CI fixes. A buyer agent packages a failing test, scores worker agents by expected cost to green, receives a `402 Payment Required` challenge, retries with a simulated L402 proof, solves an agent CAPTCHA, receives a claim credential, and releases escrow only after a verifier signs the patch proof.

## Run

```sh
npm test
npm run smoke
npm run demo
```

Open `http://localhost:3000`.

The demo has no runtime dependencies and defaults to simulated payment mode so the judged path is deterministic. A real Lightning payment can be added behind the same proof boundary without changing the agent flow.

The verifier path is live: it copies the fixture into a temporary worktree, runs the pinned test command, applies the submitted patch, reruns the same command, and signs the captured before/after logs.

The Agent CAPTCHA step is inspired by Dhravya Shah's `agent-captcha` project. PatchMarket reimplements the concept without vendoring upstream code: random bytes, byte-level transforms, SHA-256 answer, HMAC with server nonce, and a 30-second expiry. This demo uses a fixed transform program with random data per challenge; upstream randomizes program selection too.

The CAPTCHA is a claim gate, not a trust primitive. It proves the claimant can read a challenge, execute code, and respond quickly. It does not prove honesty, code privacy, or patch quality.

## Replay

The UI replays the protocol in one screen:

1. Buyer agent detects red CI in `fixtures/red-ci`.
2. Worker offers are scored by expected cost to green.
3. The claim endpoint returns `402 Payment Required`.
4. The buyer retries with `Authorization: L402 ...`.
5. The server issues an agent CAPTCHA with byte transforms and an HMAC nonce.
6. The agent solves the CAPTCHA and receives a short-lived claim credential.
7. The worker submits a patch scoped to `src/auth.mjs`.
8. The verifier runs the test in a temporary worktree and signs a proof over repo hash, patch hash, command hash, and captured logs.
9. Escrow releases simulated sats and updates worker reputation.

## Fixture

The intentionally broken fixture is:

```sh
cd fixtures/red-ci
node --test --test-reporter=tap tests/auth.test.mjs
```

The submitted patch changes only `src/auth.mjs`:

```diff
-  return expiresAt < now - 30000;
+  return expiresAt <= now;
```

## API

```txt
POST /v1/jobs/fix
POST /v1/jobs/:id/claim       # returns 402 without Authorization
POST /v1/jobs/:id/claim       # accepts Authorization: L402 proof=..., returns agent CAPTCHA
POST /v1/jobs/:id/captcha     # accepts CAPTCHA answer + HMAC, returns claim credential
POST /v1/jobs/:id/patch
POST /v1/jobs/:id/verify
GET  /v1/jobs/:id
GET  /v1/jobs/:id/events
```

The implementation lives in `src/core.mjs`, `src/verifier.mjs`, `src/server.mjs`, and `public/app.js`.
