# PatchMarket Submission Video Scripts — locked

Two scripts for HackNation submission. Demo video tells the story. Tech
video explains the architecture. Both target ~90 seconds, both built
around arrow-key advance through the spectator / architecture decks.

Recorded at 1920×1080×60fps via OBS, edited in DaVinci Resolve, H.264 MP4.
Voiceover via ElevenLabs ("Adam" or "Daniel") — same voice both videos for
brand consistency.

---

## Demo Video — 90 seconds

**Tone:** developer-to-developer, conversational. Opens warm and gets
sharper. The first 8 seconds are gentle ("we all dread this") to land the
emotional hook; everything after sharpens to declarative product voice.

**Voice direction:** slightly weary opening, then confident.

```
[SLIDE 0: Quota screenshot — 100% used, full-frame, slow zoom into "100% used"]

We've all been there: you're deep in the zone, coding with your agent,
and suddenly—it burns through your quota and stops cold.

[NEXT → SLIDE 1: Cover (PatchMarket wordmark + 3 pillars)]

Enter PatchMarket. What if your agent could simply hire someone else's
agent — one with quota to spare?

[NEXT → SLIDE 2: CI Failed (bug-line highlighted code panel)]

Let's look at a real failing auth test. Instead of burning your budget
on endless retries, your agent posts a bounded job to our marketplace.
It shares the exact command that defines a passing grade.

[NEXT → SLIDE 3: Bidding (two cards, winner stripe drops on PatchPro)]

Instantly, worker agents quote the job. Your buyer agent compares price,
pass rates, and latency, then selects the most efficient worker, PatchPro,
for the lowest cost to green. Zero human intervention.

[NEXT → SLIDE 4: Delegating — SILENT, ~2s, buyer→worker arrow lands]

[NEXT → SLIDE 5: 402 Payment Required (big amber 402)]

The transaction hits a 402 Payment gate. The buyer proves payment,

[NEXT → SLIDE 6: Agent CAPTCHA (Human ✗ vs Agent ✓ + chain)]

clears a 30-second agent-only CAPTCHA, and unlocks the job. This is true
agent-to-agent commerce.

[NEXT → SLIDE 7: Patch (typewriter diff)]

The worker operates securely in an isolated sandbox—your repo never leaves
your machine.

[NEXT → SLIDE 8: Tests Green (exit 1 → exit 0)]

A verifier runs the failing test, applies the patch, and cryptographically
signs the shift from "exit 1" to "exit 0".

[NEXT → SLIDE 9: Bug Fixed — SILENT, ~2s, resolved diff lands]

[NEXT → SLIDE 10: Sats Released (2,800 sats glow)]

2,800 sats are released over Lightning,

[NEXT → VS CODE CUT: pre-recorded clip of git gutter lighting up
                     on fixtures/red-ci/src/auth.mjs]

and the verified fix lands directly in your repo, lighting up the diff
in your editor.

[NEXT → CLOSER: PatchMarket wordmark + GitHub URL]

Stop paying for tokens. Start paying for verified outcomes. PatchMarket:
the future of agentic commerce.
```

**Word count:** ~225 words at 150 wpm = ~90 seconds (with the silent quota
beat at 0:00 and the 2-second silent transitions on Delegating + Bug Fixed).

### Production cues

- **Quota screenshot (0:00):** Music *out*. Single piano note or muted
  breath. The silence is the held-breath everyone takes when they see
  this screen for real.
- **Hard cut at 0:08:** Music drops in *exactly* on the cut to the cover.
  Don't fade — the camera blinks open.
- **Mid-sentence cut at "402 → CAPTCHA":** the comma in *"The buyer proves
  payment, [NEXT] clears a 30-second…"* — practice this; it keeps energy
  across the slide change.
- **Mid-sentence cut at "Sats → VS Code":** same trick on the comma after
  *"2,800 sats are released over Lightning,"*.
- **VS Code cut:** pre-record this separately. File at red baseline, click
  Apply To Workspace in the browser, capture the gutter lighting up on
  line 2. Use SCM side-by-side diff view for the cleanest before/after.

---

## Tech Video — 90 seconds

**Tone:** a friendly architect walking a colleague through the system.
Confident but conversational — not lecturing. Plain words over jargon.
Trust the visuals to carry the precise specifics.

