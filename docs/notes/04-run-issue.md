# 04: One agent, one issue, one draft PR, unattended (TL-4)

## Expected

`scripts/run-issue.sh <issue-url>` clones the issue's repository into a temporary directory, runs Claude Code headless on the issue, then commits, pushes and opens a draft PR. Nobody answers prompts, so every permission had to be decided before the run. The agent should be able to read, edit and run tests in its clone and nothing else. The sample repository is [factory-sample](https://github.com/JakobKrzyston/factory-sample), a dependency-free TypeScript library with three seeded issues: two bugs and one small feature.

How the run is confined, each part checked with a probe run before the script was written:

| Setting | Effect |
| --- | --- |
| `--bare --setting-sources "" --strict-mcp-config` | None of the owner's CLAUDE.md, hooks, plugins, MCP servers or settings. Authenticates with `ANTHROPIC_API_KEY` only. Tools are `Bash`, `Edit`, `Read`. |
| `--permission-mode dontAsk --permission-prompts none` | Anything not pre-approved is denied, never asked. |
| `--allowedTools "Read(./**)" "Edit(./**)"` | File tools work inside the clone only. Reading `~/.zshrc` or editing a file in `~` was denied. |
| `sandbox.enabled`, `autoAllowBashIfSandboxed`, no unsandboxed fallback | Bash runs in the macOS sandbox: writes outside the clone and all network access fail. |
| `permissions.deny: Read(~/**)` | Sandboxed Bash cannot read the home directory either. `cat ~/.ssh/...` fails. |
| No git or `gh` for the agent | The agent's own `git commit` was refused. The script commits, pushes and opens the PR, so the agent never holds a GitHub token. The script refuses to open a PR that changes `.github/`, because a pushed branch runs its own workflows with the repository's secrets. |
| `env -i` with only `PATH` and `HOME`; the key through `apiKeyHelper` | Nothing from `.env.local` or the caller's shell is in the agent's environment, so an issue cannot ask for `env` and get a token into the PR body. Claude Code reads the API key from a temporary file the agent is denied, deleted when the script exits. A probe confirmed the agent saw no key and could not read the file. |
| `perl alarm` 1800 s, `--max-budget-usd 5` | Time and cost ceilings. |

Each run writes `.runlog/runs/<run-id>/` with `settings.json`, the full `transcript.jsonl`, and `run.json`. `run.json` holds the tools, allowed tools, working directory, time limit, budget, requested model and the model ID that ran, exit code, turns, tokens, cost, permission denials and the PR URL. A run that ends in an error result, changes nothing or changes `.github/` opens no PR.

## Happened

All four issues produced a draft PR on the first try ([#4](https://github.com/JakobKrzyston/factory-sample/pull/4), [#5](https://github.com/JakobKrzyston/factory-sample/pull/5), [#6](https://github.com/JakobKrzyston/factory-sample/pull/6), [#8](https://github.com/JakobKrzyston/factory-sample/pull/8)). Run 4 used the script after review hardening (`env -i`, `apiKeyHelper`, the `.github/` and error-result checks). Each fix is correct, and each branch passes `node --test` when run by hand. What the agent did badly, as the baseline for later stages:

1. **It gave up on the shell after one refusal.** Runs 1 and 2 each sent one multi-line command that combined `sed -i`, a heredoc and `npm test`. Sandbox auto-approval refused it, and in `dontAsk` mode a refusal is final. The refusal message says "Permission to use Bash has been denied", and both agents took it to mean all of Bash. They finished the work with `Edit` and never ran the tests. Run 4 did the same after its second `sed -i` was refused, though its first had been approved. Simple commands were approved in every run, including a multi-line `python3` heredoc in run 3.
2. **Three of four PRs are unverified.** The summaries honestly ask a human to "run `npm test` to confirm". The prompt told the agent to run the tests; nothing stopped it from finishing without them. That is TL-5's job.
3. **`npm` cannot run in the sandbox on this machine.** It is installed under `~/.nvm`, and the home-directory read deny blocks it. `node` itself still executes. Run 3 hit `operation not permitted: npm`, read `package.json` and ran `node --test` directly, the only run that verified its work. The deny stays: the issue body is untrusted text in a public repository, and a prompt-injected agent that can read `~/.ssh` could copy it into a public PR. On a CI runner the toolchain lives outside the home directory.
4. **Unreviewable source.** In PR #5 the accent-stripping regex holds the literal combining characters U+0300 and U+036F where `\u0300-\u036f` escapes belong. It works, but on screen the character class looks like an empty pair of brackets with marks stacked on them.
5. **Small misses a reviewer would flag.** The feature PR adds an option to `truncate` without documenting it in the README, and says so. Two runs opened with `grep --include=*`, which zsh expands to an error before grep runs.

The agent never touched anything outside its clone, and no run needed a person.

## What the numbers said

| Run | Issue | Turns | Agent time | Cost | Output tokens | Bash refusals | Tests run by agent |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | wordCount on empty text | 6 | 10.3 s | $0.022 | 1,122 | 1 | No |
| 2 | slugify accents | 7 | 13.1 s | $0.019 | 1,170 | 1 | No |
| 3 | truncate at word boundary | 6 | 13.2 s | $0.021 | 1,369 | 0 | Yes, 5 of 5 |
| 4 | add titleCase | 9 | 13.0 s | $0.030 | 1,606 | 1 | No |

Model `claude-sonnet-5-5`, Claude Code 2.1.322. The whole script, clone to PR, took 16 s for run 1.

The baseline is cheap and fast: about two cents and a quarter of a minute per small issue. The cost is not where the risk is. The weakness is verification. One refused command was enough for an agent to stop testing, and the prompt asking it to test did not change that. The next stage measures a gate that makes "tests pass" a condition of finishing, against this one-in-four verified rate.
