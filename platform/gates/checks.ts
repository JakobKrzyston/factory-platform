/** Runs a repository's typecheck, lint and test scripts inside the OS sandbox. Exports runChecks, committedChecks,
 *  sandboxSettings and CHECK_NAMES. */
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHECK_NAMES = ["typecheck", "lint", "test"] as const;

const SRT = join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/.bin/srt");
// Three checks must fit inside the stop hook's 600 s timeout in scripts/run-issue.sh.
const CHECK_TIMEOUT_MS = 180_000;

export type Check = { name: string; script: string };
export type CheckResult = { name: string; ok: boolean; exitCode: number | null; seconds: number; output: string };

/** Reads the check scripts from package.json as committed at HEAD, not as it is on disk.
 *  The agent cannot commit, so editing or deleting a script in its working copy does not change what the gate runs.
 *  Args: dir: a git checkout.
 *  Returns: the checks among CHECK_NAMES that package.json defines, in that order; none without a package.json. */
export function committedChecks(dir: string): Check[] {
  let pkg: { scripts?: Record<string, unknown> };
  try {
    pkg = JSON.parse(execFileSync("git", ["show", "HEAD:package.json"], { cwd: dir, encoding: "utf8", stdio: "pipe" }));
  } catch {
    return [];
  }
  return CHECK_NAMES.flatMap((name) => {
    const script = pkg.scripts?.[name];
    return typeof script === "string" ? [{ name, script }] : [];
  });
}

/** Builds the sandbox-runtime settings that confine a check to `dir`, like the agent's own Bash sandbox.
 *  The home directory and the temp directory are unreadable, which keeps the owner's files and the run's API key
 *  file out of reach of code the agent wrote; `dir` and the Node installation are re-allowed. No network.
 *  Args: dir: the checkout the checks run in.
 *  Returns: an object to write as srt's settings file. */
export function sandboxSettings(dir: string) {
  const nodeInstall = dirname(dirname(process.execPath));
  return {
    filesystem: { denyRead: [homedir(), tmpdir()], allowRead: [dir, nodeInstall], allowWrite: [dir], denyWrite: [] },
    network: { allowedDomains: [], deniedDomains: [] },
  };
}

/** Runs each check in `dir`, one after another, each inside the sandbox.
 *  A script runs as `npm run` would run it, with the checkout's node_modules/.bin first on PATH, but without npm,
 *  so the working copy's package.json is never consulted.
 *  Args: dir: the checkout; checks: what to run, usually committedChecks(dir).
 *  Returns: one result per check; output is stdout followed by stderr. */
export function runChecks(dir: string, checks: Check[]): CheckResult[] {
  const settingsDir = mkdtempSync(join(tmpdir(), "gates-"));
  const settingsFile = join(settingsDir, "srt-settings.json");
  writeFileSync(settingsFile, JSON.stringify(sandboxSettings(dir)));
  try {
    return checks.map(({ name, script }) => {
      const started = Date.now();
      const run = spawnSync(SRT, ["--settings", settingsFile, "-c", script], {
        cwd: dir,
        env: { ...process.env, PATH: `${join(dir, "node_modules/.bin")}:${process.env.PATH}` },
        encoding: "utf8",
        timeout: CHECK_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
      });
      // ETIMEDOUT after CHECK_TIMEOUT_MS, or srt failing to start.
      const error = run.error ? `\n${run.error.message}` : "";
      return {
        name,
        ok: run.status === 0,
        exitCode: run.status,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        output: `${run.stdout ?? ""}${run.stderr ?? ""}${error}`,
      };
    });
  } finally {
    rmSync(settingsDir, { recursive: true, force: true });
  }
}
