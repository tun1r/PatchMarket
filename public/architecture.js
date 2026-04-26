const frames = [...document.querySelectorAll(".arch-frame")];
const progressDots = [...document.querySelectorAll(".progress-dot")];
const prevBtn = document.querySelector("#arch-prev");
const nextBtn = document.querySelector("#arch-next");
const playBtn = document.querySelector("#arch-play");

const params = new URLSearchParams(window.location.search);
let autoplay = params.get("autoplay") !== "0";
let current = 0;
let timer = null;

if (params.get("clean") === "1") {
  document.body.dataset.clean = "1";
}

const frameDurations = [5500, 9000, 9500, 8500, 8500, 6000];

const proofFields = {
  command: document.querySelector("#arch-command"),
  l402: document.querySelector("#arch-l402-header"),
  exitBefore: document.querySelector("#arch-exit-before"),
  exitAfter: document.querySelector("#arch-exit-after"),
  executionMode: document.querySelector("#arch-execution-mode"),
  releasedSats: document.querySelector("#arch-release-sats")
};

const defaults = {
  command: "node --test --test-reporter=tap tests/auth.test.mjs",
  l402: 'WWW-Authenticate: L402 invoiceHash="...", amountSats="2800"',
  exitBefore: 1,
  exitAfter: 0,
  executionMode: "temp-worktree-runner",
  releasedSats: 2800
};

prevBtn?.addEventListener("click", () => goTo(current - 1));
nextBtn?.addEventListener("click", () => goTo(current + 1));
playBtn?.addEventListener("click", () => {
  autoplay = !autoplay;
  syncPlayButton();
  schedule();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" || event.key === " ") {
    event.preventDefault();
    goTo(current + 1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    goTo(current - 1);
  } else if (event.key.toLowerCase() === "p") {
    event.preventDefault();
    autoplay = !autoplay;
    syncPlayButton();
    schedule();
  }
});

await hydrateProof();
syncPlayButton();
goTo(0);

async function hydrateProof() {
  let values = { ...defaults };

  try {
    const response = await fetch("/v1/jobs/current", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      const job = data.job || {};
      const proof = job.verificationProof || {};
      const offer = job.paymentOffer || {};
      values = {
        command: job.fixture?.acceptanceCommand || values.command,
        l402:
          offer.invoiceHash && offer.amountSats
            ? `WWW-Authenticate: L402 invoiceHash="${compactHash(offer.invoiceHash)}", amountSats="${offer.amountSats}"`
            : values.l402,
        exitBefore: proof.exitCodeBefore ?? values.exitBefore,
        exitAfter: proof.exitCodeAfter ?? values.exitAfter,
        executionMode: proof.executionMode || values.executionMode,
        releasedSats: job.reputationEvent?.deltaEarnedSats || values.releasedSats
      };
    }
  } catch {
    // Architecture deck remains deterministic even if API data is absent.
  }

  proofFields.command.textContent = values.command;
  proofFields.l402.textContent = values.l402;
  proofFields.exitBefore.textContent = String(values.exitBefore);
  proofFields.exitAfter.textContent = String(values.exitAfter);
  proofFields.executionMode.textContent = values.executionMode;
  proofFields.releasedSats.textContent = Number(values.releasedSats).toLocaleString();
}

function goTo(index) {
  const normalized = Math.max(0, Math.min(frames.length - 1, index));
  current = normalized;

  frames.forEach((frame, frameIndex) => {
    frame.classList.toggle("is-active", frameIndex === normalized);
  });

  progressDots.forEach((dot, dotIndex) => {
    dot.classList.toggle("is-active", dotIndex === normalized);
  });

  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (!autoplay) return;
  if (current >= frames.length - 1) return;
  timer = setTimeout(() => {
    goTo(current + 1);
  }, frameDurations[current] || 7000);
}

function syncPlayButton() {
  if (!playBtn) return;
  playBtn.textContent = autoplay ? "Pause" : "Play";
}

function compactHash(value) {
  if (!value || value.length < 12) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}
