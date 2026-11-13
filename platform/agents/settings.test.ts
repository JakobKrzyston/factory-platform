/** Tests scripts/agent-settings.sh, the agents' settings.json, against fake pnpm and Node installs in a fake home
 *  directory (#75). Run: pnpm test */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const SCRIPT = join(import.meta.dirname, "../../scripts/agent-settings.sh");

type Settings = { permissions: { deny: string[] }; sandbox: { filesystem: { allowRead: string[] } } };

/** A fake home directory reached through a symlink, as when $HOME is one, and a directory outside it. */
function fakeHome(t: { after: (fn: () => void) => void }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agent-settings-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const real = join(root, "real-home");
  mkdirSync(real);
  symlinkSync(real, join(root, "home"));
  return { home: join(root, "home"), real, outside: join(root, "outside") };
}

function executable(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
}

/** Runs agent_settings with only HOME, PATH and, when given, PNPM_HOME set; `bins` go first on PATH. */
function settings(home: string, bins: string[], pnpmHome?: string, role = "implement"): Settings {
  const run = spawnSync("bash", ["-c", `source "$0" && agent_settings "$1" /key-dir /git-parent '{}'`, SCRIPT, role], {
    env: { HOME: home, PATH: [...bins, process.env.PATH].join(":"), ...(pnpmHome && { PNPM_HOME: pnpmHome }) },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const parsed: Settings = JSON.parse(run.stdout);
  // Whatever is allowed, the home directory and the key stay denied, and no allowed directory contains either form
  // of the home directory.
  assert.ok(parsed.permissions.deny.includes("Read(~/**)"));
  assert.ok(parsed.permissions.deny.includes("Read(//key-dir/**)"));
  for (const dir of parsed.sandbox.filesystem.allowRead) {
    for (const h of [home, realpathSync(home)]) {
      assert.ok(h !== dir && !h.startsWith(`${dir}/`), `${dir} is ${h} or an ancestor of it`);
    }
  }
  return parsed;
}

const allowed = (s: Settings) => s.sandbox.filesystem.allowRead;

test("pnpm's installer layout allows PNPM_HOME, resolved", (t) => {
  const { home, real } = fakeHome(t);
  executable(join(real, "Library/pnpm/bin/pnpm"));
  const s = settings(home, [join(home, "Library/pnpm/bin")], join(home, "Library/pnpm"));
  assert.deepEqual(allowed(s), [join(real, "Library/pnpm")]);
});

test("pnpm/action-setup's layout allows the directory that holds pnpm's package, not only .bin", (t) => {
  // The action installs pnpm into <dest>, ~/setup-pnpm, and sets PNPM_HOME to <dest>/node_modules/.bin. pnpm writes
  // .bin/pnpm as a shell shim; a symlink to the package's bin/pnpm.cjs is checked too.
  // Each with $HOME as a symlink and as the real directory, so a symlinked $HOME cannot hide a wrong answer.
  for (const [bin, resolved] of [["symlink", true], ["shim", true], ["symlink", false], ["shim", false]] as const) {
    const fake = fakeHome(t);
    const { real } = fake;
    const home = resolved ? real : fake.home;
    const dest = join(real, "setup-pnpm");
    const pkg = join(dest, "node_modules/.pnpm/pnpm@12.16.1/node_modules/pnpm");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(dest, "package.json"), '{"private":true}');
    writeFileSync(join(pkg, "package.json"), '{"name":"pnpm"}');
    executable(join(pkg, "bin/pnpm.cjs"));
    symlinkSync(".pnpm/pnpm@12.16.1/node_modules/pnpm", join(dest, "node_modules/pnpm"));
    if (bin === "symlink") {
      mkdirSync(join(dest, "node_modules/.bin"));
      symlinkSync("../pnpm/bin/pnpm.cjs", join(dest, "node_modules/.bin/pnpm"));
    } else {
      executable(join(dest, "node_modules/.bin/pnpm"));
    }
    const pnpmHome = join(home, "setup-pnpm/node_modules/.bin");
    assert.deepEqual(allowed(settings(home, [pnpmHome], pnpmHome)), [dest], `${bin}, HOME=${home}`);
  }
});

test("nvm's Node allows its version's prefix", (t) => {
  const { home, real } = fakeHome(t);
  executable(join(real, ".nvm/versions/node/v22.23.3/bin/node"));
  const s = settings(home, [join(home, ".nvm/versions/node/v22.23.3/bin")]);
  assert.deepEqual(allowed(s), [join(real, ".nvm/versions/node/v22.23.3")]);
});

test("pnpm and Node are both allowed when both are under the home directory", (t) => {
  const { home, real } = fakeHome(t);
  executable(join(real, "Library/pnpm/bin/pnpm"));
  executable(join(real, ".nvm/versions/node/v22.23.3/bin/node"));
  const bins = [join(home, "Library/pnpm/bin"), join(home, ".nvm/versions/node/v22.23.3/bin")];
  const s = settings(home, bins, join(home, "Library/pnpm"));
  assert.deepEqual(allowed(s), [join(real, "Library/pnpm"), join(real, ".nvm/versions/node/v22.23.3")]);
});

test("a tool in a shared directory under the home directory allows nothing", (t) => {
  const fake = fakeHome(t);
  const { real } = fake;
  for (const [dir, home] of [".local/bin", "bin", ".npm-global/bin"].flatMap((d) => [[d, fake.home], [d, real]])) {
    executable(join(real, dir, "pnpm"));
    executable(join(real, dir, "node"));
    const bins = [join(home, dir)];
    assert.deepEqual(allowed(settings(home, bins)), [], `${dir}, HOME=${home}`);
    assert.deepEqual(allowed(settings(home, bins, join(home, dir))), [], `${dir} as PNPM_HOME, HOME=${home}`);
    assert.deepEqual(allowed(settings(home, bins, dirname(join(home, dir)))), [], `${dir}/.. as PNPM_HOME, HOME=${home}`);
  }
});

test("pnpm outside PNPM_HOME allows nothing", (t) => {
  const { home, real } = fakeHome(t);
  executable(join(real, "Library/pnpm/bin/pnpm"));
  executable(join(real, "tools/pnpm"));
  assert.deepEqual(allowed(settings(home, [join(home, "tools")], join(home, "Library/pnpm"))), []);
});

test("tools outside the home directory need no exception", (t) => {
  const { home, outside } = fakeHome(t);
  executable(join(outside, "pnpm/bin/pnpm"));
  executable(join(outside, "node/bin/node"));
  const s = settings(home, [join(outside, "pnpm/bin"), join(outside, "node/bin")], join(outside, "pnpm"));
  assert.deepEqual(allowed(s), []);
});

test("the reviewer is also denied the git metadata", (t) => {
  const { home } = fakeHome(t);
  assert.ok(settings(home, [], undefined, "review").permissions.deny.includes("Read(//git-parent/**)"));
});