**Voice direction:** natural pace, slight pause before the closer.

```
[SLIDE 1: Cold open — terminal showing npm run showtime + 3 process blocks]

PatchMarket is three processes working together. A buyer agent, a
marketplace, and a worker agent. One command starts them all.

[NEXT → SLIDE 2: System map (animated SVG, 4 nodes + flow arrows)]

The buyer talks only to the marketplace. The marketplace finds workers,
handles payment, and runs the test. The worker writes code in its own
sandbox. No one talks directly to anyone else.

[NEXT → SLIDE 3: Escrow FSM (16-state graph)]

Every job moves through a clear sequence — posted, paid, claimed, verified,
released. Failures branch off into their own states. The worker earns
money only from one ending — released.

[NEXT → SLIDE 4: Agent CAPTCHA (code excerpt + 5 rules + transform chain)]

Before claiming a job, the worker has to prove it's an agent. We give it
32 random bytes and a small puzzle to solve in 30 seconds. Easy for code,
impossible for a human typing by hand.

[NEXT → SLIDE 5: L402 exchange (HTTP request/response pairs)]

Payment is gated. When the worker tries to claim, the server responds
with a 402 — like a paywall on the web. The buyer pays, retries, the
gate opens. This is Lightning's HTTP layer.

[NEXT → SLIDE 6: Verifier subprocess (spawn() code + signed proof JSON)]

Here's the important part. When the worker submits a patch, an independent
verifier applies it in a sandbox and reruns the failing test. If the test
passes, the worker gets paid. If it doesn't, no one does.

[NEXT → SLIDE 7: Source + ship (file tree + commands)]

Five thousand lines of code. Zero runtime dependencies. Any buyer
framework. Any worker model. One open, neutral protocol. Runs entirely
locally.

[*beat — hold on slide*]

We didn't build another coding assistant. We built the economy for them.
PatchMarket.
```

**Word count:** ~225 words at ~150 wpm = ~90 seconds.

### Production cues

- **No music for first 4 seconds.** Let the cold-open terminal type clean.
- **Music enters under "marketplace" at slide 2.** Sits at -22 LUFS so
  VO is fully on top.
- **Slide 6 punchline:** *"If the test passes, the worker gets paid. If
  it doesn't, no one does."* — slight pace drop, slight emphasis. This
  is the thesis sentence of the entire video. Don't rush it.
- **Slide 7 → closer beat:** ~1 second silent pause between *"Runs
  entirely locally."* and *"We didn't build another coding assistant."*
  The pause separates the architectural summary from the meta-claim.
- **Closer hold:** wordmark stays on screen for ~1.5 seconds after the
  final word. Music tail.

---

## Recording flow (both videos)

**Pre-flight:**

```sh
PATCHMARKET_WORKER_ENGINE=claude-code npm run showtime
```

Browser to one of:
- `http://localhost:3000/?demo=1` (demo deck)
- `http://localhost:3000/architecture.html` (architecture deck)

F11 for full-screen. F5 to reset. Arrow → at each NEXT marker.

**Recording settings (OBS):**
- 1920×1080, 60fps
- NVENC or x264, target ≤30MB final export
- Display Capture, single monitor
- Mic muted (record VO separately)

**Editing (DaVinci Resolve):**
- Drop OBS recording into V1, voiceover into A1, music into A2
- Trim slide segments to match VO timing
- Music ducks under VO (-22 LUFS bed, -3 LUFS VO)
- Cuts only or 200ms fades — no fancy transitions
- Export H.264, 1080p60, target 60-90s ±0.5s

**Submission:**
- `assets/submission/demo.mp4`
- `assets/submission/tech.mp4`
- Watch each at 1× and 0.5× to spot stutters
- Reset the fixture before final take if you used Apply

---

## Submission text

> **PatchMarket** is an open protocol where coding agents buy verified
> red-to-green CI fixes from worker agents and pay over Lightning. A live
> buyer agent reasons about offers, hits a real 402 challenge, retries
> with L402 proof, solves an Agent CAPTCHA, and waits for a real Node
> subprocess to verify the patch. Only then does escrow release. Built in
> 36 hours at HackNation 2026.
>
> Repo: `github.com/...` • Demo: `npm run showtime` then open
> `http://localhost:3000/?demo=1`.
