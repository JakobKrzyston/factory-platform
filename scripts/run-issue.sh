#!/usr/bin/env bash
# Give Claude Code one GitHub issue, unattended, and open a draft PR with what it did.
#
# Usage: scripts/run-issue.sh https://github.com/<owner>/<repo>/issues/<n>
#
# The agent works in a fresh clone and can only read and edit that clone and run
# sandboxed shell commands; it cannot reach GitHub. A stop hook refuses to let it
# finish while the repository's typecheck, lint or test script fails. This script
# commits, pushes and opens the PR. Each run is recorded under .runlog/runs/<run-id>/.
#
# Exit status: 0 with the PR's URL on stdout; 3 with the agent's question on
# stdout when it stopped to ask one; anything else means no PR.
set -euo pipefail

MODEL=sonnet
TIME_LIMIT_SECONDS=1800
BUDGET_USD=5
TOOLS=Bash,Edit,Read
ALLOWED_TOOLS=("Read(./**)" "Edit(./**)")
PERMISSION_MODE=dontAsk

ROOT=$(cd "$(dirname "$0")/.." && pwd)

if [[ $# -ne 1 || ! $1 =~ ^https://github\.com/([^/]+/[^/]+)/issues/([0-9]+)$ ]]; then
  echo "usage: $0 https://github.com/<owner>/<repo>/issues/<n>" >&2
  exit 2
fi
ISSUE_URL=$1
REPO=${BASH_REMATCH[1]}
NUMBER=${BASH_REMATCH[2]}

# Not exported: the agent is started with only PATH and HOME, so nothing in
# .env.local or the caller's shell can be read from its environment and
# written into a public PR.
if [[ -f $ROOT/.env.local ]]; then
  source "$ROOT/.env.local"
fi
: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is not set (see .env.example)}"

# Claude Code reads the key through apiKeyHelper from a file the agent is
# denied, so the key never enters the agent's environment.
KEY_DIR=$(mktemp -d)
trap 'rm -rf "$KEY_DIR"' EXIT
(umask 077 && printf '%s' "$ANTHROPIC_API_KEY" > "$KEY_DIR/key")

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RUN_ID=$STAMP-${REPO//\//-}-$NUMBER
RUN_DIR=$ROOT/.runlog/runs/$RUN_ID
WORKDIR=$(mktemp -d)/repo
# The clone's git metadata lives outside the clone, where the agent cannot write,
# so it can neither commit nor plant hooks or config that this script's git
# commands, which run unsandboxed with GitHub credentials, would execute.
GIT_DIR_OUTSIDE=$(mktemp -d)/git
repo_git() { git -C "$WORKDIR" --git-dir="$GIT_DIR_OUTSIDE" --work-tree="$WORKDIR" "$@"; }
BRANCH=factory/issue-$NUMBER-$STAMP
mkdir -p "$RUN_DIR"

gh repo clone "$REPO" "$WORKDIR" -- --quiet --separate-git-dir "$GIT_DIR_OUTSIDE"
BASE=$(repo_git symbolic-ref --short HEAD)
repo_git switch --quiet -c "$BRANCH"
ISSUE=$(gh issue view "$ISSUE_URL" --json title,body)
TITLE=$(jq -r .title <<<"$ISSUE")
# The body is untrusted whoever wrote it; the confinement below is what makes that safe.
BODY=$(jq -r .body <<<"$ISSUE")
# Comments only from people who could have queued the issue themselves, where a
# human answers the agent's question, and from the factory's own App
# (FACTORY_BOT, e.g. my-app[bot]), which posted the question. Nobody else's.
COMMENTS=$(gh api --paginate "repos/$REPO/issues/$NUMBER/comments" --jq '.[]' \
  | jq -rs --arg bot "${FACTORY_BOT:-}" '[.[]
      | select((.author_association | IN("OWNER", "MEMBER", "COLLABORATOR")) or .user.login == $bot)
      | "\(.user.login) commented:\n\n\(.body)"] | join("\n\n---\n\n")')

# The gate runs the scripts from this copy, out of the agent's reach, so editing
# package.json or committing in the clone cannot change what it runs.
if [[ -f $WORKDIR/package.json ]]; then cp "$WORKDIR/package.json" "$RUN_DIR/base-package.json"; fi
jq -n --arg checkout "$WORKDIR" --arg run_dir "$RUN_DIR" --arg home "$HOME" --arg key_dir "$KEY_DIR" \
  '{checkout: $checkout, package_json: "\($run_dir)/base-package.json", log: "\($run_dir)/gates.jsonl",
    deny_read: [$home, $key_dir]}' > "$RUN_DIR/gate.json"

# Bash runs in the OS sandbox: writes only inside the clone, no reads of the
# owner's home directory or the key, no network. The stop hook runs outside it,
# and runs the checks in a sandbox of its own (platform/gates/checks.ts). It runs
# from $ROOT so that tsx does not load the clone's tsconfig.json.
cat > "$RUN_DIR/settings.json" <<JSON
{
  "apiKeyHelper": "cat $KEY_DIR/key",
  "autoMemoryEnabled": false,
  "permissions": { "deny": ["Read(~/**)", "Read(/$KEY_DIR/**)"] },
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "autoAllowBashIfSandboxed": true,
    "allowUnsandboxedCommands": false
  },
  "hooks": {
    "Stop": [{ "hooks": [{
      "type": "command",
      "command": "cd \"$ROOT\" && node_modules/.bin/tsx platform/gates/stop-hook.ts \"$RUN_DIR/gate.json\"",
      "timeout": 600
    }] }]
  }
}
JSON

