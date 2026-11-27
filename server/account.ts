import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { numeric, label } from "./privacy.ts";
import type { AccountSnapshot, Observation } from "../shared/types.ts";
import { sortWindows, windowKey } from "../shared/allowance.ts";

export type AccountErrorKind = "error" | "offline" | "auth";
export type NetworkPreflight = () => Promise<boolean>;

const signedOutPattern =
  /not logged in|not signed in|sign[\s-]?in required|login required|auth(?:entication)? required|unauthorized|unauthenticated|invalid.*token|expired.*token|session expired|please log ?in|please sign ?in/i;
const offlineErrorPattern =
  /enotfound|eai_again|no such host|i\/o timeout|network is unreachable|dns|getaddrinfo|econnrefused|ehostunreach|enetunreach|offline/i;

/**
 * Resolve an executable name to an absolute path so background spawns do not rely on a full shell PATH.
 */
export function resolveExecutable(
  executable: string,
  envPath = process.env.PATH ?? "",
  home = homedir(),
): string {
  if (isAbsolute(executable) || executable.includes("/")) return executable;
  const searchDirs = [
    ...envPath.split(":").filter(Boolean),
    join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const dir of [...new Set(searchDirs)]) {
    const candidate = join(dir, executable);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Continue searching. */
    }
  }
  return executable;
}

/**
 * Stripped non-interactive environment for spawning `codex app-server`.
 * Blocks browser/OAuth popups (`NO_BROWSER=1`, `BROWSER=""`, `CI=true`, `NONINTERACTIVE=1`) and omits
 * system browser launcher directories (`/usr/bin`, `/bin`) from `PATH`.
 */
export function headlessCodexEnv(
  base: NodeJS.ProcessEnv = process.env,
  nodeBinDir = dirname(process.execPath),
): NodeJS.ProcessEnv {
  const safePath =
    nodeBinDir && nodeBinDir !== "/usr/bin" && nodeBinDir !== "/bin"
      ? nodeBinDir
      : "";
  const env: NodeJS.ProcessEnv = {
    PATH: safePath,
    NO_BROWSER: "1",
    BROWSER: "",
    CI: "true",
    NONINTERACTIVE: "1",
  };
  for (const key of [
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "CODEX_HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "all_proxy",
    "no_proxy",
    "CDXSCOPE_FIXTURE_STATE",
  ]) {
    if (base[key] !== undefined) env[key] = base[key];
  }
  return env;
}

/**
 * Lightweight DNS pre-flight so CDXScope skips spawning the 20 s `codex app-server` subprocess while
 * offline or when DNS is broken.
 */
export async function defaultNetworkPreflight(
  timeoutMs = 2500,
): Promise<boolean> {
  const resolveWithTimeout = (host: string) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, timeoutMs);
      timer.unref();
      lookup(host)
        .then(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(true);
          }
        })
        .catch(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(false);
          }
        });
    });
  const [a, b] = await Promise.all([
    resolveWithTimeout("chatgpt.com"),
    resolveWithTimeout("api.openai.com"),
  ]);
  return a || b;
}

/**
 * A failed account read. Transient failures can clear without the user doing anything: the network is not back
 * after a wake or a move between networks, the helper was slow, or its connection dropped. Explicit auth/signed-out
 * replies set `kind = "auth"` so the collector pauses instead of retrying forever. Offline DNS pre-flight skips
 * spawning `codex` and sets `kind = "offline"`.
 */
export class AccountReadError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly kind: AccountErrorKind = "error",
  ) {
    super(message);
  }
}

