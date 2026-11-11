/** Runs a repository's typecheck, lint and test scripts inside the OS sandbox. Exports runChecks, baseChecks,
 *  sandboxSettings and CHECK_NAMES. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHECK_NAMES = ["typecheck", "lint", "test"] as const;

// srt's CLI, run with this process's own node. Its node_modules/.bin shim would look `node` up on PATH, which is
// how a `node` planted in the checkout could run before any sandbox exists.
const SRT_CLI = join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/@anthropic-ai/sandbox-runtime/dist/cli.js");
// Three checks must fit inside the stop hook's 600 s timeout in scripts/run-issue.sh.
const CHECK_TIMEOUT_MS = 180_000;

export type Check = { name: string; script: string };
export type CheckResult = { name: string; ok: boolean; exitCode: number | null; seconds: number; output: string };

/** Reads the check scripts from a copy of package.json taken before the agent started, which the agent cannot reach.
 *  Args: packageJson: the path of that copy.
 *  Returns: the checks among CHECK_NAMES it defines, in that order; none when the repository had no package.json.
 *  Raises: when the copy is not valid JSON, so the gate fails closed rather than passing with no checks. */
export function baseChecks(packageJson: string): Check[] {
  if (!existsSync(packageJson)) return [];
  const pkg: { scripts?: Record<string, unknown> } = JSON.parse(readFileSync(packageJson, "utf8"));
  return CHECK_NAMES.flatMap((name) => {
    const script = pkg.scripts?.[name];
    return typeof script === "string" ? [{ name, script }] : [];
  });
}

/** Builds the sandbox-runtime settings that confine a check to `dir`: no network, writes only in `dir`, and no reads
 *  of `denyRead` (the same paths the agent's own Bash sandbox denies). `dir`, the Node installation and srt's own
 *  package stay readable.
 *  Args: dir: the checkout the checks run in; denyRead: absolute paths code the agent wrote must not read.
 *  Returns: an object to write as srt's settings file. */
export function sandboxSettings(dir: string, denyRead: string[]) {
  const nodeInstall = dirname(dirname(process.execPath));
  // On Linux srt runs its apply-seccomp binary from inside the sandbox. On a runner this repository sits under the
  // denied home directory, so without this every check exits 127 (#41).
  const srtPackage = dirname(dirname(realpathSync(SRT_CLI)));
  return {
    filesystem: { denyRead, allowRead: [dir, nodeInstall, srtPackage], allowWrite: [dir], denyWrite: [] },
    network: { allowedDomains: [], deniedDomains: [] },
  };
}

/** Runs each check in `dir`, one after another, each inside the sandbox.
 *  The checkout's node_modules/.bin goes first on PATH only inside the sandbox, as with `npm run`, but pre and post
 *  scripts do not run. stderr is merged into stdout so the output keeps its order.
 *  Args: dir: the checkout; checks: what to run, usually baseChecks(...); denyRead: passed to sandboxSettings.
 *  Returns: one result per check. */
export function runChecks(dir: string, checks: Check[], denyRead: string[]): CheckResult[] {
  const settingsDir = mkdtempSync(join(tmpdir(), "gates-"));
  const settingsFile = join(settingsDir, "srt-settings.json");
  writeFileSync(settingsFile, JSON.stringify(sandboxSettings(dir, denyRead)));
  try {
    return checks.map(({ name, script }) => {
      const started = Date.now();
      const command = `PATH="$GATE_BIN:$PATH"; exec 2>&1\n${script}`;
      const run = spawnSync(process.execPath, [SRT_CLI, "--settings", settingsFile, "-c", command], {
        cwd: dir,
        env: { ...process.env, GATE_BIN: join(dir, "node_modules/.bin") },
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