PROMPT="Resolve GitHub issue #$NUMBER in this repository.

Title: $TITLE

$BODY"
if [[ -n $COMMENTS ]]; then
  PROMPT+="

Comments from the maintainers and the factory:

$COMMENTS"
fi

# Passed on stdin: Linux limits a single argument to 128 KiB, and comments can be long.
printf '%s\n' "$PROMPT" > "$RUN_DIR/prompt.md"

SYSTEM="You are running unattended: nobody will answer you during the run or approve anything. \
Work only in the current directory. Do not commit; the script that started you commits and opens the pull request. \
If the project has tests, run them before you finish. \
When you try to finish, a gate runs the project's typecheck, lint and test scripts; while any fails, it tells you which and you keep working. \
If you cannot finish without a decision only a person can make, do not guess: stop, and make your final message \
start with QUESTION: followed by the one question you need answered. Asking discards your changes. \
End with a short summary for the pull request description: what changed, how you checked it, and anything left undone."

jq -n \
  --arg run_id "$RUN_ID" --arg issue "$ISSUE_URL" --arg repo "$REPO" \
  --arg base "$BASE" --arg branch "$BRANCH" --arg workdir "$WORKDIR" \
  --arg model "$MODEL" --argjson time_limit "$TIME_LIMIT_SECONDS" --argjson budget "$BUDGET_USD" \
  --arg tools "$TOOLS" --arg permission_mode "$PERMISSION_MODE" \
  --arg claude_version "$(claude --version)" --arg started_at "$(date -u +%FT%TZ)" \
  --slurpfile settings "$RUN_DIR/settings.json" \
  '{run_id: $run_id, issue: $issue, repo: $repo, base: $base, branch: $branch,
    working_directory: $workdir, model: $model, time_limit_seconds: $time_limit,
    budget_usd: $budget, tools: ($tools | split(",")), allowed_tools: $ARGS.positional,
    permission_mode: $permission_mode, settings: $settings[0],
    claude_version: $claude_version, started_at: $started_at}' \
  --args "${ALLOWED_TOOLS[@]}" > "$RUN_DIR/run.json"

echo "run $RUN_ID: agent working in $WORKDIR (limit ${TIME_LIMIT_SECONDS}s)" >&2

# perl's alarm is the portable time limit: macOS has no timeout(1).
STATUS=0
(cd "$WORKDIR" && perl -e 'alarm shift; exec @ARGV' "$TIME_LIMIT_SECONDS" \
  env -i PATH="$PATH" HOME="$HOME" \
  claude -p \
    --setting-sources "" --strict-mcp-config --no-session-persistence \
    --model "$MODEL" --max-budget-usd "$BUDGET_USD" \
    --tools "$TOOLS" --allowedTools "${ALLOWED_TOOLS[@]}" \
    --permission-mode "$PERMISSION_MODE" --permission-prompts none \
    --settings "$RUN_DIR/settings.json" \
    --append-system-prompt "$SYSTEM" \
    --output-format stream-json --verbose \
  < "$RUN_DIR/prompt.md" > "$RUN_DIR/transcript.jsonl") || STATUS=$?

