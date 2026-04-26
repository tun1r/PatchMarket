// PatchMarket architecture deck — six engineering-flavored frames.
// Same nav model as the spectator demo: arrow keys / space, no auto-advance.

const stage = document.querySelector("#arch-stage");
const counter = document.querySelector("#arch-counter");
const labelEl = document.querySelector("#arch-label");

const scenes = [
  { id: "cold", label: "cold open", build: buildCold },
  { id: "system", label: "system map", build: buildSystem },
  { id: "fsm", label: "escrow fsm", build: buildFsm },
  { id: "captcha", label: "agent captcha", build: buildCaptcha },
  { id: "l402", label: "l402 exchange", build: buildL402 },
  { id: "verifier", label: "verifier subprocess", build: buildVerifier },
  { id: "source", label: "source + ship", build: buildSource }
];

let index = 0;
let current = null;
let leaving = false;

mount(index);

window.addEventListener("keydown", (e) => {
  const tag = (e.target?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key === "ArrowRight" || e.key === " ") {
    e.preventDefault();
    advance(1);
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    advance(-1);
  } else if (e.key === "Escape") {
    e.preventDefault();
    index = 0;
    swap();
  }
});

function advance(step) {
  const next = Math.min(scenes.length - 1, Math.max(0, index + step));
  if (next === index) return;
  index = next;
  swap();
}

function swap() {
  if (leaving) return;
  if (!current) {
    mount(index);
    return;
  }
  leaving = true;
  current.classList.add("is-leaving");
  setTimeout(() => {
    stage.innerHTML = "";
    leaving = false;
    mount(index);
  }, 200);
}

