import type { CollectorState } from "../shared/api.ts";
export type { CollectorState } from "../shared/api.ts";
/**
 * What one cycle achieved:
 * - `true`: succeeded; resets failure counters, offline state, and pause circuit breaker.
 * - `"transient"`: recoverable failure (e.g. wake/network blip); keeps normal interval, counts toward
 *   `maxConsecutiveFailures` if configured so repeated non-offline errors still trip the circuit breaker.
 * - `"offline"`: pre-flight DNS or network offline; backs off up to `maxDelayMs` without spawning heavy
 *   subprocesses and never trips the auth pause circuit breaker.
 * - `"pause"`: explicit auth/signed-out failure; trips the persistent pause circuit breaker immediately
 *   until a manual `cycle(true)` or `setEnabled(true)` clears it.
 * - `false`: persistent/non-transient failure; backs off and counts toward `maxConsecutiveFailures`.
 */
export type CollectResult = boolean | "transient" | "offline" | "pause";
export class Collector {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flight: Promise<void> | null = null;
  private stopped = false;
  private transient = false;
  private nonOfflineFailures = 0;
  state: CollectorState;
  constructor(
    private collect: () => Promise<CollectResult>,
    enabled: boolean,
    private save: (state: CollectorState) => void,
    private intervalMs = 60000,
    previous?: Partial<CollectorState>,
    private maxDelayMs = 300000,
    private maxConsecutiveFailures = Infinity,
  ) {
    this.state = {
      enabled,
      running: false,
      intervalMs,
      lastStartedAt: null,
      lastCompletedAt: null,
      nextRunAt: null,
      lastError: previous?.authPaused
        ? (previous.lastError ??
          "Paused after authentication or repeated errors. Click Refresh to resume.")
        : null,
      failureSince: previous?.failureSince ?? null,
      recoveredAt: previous?.recoveredAt ?? null,
      failures: previous?.failures ?? 0,
      authPaused: previous?.authPaused ?? false,
      offline: previous?.offline ?? false,
    };
  }
  private persist() {
    this.save({ ...this.state });
  }
  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state.nextRunAt = null;
  }
  private schedule() {
    this.clear();
    if (this.stopped || !this.state.enabled || this.state.authPaused) return;
    const delay = Math.min(
      this.maxDelayMs,
      this.intervalMs *
        2 ** (this.transient ? 0 : Math.min(4, this.state.failures)),
    );
    this.state.nextRunAt = Date.now() + delay;
    this.timer = setTimeout(() => {
      void this.cycle();
    }, delay);
    this.persist();
  }
  cycle(manual = false): Promise<void> {
    if (this.flight) return this.flight;
    if (this.stopped) return Promise.resolve();
    if (!manual && (!this.state.enabled || this.state.authPaused))
      return Promise.resolve();
    if (manual && this.state.authPaused) {
      this.state.authPaused = false;
      this.nonOfflineFailures = 0;
    }
    this.clear();
    this.state.running = true;
    this.state.lastStartedAt = Date.now();
    this.persist();
    this.flight = (async () => {
      let result: CollectResult = false;
      try {
        result = await this.collect();
      } catch {
        /* Keep background failures bounded and metadata-only. */
      }
      const ok = result === true;
      const offline = result === "offline";
      const explicitPause = result === "pause";
      this.transient = result === "transient";
      if (ok && this.state.failureSince !== null)
        this.state.recoveredAt = Date.now();
      this.state.failureSince = ok
        ? null
        : (this.state.failureSince ?? Date.now());
      this.state.failures = ok ? 0 : this.state.failures + 1;
      this.state.offline = offline;
      if (ok) {
        this.nonOfflineFailures = 0;
        this.state.authPaused = false;
        this.state.lastError = null;
      } else if (offline) {
        this.state.authPaused = false;
        this.state.lastError =
          "Offline or DNS unavailable — waiting for network to recover.";
      } else {
        this.nonOfflineFailures++;
        if (explicitPause || this.nonOfflineFailures >= this.maxConsecutiveFailures) {
          this.state.authPaused = true;
          this.nonOfflineFailures = 0;
          this.state.lastError = explicitPause
            ? "Codex sign-in required; background checks paused until you click Refresh."
            : `Paused after ${this.maxConsecutiveFailures} consecutive errors. Click Refresh to resume.`;
        } else {
          this.state.lastError =
            "Collection did not complete. Retrying automatically.";
        }
      }
      this.state.running = false;
      this.state.lastCompletedAt = Date.now();
      this.persist();
    })().finally(() => {
      this.flight = null;
      this.schedule();
    });
    return this.flight;
  }
  setEnabled(enabled: boolean) {
    this.state.enabled = enabled;
    if (enabled) {
      this.state.authPaused = false;
      this.nonOfflineFailures = 0;
    }
    this.clear();
    this.persist();
    if (enabled && !this.stopped) void this.cycle();
  }
  async stop() {
    this.stopped = true;
    this.clear();
    await this.flight;
    this.state.running = false;
    this.state.nextRunAt = null;
    this.persist();
  }
}