# A run killed by the time limit can leave a truncated last line, so parse leniently.
RESULT=$(jq -nR '[inputs | fromjson? | select(.type == "result")] | last // {}' "$RUN_DIR/transcript.jsonl")
MODEL_ID=$(jq -nR '[inputs | fromjson? | select(.type == "system" and .subtype == "init") | .model] | first' "$RUN_DIR/transcript.jsonl")
# The stop hook appends a line each time the agent tries to finish; the last
# line is the state it finished in. No line means the gate never ran.
GATES='[]'
if [[ -f $RUN_DIR/gates.jsonl ]]; then GATES=$(jq -s . "$RUN_DIR/gates.jsonl"); fi
CHANGED=$(repo_git status --porcelain | wc -l | tr -d ' ')
# A pushed branch runs its own workflows with the repository's secrets, so the
# agent may not change them.
WORKFLOWS_CHANGED=$(repo_git status --porcelain -- .github | wc -l | tr -d ' ')
jq \
  --argjson exit_code "$STATUS" --argjson result "$RESULT" --argjson model_id "$MODEL_ID" \
  --argjson files_changed "$CHANGED" --argjson workflows_changed "$WORKFLOWS_CHANGED" --argjson gates "$GATES" \
  --arg finished_at "$(date -u +%FT%TZ)" \
  '. + {finished_at: $finished_at, exit_code: $exit_code, timed_out: ($exit_code == 142),
        model_id: $model_id, files_changed: $files_changed, github_dir_changed: ($workflows_changed > 0),
        checks_passed: ($gates | last | .passed // false), checks: ($gates | last | .checks // []),
        gate_attempts: ($gates | length), gate_failures: ($gates | map(select(.passed | not)) | length),
        result_subtype: $result.subtype, is_error: $result.is_error,
        num_turns: $result.num_turns, duration_ms: $result.duration_ms,
        cost_usd: $result.total_cost_usd, usage: $result.usage,
        permission_denials: $result.permission_denials}' \
  "$RUN_DIR/run.json" > "$RUN_DIR/run.json.tmp" && mv "$RUN_DIR/run.json.tmp" "$RUN_DIR/run.json"

SUMMARY=$(jq -r '.result // ""' <<<"$RESULT")
if [[ $STATUS -eq 0 && $SUMMARY == QUESTION:* ]]; then
  QUESTION=$(sed '1s/^QUESTION:[[:space:]]*//' <<<"$SUMMARY")
  jq --arg question "$QUESTION" '. + {question: $question}' "$RUN_DIR/run.json" > "$RUN_DIR/run.json.tmp" \
    && mv "$RUN_DIR/run.json.tmp" "$RUN_DIR/run.json"
  echo "run $RUN_ID: the agent asked a question, so no pull request; see $RUN_DIR" >&2
  printf '%s\n' "$QUESTION"
  exit 3
fi

if [[ $STATUS -ne 0 || $(jq -r '.result_subtype' "$RUN_DIR/run.json") != success \
      || $(jq -r '.is_error' "$RUN_DIR/run.json") != false \
      || $(jq -r '.checks_passed' "$RUN_DIR/run.json") != true \
      || $CHANGED -eq 0 || $WORKFLOWS_CHANGED -ne 0 ]]; then
  echo "run $RUN_ID: no pull request (agent exit $STATUS, result $(jq -r '.result_subtype' "$RUN_DIR/run.json"), checks passed $(jq -r '.checks_passed' "$RUN_DIR/run.json"), $CHANGED files changed, $WORKFLOWS_CHANGED under .github); see $RUN_DIR" >&2
  exit 1
fi

# Built before the push, so a failure here cannot leave a branch without a PR.
PR_BODY="$(jq -r '.result // "The agent left no summary."' <<<"$RESULT")

---

Opened unattended by \`scripts/run-issue.sh\` in [factory-platform](https://github.com/JakobKrzyston/factory-platform). A human reviews and merges.

$(jq -r '"| Run | `\(.run_id)` |\n| --- | --- |\n| Model | \(.model_id) |\n| Tools | \(.tools | join(", ")) (Read and Edit limited to the clone, Bash sandboxed) |\n| Checks | \(if .checks == [] then "none defined" else (.checks | map(.name) | join(", ")) + " passed" end); \(.gate_failures) of \(.gate_attempts) attempts to finish refused |\n| Time limit | \(.time_limit_seconds)s |\n| Turns | \(.num_turns) |\n| Agent time | \(.duration_ms / 1000 | floor)s |\n| Cost | $\(.cost_usd * 100 | round / 100) |"' "$RUN_DIR/run.json")

Closes #$NUMBER"

repo_git add -A
repo_git commit --quiet -m "Resolve #$NUMBER: $TITLE"
repo_git push --quiet -u origin "$BRANCH"

PR_URL=$(gh pr create --repo "$REPO" --draft --base "$BASE" --head "$BRANCH" \
  --title "$TITLE" --body "$PR_BODY")
jq --arg pr "$PR_URL" '. + {pr: $pr}' "$RUN_DIR/run.json" > "$RUN_DIR/run.json.tmp" \
  && mv "$RUN_DIR/run.json.tmp" "$RUN_DIR/run.json"
echo "$PR_URL"
