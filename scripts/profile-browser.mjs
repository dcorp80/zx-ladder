// Optional external tooling: PLAYWRIGHT_MODULE can point to a Playwright index.mjs.
// Build and serve production first. Artifacts go outside the source tree by default.
import fs from "node:fs/promises";
import os from "node:os";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = process.env.PROFILE_OUTPUT || "/tmp/zx-ladder-profile";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  await page.addInitScript(() => {
    window.measure = {
      paints: [],
      gaps: [],
      messages: 0,
      audio: 0,
      state: null,
    };
    const native = Worker;
    window.Worker = class extends native {
      profileEpoch = 0;
      postMessage(message, ...options) {
        if (typeof message.epoch === "number")
          this.profileEpoch = message.epoch;
        return super.postMessage(message, ...options);
      }
      constructor(...args) {
        super(...args);
        window.emuWorker = this;
        this.addEventListener("message", ({ data }) => {
          if (data.state) window.measure.state = data.state;
          if (data.type === "frame") window.measure.messages++;
          if (data.type === "audio") window.measure.audio++;
        });
      }
    };
    const put = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function (...args) {
      const t = performance.now();
      const result = put.apply(this, args);
      window.measure.paints.push(performance.now() - t);
      return result;
    };
    let previous;
    function frame(t) {
      if (previous !== undefined) window.measure.gaps.push(t - previous);
      previous = t;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  await page.goto(
    process.env.PROFILE_URL || "http://127.0.0.1:4173/zx-ladder/",
  );
  await page.waitForFunction(() => window.measure.state);
  const cdp = await page.context().newCDPSession(page);
  const targets = await cdp.send("Target.getTargets");
  const target = targets.targetInfos.find(
    (t) => t.type === "worker" && t.url.includes("machine.worker"),
  );
  if (!target) throw new Error("Machine worker not found");
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: false,
  });
  let sequence = 0;
  const pending = new Map();
  cdp.on("Target.receivedMessageFromTarget", (e) => {
    if (e.sessionId !== sessionId) return;
    const message = JSON.parse(e.message);
    if (message.id) {
      const p = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) p.reject(message.error);
      else p.resolve(message.result);
    }
  });
  function worker(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      cdp
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch(reject);
    });
  }
  await worker("Profiler.enable");
  await worker("Profiler.setSamplingInterval", { interval: 1000 });
  await cdp.send("Profiler.enable");
  const percentile = (a, p) =>
    a.length
      ? a.slice().sort((a, b) => a - b)[
          Math.min(a.length - 1, Math.floor(a.length * p))
        ]
      : null;
  const summarize = (p) => {
    const nodes = new Map(p.nodes.map((n) => [n.id, n]));
    const weights = new Map();
    let total = 0;
    for (let i = 0; i < p.samples.length; i++) {
      const n = nodes.get(p.samples[i]);
      const dt = p.timeDeltas[i];
      total += dt;
      const f = n.callFrame;
      const name = `${f.functionName || "(anonymous)"} @ ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
      weights.set(name, (weights.get(name) || 0) + dt);
    }
    return [...weights]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([name, us]) => ({
        name,
        ms: Math.round(us / 1000),
        percent: +((us / total) * 100).toFixed(2),
      }));
  };
  async function sample(name, free, turbo, preset, profile = false) {
    await page.getByLabel("Video preset").selectOption(preset);
    await page.getByLabel("Free run (maximum speed)").setChecked(free);
    await page.getByLabel("Turbo CPU", { exact: false }).setChecked(turbo);
    if (await page.getByRole("button", { name: "Run", exact: true }).count())
      await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.waitForTimeout(2000);
    const start = await page.evaluate(() => {
      window.measure.paints = [];
      window.measure.gaps = [];
      window.measure.messages = 0;
      window.measure.audio = 0;
      return { time: performance.now(), ticks: window.measure.state.ticks };
    });
    if (profile) {
      await worker("Profiler.start");
      await cdp.send("Profiler.start");
    }
    await page.waitForTimeout(5000);
    let profiles;
    if (profile) {
      const w = await worker("Profiler.stop");
      const m = await cdp.send("Profiler.stop");
      profiles = { worker: summarize(w.profile), main: summarize(m.profile) };
      await fs.writeFile(
        `${output}/${name}-worker.cpuprofile`,
        JSON.stringify(w.profile),
      );
      await fs.writeFile(
        `${output}/${name}-main.cpuprofile`,
        JSON.stringify(m.profile),
      );
    }
    const end = await page.evaluate(() => ({
      ...window.measure,
      time: performance.now(),
    }));
    const result = {
      name,
      profile,
      slotMHz: (end.state.ticks - start.ticks) / (end.time - start.time) / 1000,
      paintCount: end.paints.length,
      paintP50: percentile(end.paints, 0.5),
      paintP95: percentile(end.paints, 0.95),
      rafP95: percentile(end.gaps, 0.95),
      rafMax: Math.max(...end.gaps),
      messages: end.messages,
      audio: end.audio,
      profiles,
    };
    results.push(result);
    console.log(JSON.stringify({ ...result, profiles: undefined }));
  }
  for (let round = 0; round < 2; round++)
    for (const preset of ["pentagon", "lviv"])
      for (const turbo of [false, true])
        await sample(
          `${preset}-${turbo ? "7" : "3.5"}-r${round}`,
          true,
          turbo,
          preset,
        );
  await sample("rom-normal", false, false, "pentagon", true);
  await sample("rom-free", true, false, "pentagon", true);
  if (process.env.PROFILE_TAPE) {
    const files = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Files", exact: true }),
    });
    await files
      .locator("input[type=file]")
      .setInputFiles(process.env.PROFILE_TAPE);
    await files.getByRole("button", { name: "Load", exact: true }).click();
    await page.waitForFunction(
      () => document.body.textContent.includes("Block 8/8 loaded"),
      null,
      { timeout: 60000 },
    );
    await sample("exolon-free", true, false, "pentagon", true);
    await sample("exolon-normal", false, false, "pentagon", true);
  }
  // Round trips to actual worker task queue, while running. Inspection does not alter CPU state.
  const latency = await page.evaluate(async () => {
    const times = [];
    for (let i = 0; i < 30; i++) {
      const id = 100000 + i;
      const t = performance.now();
      await new Promise((resolve) => {
        const listener = ({ data }) => {
          if (data.type === "reply" && data.id === id) {
            emuWorker.removeEventListener("message", listener);
            resolve();
          }
        };
        emuWorker.addEventListener("message", listener);
        emuWorker.postMessage({
          id,
          epoch: emuWorker.profileEpoch,
          command: { type: "inspect", address: 0, length: 1 },
        });
      });
      times.push(performance.now() - t);
      await new Promise((r) => setTimeout(r, 10));
    }
    return times;
  });
  await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        environment: {
          cpu: os.cpus()[0]?.model,
          arch: os.arch(),
          platform: os.platform(),
          browser: browser.version(),
          headless: true,
        },
        results,
        inspectLatency: {
          p50: percentile(latency, 0.5),
          p95: percentile(latency, 0.95),
          max: Math.max(...latency),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