function mount(i) {
  const scene = scenes[i];
  const node = scene.build();
  stage.appendChild(node);
  // Force reflow then add is-playing so the entrance animation runs.
  // eslint-disable-next-line no-unused-expressions
  node.getBoundingClientRect();
  node.classList.add("is-playing");
  current = node;
  counter.textContent = `${pad2(i + 1)} · ${pad2(scenes.length)}`;
  labelEl.textContent = scene.label;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function frame(className, html) {
  const el = document.createElement("section");
  el.className = `arch-frame ${className}`;
  el.innerHTML = html;
  return el;
}

// ---------- Scene 01 — Cold open ----------
function buildCold() {
  return frame(
    "scene-cold",
    `
    <span class="eyebrow">cold open · 01 of 07</span>
    <h2 class="title">PatchMarket runs on three processes.</h2>
    <ul class="subtitle-bullets">
      <li>Buyer side runs real OpenAI tool calls.</li>
      <li>Worker daemon is a separate PID that spawns Claude Code on demand.</li>
      <li>Verifier is a real Node subprocess in a temp worktree.</li>
      <li>One command starts all three.</li>
    </ul>
    <div class="cold-blocks">
      <div class="cold-block byr">
        <span class="block-role">buyer · pid A</span>
        <div class="block-name">Buyer agent</div>
        <div class="block-file">src/buyer.mjs</div>
        <p class="block-desc">OpenAI Responses API tool calls. Detects red CI, scores offers, drives the protocol.</p>
      </div>
      <div class="cold-block svr">
        <span class="block-role">server · pid B</span>
        <div class="block-name">PatchMarket server</div>
        <div class="block-file">src/server.mjs</div>
        <p class="block-desc">HTTP on :3000. Owns the escrow FSM, gates claim with L402, signs the verifier proof.</p>
      </div>
      <div class="cold-block wkr">
        <span class="block-role">worker · pid C</span>
        <div class="block-name">PatchPro daemon</div>
        <div class="block-file">bin/patchmarket-worker.mjs</div>
        <p class="block-desc">Polls /v1/jobs/current. On claimed, spawns claude --print, submits the diff.</p>
      </div>
    </div>
    <div class="term-window">
      <div class="term-head">
        <span class="dot dot-r"></span><span class="dot dot-a"></span><span class="dot dot-g"></span>
        <span class="term-path">~/patchmarket — bash</span>
      </div>
      <div class="term-body"><span class="term-line"><span class="term-prompt">$</span> <span class="term-cmd">npm run showtime</span></span><span class="term-line"><span class="term-pfx">[showtime]</span> starting PatchMarket showtime</span><span class="term-line"><span class="term-pfx">[showtime]</span> spectator: http://127.0.0.1:3000/?demo=1</span><span class="term-line"><span class="term-pfx svr">[server]</span>   PatchMarket demo running on http://127.0.0.1:3000</span><span class="term-line"><span class="term-pfx wkr">[worker]</span>   patchpro polling http://127.0.0.1:3000 (pid 14021)</span><span class="term-line"><span class="term-pfx byr">[buyer]</span>    inspecting red CI · auth.test.mjs</span><span class="term-line"><span class="term-pfx wkr">[worker]</span>   worker.online → claiming → patching → submitted</span><span class="term-line"><span class="term-pfx svr">[server]</span>   verify.passed · exit 1 → 0 · 2,800 sats released</span></div>
    </div>
    `
  );
}

// ---------- Scene 02 — System map ----------
function buildSystem() {
  const node = frame(
    "scene-system",
    `
    <span class="eyebrow">system map · 02 of 07</span>
    <h2 class="title">Four components, two trust boundaries.</h2>
    <ul class="subtitle-bullets">
      <li>Buyer never touches the worker process.</li>
      <li>Worker never touches the verifier subprocess.</li>
      <li>Server brokers everything between them.</li>
      <li>Verifier runs in a temp worktree with the network disabled.</li>
    </ul>
    <div class="system-canvas">
      <svg class="system-svg" viewBox="0 0 1280 540" preserveAspectRatio="none">
        <defs>
          <marker id="arrowhead" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 z" fill="rgba(212, 161, 85, 0.6)"/>
          </marker>
        </defs>
        <!-- buyer (140,80) → server (640,80) -->
        <path class="flow" d="M 280 80 C 380 80, 500 80, 600 80" marker-end="url(#arrowhead)"/>
        <text class="flow-label" x="380" y="64">POST /v1/jobs/fix · /select · /claim · /captcha · /verify</text>
        <!-- server → worker -->
        <path class="flow" d="M 880 80 C 940 80, 1020 80, 1080 80" marker-end="url(#arrowhead)"/>
        <text class="flow-label" x="900" y="64">GET /v1/jobs/current · poll 700ms</text>
        <!-- worker → server (back) - posts patch -->
        <path class="flow" d="M 1080 110 C 1020 130, 940 140, 880 130" marker-end="url(#arrowhead)"/>
        <text class="flow-label" x="900" y="158">POST /v1/jobs/:id/patch · /worker-events</text>
        <!-- server → verifier (subprocess fork) -->
        <path class="flow" d="M 740 130 C 740 240, 700 320, 700 440" marker-end="url(#arrowhead)"/>
        <text class="flow-label" x="760" y="280">spawn(node --test) in temp worktree</text>
        <!-- verifier → server (proof) -->
        <path class="flow" d="M 600 440 C 580 320, 580 240, 600 130" marker-end="url(#arrowhead)"/>
        <text class="flow-label" x="430" y="280">VerificationProof · HMAC signed</text>
      </svg>
      <div class="system-node buyer">
        <span class="role">buyer · pid A</span>
        <div class="name">Buyer agent</div>
        <div class="file">src/buyer.mjs · 613 lines</div>
        <p class="desc">OpenAI Responses API tool-calling. Detects red CI, scores offers, drives the protocol. Falls back to scripted on key absent.</p>
      </div>
      <div class="system-node server">
        <span class="role">server · pid B</span>
        <div class="name">PatchMarket server</div>
        <div class="file">src/server.mjs · 382 lines</div>
        <p class="desc">HTTP on :3000. Owns the escrow FSM, issues L402 challenge, validates proof, signs claim credential, runs verifier.</p>
      </div>
      <div class="system-node worker">
        <span class="role">worker · pid C</span>
        <div class="name">PatchPro daemon</div>
        <div class="file">bin/patchmarket-worker.mjs · 195 lines</div>
        <p class="desc">Polls /v1/jobs/current. On state=claimed, submits the patch. Emits worker.online → submitted → awaiting_release.</p>
      </div>
      <div class="system-node verifier">
        <span class="role">verifier · spawned</span>
        <div class="name">Temp-worktree runner</div>
        <div class="file">src/verifier.mjs · 237 lines</div>
        <p class="desc">Copies fixture to /tmp/patchmarket-verify-*. spawn(node --test). Real exit code. Signs proof over before/after log hashes.</p>
      </div>
    </div>
    `
  );
  return node;
}

// ---------- Scene 03 — Escrow FSM ----------
function buildFsm() {
  // Layout: happy path along the top, branches drop below for failure states.
  const states = [
    { id: "posted", label: "posted", x: 80, y: 100, kind: "happy" },
    { id: "payment_required", label: "payment_required", x: 240, y: 100, kind: "happy" },
    { id: "paid", label: "paid", x: 420, y: 100, kind: "happy" },
    { id: "captcha_required", label: "captcha_required", x: 580, y: 100, kind: "happy" },
    { id: "claimed", label: "claimed", x: 760, y: 100, kind: "happy" },
    { id: "running", label: "running", x: 900, y: 100, kind: "happy" },
    { id: "submitted", label: "submitted", x: 1040, y: 100, kind: "happy" },
    { id: "verifying", label: "verifying", x: 1180, y: 100, kind: "happy" },
    { id: "verified", label: "verified", x: 1180, y: 220, kind: "happy" },
    { id: "released", label: "released", x: 1040, y: 220, kind: "final" },
    { id: "verification_failed", label: "verification_failed", x: 900, y: 320, kind: "fail" },
    { id: "timeout", label: "timeout", x: 760, y: 320, kind: "fail" },
    { id: "runner_failed", label: "runner_failed", x: 600, y: 320, kind: "fail" },
    { id: "rejected", label: "rejected", x: 440, y: 320, kind: "fail" },
    { id: "refunded", label: "refunded", x: 280, y: 320, kind: "fail" },
    { id: "expired", label: "expired", x: 120, y: 320, kind: "fail" }
  ];

  const happyChain = [
    ["posted", "payment_required"],
    ["payment_required", "paid"],
    ["paid", "captcha_required"],
    ["captcha_required", "claimed"],
    ["claimed", "running"],
    ["running", "submitted"],
    ["submitted", "verifying"],
    ["verifying", "verified"],
    ["verified", "released"]
  ];

  const failEdges = [
    ["claimed", "timeout"],
    ["running", "timeout"],
    ["running", "runner_failed"],
    ["verifying", "verification_failed"],
    ["payment_required", "expired"],
    ["payment_required", "rejected"],
    ["paid", "refunded"]
  ];

  const stateById = Object.fromEntries(states.map((s) => [s.id, s]));
  const stateW = 132;
  const stateH = 36;

  function rect(s) {
    const cls = `fsm-state${s.kind === "fail" ? " is-fail" : s.kind === "final" ? " is-final" : " is-on"}`;
    return `<rect class="${cls}" x="${s.x - stateW / 2}" y="${s.y - stateH / 2}" rx="6" ry="6" width="${stateW}" height="${stateH}"/><text class="fsm-label" x="${s.x}" y="${s.y + 4}">${s.label}</text>`;
  }

  function path([a, b], { fail = false } = {}) {
    const A = stateById[a];
    const B = stateById[b];
    const ax = A.x;
    const ay = A.y + (B.y > A.y ? stateH / 2 : B.y < A.y ? -stateH / 2 : 0);
    const bx = B.x + (B.x > A.x ? -stateW / 2 : B.x < A.x ? stateW / 2 : 0);
    const by = B.y + (B.y > A.y ? -stateH / 2 : B.y < A.y ? stateH / 2 : 0);
    const cls = `fsm-edge${fail ? " fail" : ""}`;
    const arrowFill = fail ? "fsm-arrow fail" : "fsm-arrow";
    // Compute arrow head triangle pointing along the direction.
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const aSize = 5;
    const tipX = bx;
    const tipY = by;
    const baseX = bx - ux * aSize * 1.6;
    const baseY = by - uy * aSize * 1.6;
    const leftX = baseX + px * aSize;
    const leftY = baseY + py * aSize;
    const rightX = baseX - px * aSize;
    const rightY = baseY - py * aSize;
    return `
      <path class="${cls}" d="M ${ax} ${ay} C ${ax + dx * 0.3} ${ay}, ${bx - dx * 0.3} ${by}, ${baseX} ${baseY}"/>
      <polygon class="${arrowFill}" points="${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}"/>
    `;
  }

  const svg = `
    <svg viewBox="0 0 1280 380" preserveAspectRatio="xMidYMid meet">
      ${happyChain.map((e) => path(e)).join("")}
      ${failEdges.map((e) => path(e, { fail: true })).join("")}
      ${states.map(rect).join("")}
    </svg>
  `;

  return frame(
    "scene-fsm",
    `
    <span class="eyebrow">escrow finite state machine · 03 of 07</span>
    <h2 class="title">16 states, every transition signed.</h2>
    <ul class="subtitle-bullets">
      <li>State diagram is real, lifted from <code>src/core.mjs</code>.</li>
      <li>Solid amber path is the happy line.</li>
      <li>Dashed terracotta paths are the failure branches.</li>
      <li>Worker only earns sats from <code>released</code>.</li>
    </ul>
    <div class="fsm-canvas">${svg}</div>
    <div class="fsm-legend">
      <span><span class="swatch happy"></span>active path</span>
      <span><span class="swatch fail"></span>failure branch</span>
      <span><span class="swatch final"></span>terminal · payout</span>
    </div>
    `
  );
}

// ---------- Scene 04 — Agent CAPTCHA security ----------
function buildCaptcha() {
  const code = `<span class="ln">463</span><span class="kw">const</span> data = crypto.<span class="fn">randomBytes</span>(<span class="num">32</span>);
<span class="ln">464</span><span class="kw">const</span> nonce = crypto.<span class="fn">randomUUID</span>();
<span class="ln">465</span><span class="kw">const</span> sessionId = <span class="str">\`captcha_\${</span>...<span class="str">}\`</span>;
<span class="ln">466</span><span class="kw">const</span> token = <span class="fn">hashText</span>(<span class="str">\`...\`</span>).<span class="fn">slice</span>(<span class="num">0</span>, <span class="num">32</span>);
<span class="ln">467</span><span class="kw">const</span> program = [
<span class="row hi"><span class="ln">468</span>  { op: <span class="str">"reverse_xor"</span>,    start: <span class="num">0</span>,  length: <span class="num">16</span>, key: <span class="num">0xa3</span> },
<span class="ln">469</span>  { op: <span class="str">"sum_mod_repeat"</span>, start: <span class="num">16</span>, length: <span class="num">16</span>, repeat: <span class="num">8</span> },
<span class="ln">470</span>  { op: <span class="str">"sha256_truncate"</span>, start: <span class="num">0</span>, length: <span class="num">32</span>, bytes: <span class="num">8</span> }</span>
<span class="ln">471</span>];
<span class="ln">472</span><span class="kw">const</span> answer = <span class="fn">solveAgentCaptchaProgram</span>(data, program);
<span class="ln">473</span>
<span class="ln">474</span>job.agentCaptcha = {
<span class="ln">475</span>  sessionId, token,
<span class="ln">476</span>  dataB64: data.<span class="fn">toString</span>(<span class="str">"base64"</span>),
<span class="ln">477</span>  program, nonce,
<span class="row hi"><span class="ln">486</span>  expiresAt: <span class="kw">new</span> <span class="fn">Date</span>(<span class="fn">Date</span>.<span class="fn">now</span>() + <span class="num">30</span> * <span class="num">1000</span>).<span class="fn">toISOString</span>(),
<span class="ln">488</span>  answerHash: <span class="fn">hashText</span>(answer),
<span class="ln">489</span>  solved: <span class="kw">false</span></span>
<span class="ln">491</span>};`;

  return frame(
    "scene-captcha",
    `
    <span class="eyebrow">agent-only captcha · claim gate · 04 of 07</span>
    <h2 class="title">Agent-only CAPTCHA. NOT for Humans.</h2>
    <ul class="subtitle-bullets">
      <li>Server issues 32 random bytes plus a 3-step byte-transform program.</li>
      <li>Solver runs the program, concats outputs, SHA-256 hashes for the answer.</li>
      <li>Final proof: HMAC the answer with the server nonce.</li>
      <li>Single-use, time-bounded, replay-proof. A claim gate, not a humanness proof.</li>
    </ul>

    <div class="captcha-grid">
      <div class="code-pane">
        <div class="pane-head"><span class="accent">src/core.mjs</span><span>issueAgentCaptcha()</span></div>
        <pre>${code}</pre>
      </div>
      <div class="captcha-rules">
        <div class="rule">
          <span class="rule-tag">01</span>
          <div>
            <strong>Unpredictable</strong>
            <p><code>crypto.randomBytes(32)</code> — every challenge is fresh. No precompute attack possible.</p>
          </div>
        </div>
        <div class="rule">
          <span class="rule-tag">02</span>
          <div>
            <strong>Time-bounded</strong>
            <p><code>expiresAt = +30s</code>. Server checks before validating, rejects with <code>agent_captcha.expired</code>.</p>
          </div>
        </div>
        <div class="rule">
          <span class="rule-tag">03</span>
          <div>
            <strong>Replay-proof</strong>
            <p><code>solved: false</code> flips on first valid submission. Re-using the same answer rejects with <code>agent_captcha.replayed</code>.</p>
          </div>
        </div>
        <div class="rule">
          <span class="rule-tag">04</span>
          <div>
            <strong>Nonce-bound</strong>
            <p>Final proof is <code>hmac(nonce, answer)</code>. Server recomputes with its stored nonce and compares — answer alone isn't enough.</p>
          </div>
        </div>
        <div class="rule">
          <span class="rule-tag">05</span>
          <div>
            <strong>Server verifies</strong>
            <p>Server stores <code>answerHash</code> only. Submission must satisfy <code>hashText(answer) === answerHash</code> <em>and</em> <code>hmac(nonce, answer)</code>.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="captcha-chain four-stage">
      <div class="chain-step">
        <span class="step-bytes">32 bytes</span>
        <span class="step-name">challenge</span>
        <span class="step-detail">crypto.randomBytes(32) + nonce</span>
      </div>
      <span class="chain-arrow">→</span>
      <div class="chain-program">
        <span class="program-label">3-step program</span>
        <div class="program-step">
          <span class="program-num">①</span>
          <span class="program-op">reverse_xor</span>
          <span class="program-bytes">slice[0..15] ⊕ 0xA3 · 16 B</span>
        </div>
        <div class="program-step">
          <span class="program-num">②</span>
          <span class="program-op">sum_mod_repeat</span>
          <span class="program-bytes">Σ [16..31] % 256, ×8 · 8 B</span>
        </div>
        <div class="program-step">
          <span class="program-num">③</span>
          <span class="program-op">sha256_truncate</span>
          <span class="program-bytes">sha256[0..31] · first 8 B</span>
        </div>
      </div>
      <span class="chain-arrow">→</span>
      <div class="chain-step">
        <span class="step-bytes">hex</span>
        <span class="step-name">answer</span>
        <span class="step-detail">sha256(concat(outputs))</span>
      </div>
      <span class="chain-arrow">→</span>
      <div class="chain-step is-final">
        <span class="step-bytes">proof</span>
        <span class="step-name">hmac(nonce, answer)</span>
        <span class="step-detail">single-use, server-bound</span>
      </div>
    </div>
    `
  );
}

// ---------- Scene 05 — L402 exchange ----------
function buildL402() {
  return frame(
    "scene-l402",
    `
    <span class="eyebrow">l402 protocol exchange · 05 of 07</span>
    <h2 class="title">A real <code style="color:var(--accent);font-size:0.78em">402 Payment Required</code>.</h2>
    <ul class="subtitle-bullets">
      <li>Worker claim is gated by an HTTP 402 response.</li>
      <li>402 carries a <code>WWW-Authenticate: L402</code> header with invoice + amount.</li>
      <li>Buyer retries with a matching <code>Authorization: L402</code> proof.</li>
      <li>No auth → no claim credential → no patch.</li>
    </ul>
    <div class="exchange">
      <div class="xchg-pair">
        <div class="xchg-card">
          <div class="head"><span class="verb req">POST</span><span class="path">/v1/jobs/:id/claim</span></div>
          <pre><span class="lo">// no Authorization header</span>
<span class="lo">{}</span></pre>
        </div>
        <div class="xchg-card hilight">
          <div class="head"><span class="verb res">402</span><span class="path">Payment Required</span></div>
          <pre>WWW-Authenticate: L402 invoiceHash="<span class="hi">a3f2…6b9c</span>", amountSats="<span class="hi">2800</span>"
{
  "paymentOffer": {
    "amountSats": 2800,
    "nonce": "uuid-…",
    "invoiceHash": "a3f2…6b9c",
    "simulatedProof": "sim-proof-…"
  }
}</pre>
        </div>
      </div>
      <div class="xchg-pair">
        <div class="xchg-card">
          <div class="head"><span class="verb req">POST</span><span class="path">/v1/jobs/:id/claim</span></div>
          <pre>Authorization: L402 proof="<span class="hi">sim-proof-…</span>", nonce="<span class="hi">uuid-…</span>", invoiceHash="<span class="hi">a3f2…6b9c</span>"
<span class="lo">{}</span></pre>
        </div>
        <div class="xchg-card">
          <div class="head"><span class="verb res-ok">200</span><span class="path">issues Agent CAPTCHA</span></div>
          <pre>{
  "captcha": {
    "dataB64": "32 random bytes",
    "program": [<span class="lo">/* reverse_xor / sum_mod_repeat / sha256_truncate */</span>],
    "nonce": "…",
    "expiresAt": "+30s"
  }
}</pre>
        </div>
      </div>
      <div class="xchg-pair">
        <div class="xchg-card">
          <div class="head"><span class="verb req">POST</span><span class="path">/v1/jobs/:id/captcha</span></div>
          <pre>{
  "answer": "sha256(concat(steps))",
  "hmac":   "hmac(nonce, answer)"
}</pre>
        </div>
        <div class="xchg-card">
          <div class="head"><span class="verb res-ok">200</span><span class="path">claim credential issued</span></div>
          <pre>{
  "claim": {
    "jobId": "…",
    "workerId": "patchpro",
    "scope": "submit_patch",
    "expiresAt": "+10m",
    "signature": "<span class="hi">hmac(payload)</span>"
  }
}</pre>
        </div>
      </div>
    </div>
    `
  );
}

// ---------- Scene 05 — Verifier subprocess ----------
function buildVerifier() {
  // Real spawn() from src/verifier.mjs:131 and a real proof JSON.
  const code = `<span class="ln">131</span><span class="kw">function</span> <span class="fn">runAcceptance</span>(workDir, fixture) {
<span class="ln">132</span>  <span class="kw">const</span> command = <span class="fn">acceptanceCommand</span>(fixture.acceptanceCommand);
<span class="ln">133</span>  <span class="kw">const</span> startedAt = <span class="fn">Date</span>.<span class="fn">now</span>();
<span class="ln">134</span>
<span class="ln">135</span>  <span class="kw">return</span> <span class="kw">new</span> <span class="fn">Promise</span>((resolve) =&gt; {
<span class="row hi"><span class="ln">136</span>    <span class="kw">const</span> child = <span class="fn">spawn</span>(command.file, command.args, {
<span class="ln">137</span>      cwd: workDir,
<span class="ln">138</span>      env: <span class="fn">verifierEnv</span>(),
<span class="ln">139</span>      stdio: [<span class="str">"ignore"</span>, <span class="str">"pipe"</span>, <span class="str">"pipe"</span>]
<span class="ln">140</span>    });</span>
<span class="ln">141</span>    <span class="kw">let</span> stdout = <span class="str">""</span>, stderr = <span class="str">""</span>;
<span class="ln">142</span>    <span class="kw">const</span> timer = <span class="fn">setTimeout</span>(() =&gt; child.<span class="fn">kill</span>(<span class="str">"SIGKILL"</span>), fixture.timeoutMs);
<span class="ln">143</span>    child.stdout.<span class="fn">on</span>(<span class="str">"data"</span>, (c) =&gt; stdout += c.<span class="fn">toString</span>(<span class="str">"utf8"</span>));
<span class="ln">144</span>    child.stderr.<span class="fn">on</span>(<span class="str">"data"</span>, (c) =&gt; stderr += c.<span class="fn">toString</span>(<span class="str">"utf8"</span>));
<span class="row hi"><span class="ln">145</span>    child.<span class="fn">on</span>(<span class="str">"close"</span>, (code) =&gt; {
<span class="ln">146</span>      resolve({ exitCode: code <span class="kw">??</span> <span class="num">1</span>, log: <span class="fn">normalizeLog</span>(stdout + stderr) });
<span class="ln">147</span>    });</span>
<span class="ln">148</span>  });
<span class="ln">149</span>}`;

  const json = `{
<span class="accent-row">  <span class="key">"jobId"</span><span class="punct">:</span> <span class="str">"job_1777182286961"</span><span class="punct">,</span></span>
  <span class="key">"escrowId"</span><span class="punct">:</span> <span class="str">"escrow_3a9a3da1"</span><span class="punct">,</span>
  <span class="key">"repoHash"</span><span class="punct">:</span> <span class="str">"00bc5288…14f8a"</span><span class="punct">,</span>
<span class="accent-row">  <span class="key">"patchHash"</span><span class="punct">:</span> <span class="str">"06ac86b1…2f7e"</span><span class="punct">,</span></span>
  <span class="key">"commandHash"</span><span class="punct">:</span> <span class="str">"d1d15403…8407"</span><span class="punct">,</span>
  <span class="key">"beforeLogHash"</span><span class="punct">:</span> <span class="str">"b427578c…4d18"</span><span class="punct">,</span>
  <span class="key">"afterLogHash"</span><span class="punct">:</span> <span class="str">"08003c49…a321"</span><span class="punct">,</span>
<span class="accent-row">  <span class="key">"exitCodeBefore"</span><span class="punct">:</span> <span class="num">1</span><span class="punct">,</span>
  <span class="key">"exitCodeAfter"</span><span class="punct">:</span> <span class="num">0</span><span class="punct">,</span></span>
  <span class="key">"verifierVersion"</span><span class="punct">:</span> <span class="str">"patchmarket-live-verifier@0.1.0"</span><span class="punct">,</span>
  <span class="key">"executionMode"</span><span class="punct">:</span> <span class="str">"temp-worktree-runner"</span><span class="punct">,</span>
  <span class="key">"worktreeHash"</span><span class="punct">:</span> <span class="str">"39e6fb53…7da5c"</span><span class="punct">,</span>
  <span class="key">"verifiedAt"</span><span class="punct">:</span> <span class="str">"2026-04-26T05:44:48.399Z"</span><span class="punct">,</span>
  <span class="key">"result"</span><span class="punct">:</span> <span class="str">"passed"</span><span class="punct">,</span>
<span class="accent-row">  <span class="key">"signature"</span><span class="punct">:</span> <span class="str">"ac826dc3…4af79"</span></span>
}`;

  return frame(
    "scene-verifier",
    `
    <span class="eyebrow">verifier subprocess · 06 of 07</span>
    <h2 class="title">Real <code style="color:#c08bd6;font-size:0.78em">spawn()</code>. Real exit code. Signed proof.</h2>
    <ul class="subtitle-bullets">
      <li>Worker doesn't get paid for handing in a diff.</li>
      <li>Worker gets paid only when <code>node --test</code> returns exit 0.</li>
      <li>Subprocess runs in a fresh temp worktree, network disabled.</li>
      <li>Every release binds to seven HMAC-signed hashes.</li>
    </ul>
    <div class="verify-grid">
      <div class="code-pane">
        <div class="pane-head"><span class="accent">src/verifier.mjs</span><span>spawn() · runAcceptance()</span></div>
        <pre>${code}</pre>
      </div>
      <div class="json-pane">
        <div class="pane-head"><span class="accent">VerificationProof</span><span>HMAC-SHA256 over payload</span></div>
        <pre>${json}</pre>
      </div>
    </div>
    `
  );
}

// ---------- Scene 06 — Source map + ship ----------
function buildSource() {
  const tree = [
    { glyph: "├─", file: "src/buyer.mjs", lines: 613, badge: "byr", role: "OpenAI tool calls" },
    { glyph: "├─", file: "src/server.mjs", lines: 382, badge: "svr", role: "HTTP + escrow" },
    { glyph: "├─", file: "src/core.mjs", lines: 934, badge: "svr", role: "FSM + L402 + CAPTCHA" },
    { glyph: "├─", file: "src/verifier.mjs", lines: 237, badge: "vfy", role: "subprocess sandbox" },
    { glyph: "├─", file: "bin/patchmarket-worker.mjs", lines: 195, badge: "wkr", role: "worker daemon" },
    { glyph: "├─", file: "bin/patchmarket-buyer.mjs", lines: 61, badge: "byr", role: "buyer CLI" },
    { glyph: "├─", file: "scripts/showtime.mjs", lines: 167, badge: "svr", role: "orchestrator" },
    { glyph: "├─", file: "public/app.js", lines: 1272, badge: "ui", role: "spectator + scenes" },
    { glyph: "├─", file: "public/scene-stage.css", lines: 918, badge: "ui", role: "demo deck" },
    { glyph: "└─", file: "test/*.test.mjs", lines: 7, badge: "vfy", role: "unit + verifier" }
  ];

  const treeRows = tree
    .map(
      (r) =>
        `<div class="tree-row"><span class="glyph">${r.glyph}</span><span class="file">${r.file} <span class="role" style="color:var(--muted)">${r.role}</span></span><span class="lines">${r.lines.toLocaleString()} loc</span><span class="badge ${r.badge}">${r.badge}</span></div>`
    )
    .join("");

  return frame(
    "scene-source",
    `
    <span class="eyebrow">source + ship · 07 of 07</span>
    <h2 class="title">Runs locally. <code style="color:var(--accent);font-size:0.78em">npm run showtime</code>.</h2>
    <ul class="subtitle-bullets">
      <li>Zero runtime dependencies in the protocol path.</li>
      <li>Node 20+ host. OpenAI Responses API on the buyer side, Claude Code CLI on the worker side.</li>
      <li>Simulated L402 settlement. Real Node subprocess for verification.</li>
      <li>Three smokes:  <code>npm run smoke</code> · <code>smoke:live</code> · <code>smoke:full</code>.</li>
    </ul>
    <div class="source-grid">
      <div class="tree-pane">
        <h3>repo · 4,786 lines · 7 tests · 0 deps</h3>
        ${treeRows}
      </div>
      <div class="ship-pane">
        <div class="ship-block">
          <span class="label">commands</span>
          <div>
            <span class="ship-cmd">npm run showtime</span>
            <span class="ship-cmd">npm run smoke</span>
            <span class="ship-cmd">npm run smoke:live</span>
            <span class="ship-cmd">npm test</span>
          </div>
        </div>
        <div class="ship-block">
          <span class="label">payout binding</span>
          <div class="ship-numbers">
            <div class="num"><span>signed hashes</span><strong>7</strong></div>
            <div class="num"><span>processes</span><strong>3</strong></div>
            <div class="num"><span>escrow states</span><strong>16</strong></div>
          </div>
        </div>
        <div class="ship-block">
          <span class="label">stack</span>
          <div style="color:var(--muted);font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.6;margin-top:6px">
            node 20  ·  openai responses api<br>
            simulated L402  ·  inverse Agent CAPTCHA<br>
            temp-worktree-runner  ·  HMAC-SHA256 proofs
          </div>
        </div>
      </div>
    </div>
    `
  );
}
