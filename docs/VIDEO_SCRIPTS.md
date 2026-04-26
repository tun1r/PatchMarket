# PatchMarket Submission Video Scripts

Two locked 60-second scripts for HackNation submission. Demo Video focuses on
UI/UX and product flow. Tech Video focuses on architecture and stack.

Both are recorded at 1920×1080 60fps via OBS, edited in DaVinci Resolve,
H.264 MP4 ≤ 30MB, exported as exactly 60s ±0.5s.

Voiceover via ElevenLabs ("Adam" or "Rachel") for both videos. Stick with one
voice across both for brand consistency.

Background music: Bensound or Pixabay royalty-free, ≤ -18 LUFS so VO sits on
top.

## Demo Video — 60s

Goal: a judge feels they watched two AI agents transact value over Lightning
and resolve a real bug.

| s | Visual | Voiceover | On-screen text |
|---|---|---|---|
| 0–3 | Black canvas. Type cursor types `PatchMarket` in warm cream on warm off-black. | (silence, beat drop at 2.5s) | `PatchMarket` (large) / `Agents buying verified work over Lightning` (small) |
| 3–10 | VS Code split: red test in left pane (`fixtures/red-ci/tests/auth.test.mjs`), terminal in right (failing TAP output). Slow zoom on the failing assertion. | "Your coding agent is stuck. CI is red." | none |
| 10–18 | Hard cut to spectator UI (`?demo=1`). Three agent lanes. Buyer lane streams: `Inspecting red CI` → `Reviewing offers` → `Selecting PatchPro`. Worker lane wakes: `worker.online`. | "So instead of buying more tokens, the agent buys a verified outcome." | none (let the lanes do the work) |
| 18–30 | `402 Payment Required` card pulses across the hero strip. `WWW-Authenticate: L402 invoiceHash=...` ticker. Agent CAPTCHA gate clears. | "Real L402 challenge. Real Lightning protocol. Real agent CAPTCHA." | none |
| 30–42 | Verifier lane runs: TAP output streams. `exit 1` flashes terracotta, then `exit 0` flashes sage. Worker lane: `worker.submitted` → `worker.awaiting_release`. | "The verifier runs the actual test in a sandboxed worktree. Real subprocess. Real exit codes." | none |
| 42–54 | Big `2,800 sats released` fades in (warm amber, 64px tabular). Cut to VS Code git diff: `fixtures/red-ci/src/auth.mjs` actually changed. | "The worker only gets paid when the tests go green. Pay for outcomes, not tokens." | none |
| 54–60 | Wordmark, tagline, GitHub URL. | (music tail) | `PatchMarket` / `Buy what works.` / `github.com/...` |

### Demo Video shot list (record these takes)

1. **Take A — Cold open**: black canvas, cursor types, fades to VS Code red.
2. **Take B — Spectator showtime**: full `?demo=1` page from page-load through
   `2,800 sats released`. Aim for a clean ~25s capture.
3. **Take C — Apply to workspace**: from `released` state, click the apply
   action, cut to VS Code with git gutter diff visible.
4. **B-roll — VS Code red→green**: capture just the editor with the test
   failing, then with the patch applied.

## Tech Video — 60s

Goal: explain how an agent proves it earned the money, in 60 seconds, to a
technical judge.

| s | Visual | Voiceover | On-screen text |
|---|---|---|---|
| 0–5 | Question card: warm-cream serif on warm off-black. | "How does an agent prove it earned the money?" | `How does an agent prove it earned the money?` |
| 5–18 | Animated finite-state-machine diagram of the escrow flow. States light up sequentially as named: `posted → payment_required → paid → captcha_required → claimed → submitted → verified → released`. | "Eight states. Every transition is signed and logged." | (state names appear under each node as they light) |
| 18–32 | Cut to a `VerificationProof` JSON. Highlights bounce across `repoHash`, `patchHash`, `commandHash`, `beforeLogHash`, `afterLogHash`, `exitCodeBefore: 1`, `exitCodeAfter: 0`, `signature`. | "Every release binds to a hash chain. Repo, patch, command, before and after logs, exit codes." | none (JSON is the visual) |
| 32–48 | Three-box architecture diagram. Box 1: Buyer (OpenAI tool calls, `gpt-5.1-codex-mini`). Box 2: Server (L402 + escrow FSM + Agent CAPTCHA). Box 3: Worker daemon (`patchpro`). Dashed arrow from Server to Verifier subprocess. Code snippets fade in behind each box. | "The buyer is real GPT tool-calling. The server is L402 escrow. The worker is its own process. The verifier is a real Node subprocess in a temp worktree." | none |
| 48–60 | Terminal frame showing `npm run showtime` typing, then output streaming. GitHub URL underneath. | "Open source. Runs locally on your laptop in 60 seconds." | `github.com/...` |

### Tech Video shot list

1. **Take D — FSM animation**: build in DaVinci with title cards, no
   recording needed. Use the state list from `src/core.mjs:73-89`.
2. **Take E — JSON proof**: capture from the spectator UI's proof tab, or
   pretty-print from `npm run smoke` output. Use a syntax-highlighted code
   pane.
3. **Take F — Architecture diagram**: build in DaVinci with three boxes and
   directional arrows. Pull code snippets from `src/buyer.mjs`,
   `src/server.mjs`, `bin/patchmarket-worker.mjs`.
4. **Take G — Showtime terminal**: record `npm run showtime` running cleanly
   with all three child processes streaming.

## Recording checklist (both videos)

- [ ] Full-screen recording, do-not-disturb on
- [ ] Slack, Discord, mail clients quit
- [ ] Browser zoom at 100% (no UI scaling artifacts)
- [ ] OBS source: 1920×1080, 60fps, NV12 colorspace
- [ ] Mic muted, system audio recorded only when wanted
- [ ] Three takes per scene; pick the cleanest

## Editing checklist

- [ ] Voiceover recorded in ElevenLabs first; edit visuals to fit timing
- [ ] Music ducks under voiceover (-18 LUFS bed, -3 LUFS VO)
- [ ] All transitions are cuts or 200ms fades; no spinning, no flashy wipes
- [ ] Final renders at 60s ±0.5s, ≤ 30MB H.264 MP4
- [ ] Watch at 1× and 0.5× to spot stutters
- [ ] Color grade: warm-cream text legible on a non-OLED screen at 1×
- [ ] Export filenames: `assets/submission/demo.mp4`, `assets/submission/tech.mp4`

## Submission text (paste into form)

> **PatchMarket** is an L402 escrow protocol where coding agents buy verified
> red-to-green CI fixes from worker agents and pay over Lightning. Live buyer
> agent reasons about offers via OpenAI tool-calling, hits a real 402
> challenge, retries with L402 proof, solves an Agent CAPTCHA, and waits for
> a real Node subprocess to verify the patch. Only then does escrow release.
> Built in 36 hours at HackNation 2026.
>
> Repo: `github.com/...`  •  Demo: `npm run showtime` then open
> `http://localhost:3000/?demo=1`.