export async function readAccount(
  timeoutMs = 20000,
  executable = process.env.CDXSCOPE_CODEX ?? "codex",
  options?: { preflight?: NetworkPreflight },
): Promise<unknown> {
  if (options?.preflight) {
    const online = await options.preflight().catch(() => false);
    if (!online) {
      throw new AccountReadError(
        "Offline or DNS unavailable — skipped Codex check until network recovers.",
        true,
        "offline",
      );
    }
  }
  const resolvedBin = resolveExecutable(executable);
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolvedBin,
      ["app-server", "--listen", "stdio://", "-c", "analytics.enabled=false"],
      { stdio: ["pipe", "pipe", "ignore"], env: headlessCodexEnv() },
    );
    const lines = createInterface({ input: child.stdout });
    let finished = false;
    const end = (error?: Error, data?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill("SIGTERM");
      const killer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 1500);
      killer.unref();
      if (error) reject(error);
      else resolve(data);
    };
    const timer = setTimeout(
      () =>
        end(
          new AccountReadError(
            "Account read timed out. Local history remains available.",
            true,
          ),
        ),
      timeoutMs,
    );
    child.on("error", () =>
      end(
        new AccountReadError(
          "Codex CLI is unavailable. Set CDXSCOPE_CODEX to its executable path.",
          false,
        ),
      ),
    );
    child.on("exit", () => {
      if (!finished)
        end(
          new AccountReadError(
            "Account connection closed. Check that Codex is signed in.",
            true,
          ),
        );
    });
    const send = (obj: unknown) => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(obj) + "\n");
    };
    child.stdin.on("error", () =>
      end(new AccountReadError("Account connection unavailable.", true)),
    );
    lines.on("line", (line) => {
      if (line.length > 2_000_000)
        return end(
          new AccountReadError(
            "Account response exceeded the supported size.",
            false,
          ),
        );
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id === 1) {
        if (msg.error)
          return end(
            new AccountReadError("Account initialization failed.", false),
          );
        send({ method: "initialized" });
        send({ id: 2, method: "account/rateLimits/read" });
      } else if (msg.id === 2) {
        if (msg.error) {
          const rawMessage =
            typeof msg.error?.message === "string" ? msg.error.message : "";
          const rawCode = msg.error?.code;
          if (rawCode === 401 || signedOutPattern.test(rawMessage)) {
            return end(
              new AccountReadError(
                "Codex sign-in required; background checks paused to avoid repeated retries. Sign in through Codex, then click Refresh.",
                false,
                "auth",
              ),
            );
          }
          if (offlineErrorPattern.test(rawMessage)) {
            return end(
              new AccountReadError(
                "Offline or DNS unavailable — waiting for network to recover.",
                true,
                "offline",
              ),
            );
          }
          return end(
            new AccountReadError(
              "Account usage is unavailable. If this persists, sign in through Codex; CDXScope does not change authentication.",
              true,
            ),
          );
        }
        end(undefined, msg.result);
      } else if (msg.method && msg.id != null) {
        // Reject every server-initiated action. This adapter only reads account limits.
        send({
          id: msg.id,
          error: {
            code: -32601,
            message: "Unsupported by read-only CDXScope",
          },
        });
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "cdxscope",
          title: "CDXScope",
          version: "0.2.3",
        },
        capabilities: { experimentalApi: true },
      },
    });
  });
}
export function accountObservations(
  raw: any,
  hash: (v: unknown) => string,
  at = Date.now(),
): Observation[] {
  if (!raw || typeof raw !== "object")
    throw new Error("Invalid account response.");
  // The installed app-server schema defines accountId as a nullable, backend-supplied
  // identity for this exact usage snapshot. Never infer it from plan, email or old reads.
  const known =
    typeof raw.accountId === "string" && /^\S{1,512}$/u.test(raw.accountId);
  const account = known ? hash(raw.accountId) : `unattributed:${randomUUID()}`;
  const buckets =
    raw.rateLimitsByLimitId && Object.keys(raw.rateLimitsByLimitId).length
      ? raw.rateLimitsByLimitId
      : { [raw.rateLimits?.limitId ?? "codex"]: raw.rateLimits };
  const result: Observation[] = [];
  for (const [key, b] of Object.entries(buckets) as [string, any][]) {
    if (!b) continue;
    for (const slot of ["primary", "secondary"] as const) {
      const w = b[slot],
        used = numeric(w?.usedPercent);
      if (used === null || used < 0 || used > 100) continue;
      result.push({
        account,
        identity: known ? "provider" : "unknown",
        bucket: label(key),
        slot,
        at,
        used,
        duration: numeric(w.windowDurationMins),
        reset: numeric(w.resetsAt),
        plan: b.planType ? label(b.planType) : null,
        source: "account",
        resetCredits: numeric(raw.rateLimitResetCredits?.availableCount),
        balance:
          typeof b.credits?.balance === "string" &&
          /^\d+(\.\d+)?$/.test(b.credits.balance)
            ? b.credits.balance
            : null,
      });
    }
  }
  if (!result.length)
    throw new Error("Account returned no supported allowance windows.");
  return result;
}

export function accountSnapshot(
  raw: unknown,
  hash: (v: unknown) => string,
  previous?: AccountSnapshot,
  at = Date.now(),
): AccountSnapshot {
  const windows = sortWindows(accountObservations(raw, hash, at));
  const id = randomUUID(),
    account = windows[0].account,
    identity = windows[0].identity!;
  const membership = (values: Observation[]) =>
    JSON.stringify(sortWindows(values).map((o) => [windowKey(o), o.duration]));
  const continuous =
    identity === "provider" &&
    previous?.identity === "provider" &&
    previous.account === account &&
    membership(previous.windows) === membership(windows);
  const continuity = continuous ? previous.continuity : id;
  return {
    id,
    at,
    account,
    identity,
    continuity,
    windows: windows.map((o) => ({ ...o, continuity })),
  };
}
