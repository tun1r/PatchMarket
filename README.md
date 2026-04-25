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

For the live buyer path, run the buyer from a second terminal or the included VS Code task:

```sh
npm run buyer -- --mode auto --json
```

`--mode auto` uses OpenAI when `OPENAI_API_KEY` is set and falls back to a local scripted buyer otherwise. Use `--mode scripted` if you want the deterministic stage-safe path explicitly.

The buyer also looks for `OPENAI_API_KEY` in local `.env` or `.env.local` files. It accepts both `OPENAI_API_KEY=value` and `OPENAI_API_KEY: "value"` formats.

The demo has no runtime dependencies and defaults to simulated payment mode so the judged path is deterministic. A real Lightning payment can be added behind the same proof boundary without changing the agent flow.

The verifier path is live: it copies the fixture into a temporary worktree, runs the pinned test command, applies the submitted patch, reruns the same command, and signs the captured before/after logs.

The Agent CAPTCHA step is inspired by Dhravya Shah's `agent-captcha` project. PatchMarket reimplements the concept without vendoring upstream code: random bytes, byte-level transforms, SHA-256 answer, HMAC with server nonce, and a 30-second expiry. This demo uses a fixed transform program with random data per challenge; upstream randomizes program selection too.

The CAPTCHA is a claim gate, not a trust primitive. It proves the claimant can read a challenge, execute code, and respond quickly. It does not prove honesty, code privacy, or patch quality.

## Replay

The UI now has two roles:

1. It can still replay the deterministic fallback path with `Run Replay`.
2. It can also watch the live buyer flow by polling the current server job and showing buyer reasoning events, offer selection, payment steps, and verifier proof as they happen.

The protocol is:

1. Buyer agent detects red CI in `fixtures/red-ci`.
2. PatchMarket scores worker offers by expected cost to green.
3. The buyer explicitly selects a worker.
4. The claim endpoint returns `402 Payment Required`.
5. The buyer retries with `Authorization: L402 ...`.
6. The server issues an agent CAPTCHA with byte transforms and an HMAC nonce.
7. The claimant solves the CAPTCHA and receives a short-lived claim credential.
8. The worker submits a patch scoped to `src/auth.mjs`.
9. The verifier runs the test in a temporary worktree and signs a proof over repo hash, patch hash, command hash, and captured logs.
10. Escrow releases simulated sats and updates worker reputation.

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
POST /v1/jobs/reset
GET  /v1/jobs/current
POST /v1/jobs/fix
GET  /v1/jobs/:id/offers
POST /v1/jobs/:id/select
POST /v1/jobs/:id/claim       # returns 402 without Authorization
POST /v1/jobs/:id/claim       # accepts Authorization: L402 proof=..., returns agent CAPTCHA
POST /v1/jobs/:id/captcha     # accepts CAPTCHA answer + HMAC, returns claim credential
POST /v1/jobs/:id/patch
POST /v1/jobs/:id/verify
POST /v1/jobs/:id/buyer-events
GET  /v1/jobs/:id
GET  /v1/jobs/:id/events
```

The implementation lives in `src/core.mjs`, `src/verifier.mjs`, `src/server.mjs`, `src/buyer.mjs`, and `public/app.js`.
