import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Configuration {
  root: string;
  dataDir: string;
  port: number;
  codex: string;
  settingsPath: string;
  legacy: boolean;
  logRoot?: string;
}

export function configuration(
  root = resolve(import.meta.dirname, ".."),
  env = process.env,
  home = homedir(),
): Configuration {
  const base = join(home, "Library", "Application Support", "CDXScope");
  const settingsPath = resolve(
    env.CDXSCOPE_CONFIG ?? join(base, "settings.json"),
  );
  let saved: {
    dataDir?: string;
    port?: number;
    codex?: string;
    logRoot?: string;
  } = {};
  if (existsSync(settingsPath)) {
    saved = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (
      !saved ||
      typeof saved !== "object" ||
      (saved.dataDir !== undefined && typeof saved.dataDir !== "string") ||
      (saved.codex !== undefined && typeof saved.codex !== "string") ||
      (saved.logRoot !== undefined && typeof saved.logRoot !== "string")
    )
      throw Error(
        "Invalid CDXScope settings. Restore a valid settings.json or use CDXSCOPE_CONFIG.",
      );
  }
  const port = Number(env.PORT ?? saved.port ?? 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("PORT must be an integer between 1024 and 65535.");
  const legacyDir = join(root, ".local");
  if (
    !env.CDXSCOPE_DATA_DIR &&
    saved.dataDir &&
    resolve(saved.dataDir) !== legacyDir &&
    !existsSync(join(saved.dataDir, "cdxscope.sqlite")) &&
    existsSync(join(legacyDir, "cdxscope.sqlite"))
  ) {
    throw Error(
      "Saved history location is unavailable and this checkout contains existing history. Set CDXSCOPE_DATA_DIR to the intended history directory and reinstall; the existing data was preserved.",
    );
  }
  const legacy =
    !env.CDXSCOPE_DATA_DIR &&
    !saved.dataDir &&
    existsSync(join(legacyDir, "cdxscope.sqlite"));
  return {
    root,
    settingsPath,
    port,
    legacy,
    dataDir: resolve(
      env.CDXSCOPE_DATA_DIR ??
        saved.dataDir ??
        (legacy ? legacyDir : join(base, "data")),
    ),
    logRoot: env.CDXSCOPE_LOG_ROOT ?? saved.logRoot,
    codex: env.CDXSCOPE_CODEX ?? saved.codex ?? "codex",
  };
}
