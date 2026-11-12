#!/usr/bin/env bash
# Run one of the factory's agents on one GitHub issue, unattended.
#
# Usage: scripts/run-issue.sh <triage|spec|implement|review> https://github.com/<owner>/<repo>/issues/<n>
#
# The role's model, tools, budget, time limit and prompt come from its definition,
# factories/code/agents/<role>/agent.md (TL-7). What the role is given and what
# becomes of its answer is this script's:
#   triage     the issue and its comments; prints a triage note
#   spec       the issue and its comments; prints the spec, marked for the roles after it
#   implement  the issue and its comments, spec included; commits, pushes, opens a
#              draft PR and prints its URL
#   review     the spec and the PR's diff only, in a clean checkout of the PR's head;
#              posts the review on the PR and prints the PR's URL
#
# The agent works in a fresh clone and can only read and edit that clone and run
# sandboxed shell commands; it cannot reach GitHub. For implement, a stop hook refuses
# to let it finish while the repository's typecheck, lint or test script fails. Each
# run is recorded under .runlog/runs/<run-id>/ and as a row in the run log
# (platform/runlog/): Postgres when DATABASE_URL is set, otherwise SQLite in .runlog/.
# Set RUN_LOG_ID to choose the row's id, and FACTORY to run a factory other than code.
#
# Set REPLAY to a JSON file to replay a benchmark case instead (TL-15; platform/bench/
# writes it): the clone is fetched from the local repository `source` at `base_sha`,
# with no later commits; the issue (`title`, `body`) and its `comments` come from the file, and a
# review reviews `patch`, an implement run's changes.patch, committed onto the base. A
# replay reads nothing from GitHub and writes nothing to it: implement prints the path
# of its changes.patch and review the path of its review.md instead of publishing them,
# and the run's row is marked benchmark.
#
# Exit status: 0 with the role's output on stdout; 3 with the agent's question on
# stdout when it stopped to ask one; 4, from implement only, when the PR opened
# but its description still lacks its risk or evidence after the stop hook gave
# up refusing it (TL-8), with the PR's URL on the first line of stdout and one
# problem per line after it; anything else means the role failed.
set -euo pipefail

FACTORY=${FACTORY:-code}
REPLAY=${REPLAY:-}
PERMISSION_MODE=dontAsk
# The first line of the spec comment; the review role finds the spec by it.
SPEC_MARKER='<!-- factory:spec -->'

ROOT=$(cd "$(dirname "$0")/.." && pwd)

if [[ $# -ne 2 || ! $1 =~ ^(triage|spec|implement|review)$ \
      || ! $2 =~ ^https://github\.com/([^/]+/[^/]+)/issues/([0-9]+)$ ]]; then
  echo "usage: $0 <triage|spec|implement|review> https://github.com/<owner>/<repo>/issues/<n>" >&2
  exit 2
fi
ROLE=$1
ISSUE_URL=$2
REPO=${BASH_REMATCH[1]}
NUMBER=${BASH_REMATCH[2]}

# Not exported: the agent is started with only PATH and HOME, so nothing in
# .env.local or the caller's shell can be read from its environment and
# written into a public PR.
if [[ -f $ROOT/.env.local ]]; then
  source "$ROOT/.env.local"
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RUN_ID=$STAMP-${REPO//\//-}-$NUMBER
RUN_DIR=$ROOT/.runlog/runs/$RUN_ID
RUN_LOG_ID=${RUN_LOG_ID:-$(node -p 'crypto.randomUUID()')}
# DATABASE_URL, from .env.local or the caller, is passed to the writer only, never to the agent.
runlog() { (cd "$ROOT" && DATABASE_URL=${DATABASE_URL:-} node_modules/.bin/tsx platform/runlog/runlog.ts "$@"); }

# A checkout with uncommitted changes is not the committed factory, so its rows
# must not share the commit's factory_sha: the suffix hashes the tracked changes.
FACTORY_SHA=$(git -C "$ROOT" rev-parse HEAD)
if [[ -n $(git -C "$ROOT" status --porcelain) ]]; then
  FACTORY_SHA+=-dirty-$(git -C "$ROOT" diff HEAD | git hash-object --stdin | cut -c1-12)
fi

# The definition is validated before anything runs: only the tools this script
# confines are accepted (platform/agents/agent.ts). A definition that does not
# parse, which the meta-factory could write, still gets a row, with model
# "unknown", ended as failed below.
AGENT_FILE=$ROOT/factories/$FACTORY/agents/$ROLE/agent.md
AGENT=$(cd "$ROOT" && node_modules/.bin/tsx platform/agents/agent.ts "$AGENT_FILE") || AGENT=null
MODEL=$(jq -r '.model // "unknown"' <<<"$AGENT")
# Before anything else that can fail, so every run that gets this far has a row.
runlog start "$RUN_LOG_ID" "$FACTORY" "$ROLE" "$FACTORY_SHA" "$MODEL" "$REPO" "$NUMBER" ${REPLAY:+benchmark}

# Claude Code reads the key through apiKeyHelper from a file the agent is
# denied, so the key never enters the agent's environment.
KEY_DIR=$(mktemp -d)
# The clone is deleted when the script exits. The PR, the transcript and the
# run directory's changes.patch hold everything worth keeping.
CLONE_PARENT=$(mktemp -d)
GIT_PARENT=$(mktemp -d)
# Every exit ends the run's row, with whatever the run directory holds by then.
# Set only once this run's insert succeeded: a failed insert, such as a reused
# RUN_LOG_ID, must not end another run's row. The two exits that are not
# failures set OUTCOME first. The trap must keep the exit status, which says
# whether a PR opened, so a failure to end the row is only reported; on Actions
# the workflow's last step then ends the row as failed.
OUTCOME=failed
trap 'status=$?
  rm -rf "$KEY_DIR" "$CLONE_PARENT" "$GIT_PARENT"
  runlog finish "$RUN_LOG_ID" "$OUTCOME" "$RUN_DIR" || echo "run log: could not end row $RUN_LOG_ID" >&2
  exit $status' EXIT

if [[ $AGENT == null ]]; then
  echo "run: $AGENT_FILE is not a valid agent definition" >&2
  exit 1
fi
TIME_LIMIT_SECONDS=$(jq -r .time_limit_seconds <<<"$AGENT")
BUDGET_USD=$(jq -r .budget_usd <<<"$AGENT")
TOOLS=$(jq -r '.tools | join(",")' <<<"$AGENT")
SYSTEM=$(jq -r .prompt <<<"$AGENT")
# Implement's final message becomes the PR description, which its stop hook
# checks (TL-8), so the platform hands it the skill and template the check
# enforces rather than trusting each definition to quote them.
if [[ $ROLE == implement ]]; then
  SYSTEM+="

Write the pull request description as this skill says:

$(cat "$ROOT/factories/code/skills/pr-description/SKILL.md")

The pull request template:

$(cat "$ROOT/.github/pull_request_template.md")"
# The reviewer works in a clone of the target repository, which has no standards/,
# so the standing rules and how to cite them go into its prompt (TL-9). The awk
# drops the skill's front matter.
elif [[ $ROLE == review ]]; then
  SYSTEM+="

$(awk 'fences >= 2; /^---$/ { fences++ }' "$ROOT/factories/$FACTORY/agents/review/skills/cite-standards/SKILL.md")

$(cat "$ROOT/standards/rules.md")"
fi
# The parser requires Read.
ALLOWED_TOOLS=("Read(./**)")
if jq -e '.tools | index("Edit")' <<<"$AGENT" >/dev/null; then ALLOWED_TOOLS+=("Edit(./**)"); fi

# An explicit exit: bash 3.2 gives the EXIT trap a status of 0 after a failed ${VAR:?}.
if [[ -z ${ANTHROPIC_API_KEY:-} ]]; then
  echo "ANTHROPIC_API_KEY is not set (see .env.example)" >&2
  exit 1
fi
(umask 077 && printf '%s' "$ANTHROPIC_API_KEY" > "$KEY_DIR/key")
WORKDIR=$CLONE_PARENT/repo
# The clone's git metadata lives outside the clone, where the agent cannot write,
# so it can neither commit nor plant hooks or config that this script's git
# commands, which run unsandboxed with GitHub credentials, would execute.
GIT_DIR_OUTSIDE=$GIT_PARENT/git
repo_git() { git -C "$WORKDIR" --git-dir="$GIT_DIR_OUTSIDE" --work-tree="$WORKDIR" "$@"; }
BRANCH=factory/issue-$NUMBER-$STAMP
mkdir -p "$RUN_DIR"

# A replay fetches only the base and its history: the repository's later commits
# hold the PR that closed the issue, which the agent could read with git.
if [[ -n $REPLAY ]]; then
  git init --quiet --separate-git-dir "$GIT_DIR_OUTSIDE" "$WORKDIR"
  repo_git fetch --quiet "$(jq -r .source "$REPLAY")" "$(jq -r .base_sha "$REPLAY")"
  repo_git switch --quiet --detach FETCH_HEAD
  BASE=$(jq -r .base "$REPLAY")
  ISSUE=$(jq '{title, body}' "$REPLAY")
else
  gh repo clone "$REPO" "$WORKDIR" -- --quiet --separate-git-dir "$GIT_DIR_OUTSIDE"
  BASE=$(repo_git symbolic-ref --short HEAD)
  ISSUE=$(gh issue view "$ISSUE_URL" --json title,body)
fi
TITLE=$(jq -r .title <<<"$ISSUE")
# The body is untrusted whoever wrote it; the confinement below is what makes that safe.
BODY=$(jq -r .body <<<"$ISSUE")
# Comments only from people who could have queued the issue themselves, where a
# human answers the agent's question, and from the factory's own App
# (FACTORY_BOT, e.g. my-app[bot]), which posted the question, the triage note
# and the spec. Nobody else's.
# A replay's comments are the earlier stages' output, so all of them are trusted.
if [[ -n $REPLAY ]]; then
  TRUSTED_COMMENTS=$(jq .comments "$REPLAY")
else
  TRUSTED_COMMENTS=$(gh api --paginate "repos/$REPO/issues/$NUMBER/comments" --jq '.[]' \
    | jq -s --arg bot "${FACTORY_BOT:-}" '[.[]
        | select((.author_association | IN("OWNER", "MEMBER", "COLLABORATOR")) or .user.login == $bot)]')
fi
COMMENTS=$(jq -r 'map("\(.user.login) commented:\n\n\(.body)") | join("\n\n---\n\n")' <<<"$TRUSTED_COMMENTS")

# The reviewer reviews the newest open PR the implement role opened for this
# issue, at the commit listed here, against the latest spec. A replay's PR is its
# patch, committed below.
if [[ $ROLE == review && -n $REPLAY ]]; then
  PR_URL=
  PR_BASE=$BASE
elif [[ $ROLE == review ]]; then
  PR=$(gh pr list --repo "$REPO" --state open --limit 100 \
      --json url,headRefName,headRefOid,baseRefName,createdAt,isCrossRepository \
    | jq -c --arg prefix "factory/issue-$NUMBER-" '[.[] | select((.isCrossRepository | not)
        and (.headRefName | startswith($prefix)))] | sort_by(.createdAt) | last // empty')
  if [[ -z $PR ]]; then
    echo "no open factory pull request for #$NUMBER" >&2
    exit 1
  fi
  PR_URL=$(jq -r .url <<<"$PR")
  PR_HEAD=$(jq -r .headRefOid <<<"$PR")
  PR_BASE=$(jq -r .baseRefName <<<"$PR")
fi
if [[ $ROLE == review ]]; then
  SPEC=$(jq -r --arg marker "$SPEC_MARKER" \
    '[.[] | select(.body | startswith($marker))] | last | .body // ""' <<<"$TRUSTED_COMMENTS")
  if [[ -z $SPEC ]]; then
    echo "no spec comment on #$NUMBER to review against" >&2
    exit 1
  fi
fi

# The gate runs the scripts from this copy, out of the agent's reach, so editing
# package.json or committing in the clone cannot change what it runs.
if [[ -f $WORKDIR/package.json ]]; then cp "$WORKDIR/package.json" "$RUN_DIR/base-package.json"; fi
# The checks run the clone's own tools (tsc, a linter, a test runner) with no
# network, so install the base branch's dependencies now. Only pnpm lockfiles
# for now. Lifecycle scripts stay off, and the install gets only PATH and HOME,
# so no dependency's code runs with this script's credentials.
if [[ -f $WORKDIR/pnpm-lock.yaml ]]; then
  (cd "$WORKDIR" && env -i PATH="$PATH" HOME="$HOME" pnpm install --frozen-lockfile --ignore-scripts --silent)
fi
# Only after installing: the PR's head is agent-written, and pnpm runs a
# .pnpmfile.cjs it finds even with --ignore-scripts, outside any sandbox.
if [[ $ROLE == review && -n $REPLAY ]]; then
  repo_git apply --index "$(jq -r .patch "$REPLAY")"
  repo_git -c user.name=bench -c user.email=bench@localhost commit --quiet -m "Replay of #$NUMBER"
  PR_HEAD=$(repo_git rev-parse HEAD)
  DIFF=$(repo_git diff HEAD~1 HEAD)
elif [[ $ROLE == review ]]; then
  # Fetched by commit: a push to the PR after the clone leaves the listed head out of it.
  repo_git fetch --quiet origin "$PR_HEAD"
  repo_git switch --quiet --detach "$PR_HEAD"
  DIFF=$(repo_git diff "origin/$PR_BASE...HEAD")
elif [[ $ROLE == implement ]]; then
  repo_git switch --quiet -c "$BRANCH"
fi
jq -n --arg checkout "$WORKDIR" --arg run_dir "$RUN_DIR" --arg home "$HOME" --arg key_dir "$KEY_DIR" \
  '{checkout: $checkout, package_json: "\($run_dir)/base-package.json", log: "\($run_dir)/gates.jsonl",
    deny_read: [$home, $key_dir]}' > "$RUN_DIR/gate.json"

# Bash runs in the OS sandbox: writes only inside the clone, no reads of the
# owner's home directory or the key, no network. The stop hook runs outside it,
# and runs the checks in a sandbox of its own (platform/gates/checks.ts). It runs
# from $ROOT so that tsx does not load the clone's tsconfig.json. Implement hands
# in changes and is gated by the checks; review hands in findings and is gated by
# their citations of the standing rules (TL-9), which run no code from the clone.
HOOKS='{}'
if [[ $ROLE == implement ]]; then
  HOOKS=$(jq -n --arg command "cd \"$ROOT\" && node_modules/.bin/tsx platform/gates/stop-hook.ts \"$RUN_DIR/gate.json\"" \
    '{Stop: [{hooks: [{type: "command", command: $command, timeout: 600}]}]}')
elif [[ $ROLE == review ]]; then
  HOOKS=$(jq -n --arg command "cd \"$ROOT\" && node_modules/.bin/tsx platform/standards/standards.ts review-hook \"$RUN_DIR/gates.jsonl\"" \
    '{Stop: [{hooks: [{type: "command", command: $command, timeout: 60}]}]}')
fi
# The reviewer may not read the git metadata either: the PR's commit message holds
# the issue's title, and other factory branches hold earlier attempts.
DENY_READ=("Read(~/**)" "Read(/$KEY_DIR/**)")
if [[ $ROLE == review ]]; then DENY_READ+=("Read(/$GIT_PARENT/**)"); fi
cat > "$RUN_DIR/settings.json" <<JSON
{
  "apiKeyHelper": "cat $KEY_DIR/key",
  "autoMemoryEnabled": false,
  "permissions": { "deny": $(jq -cn '$ARGS.positional' --args "${DENY_READ[@]}") },
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "autoAllowBashIfSandboxed": true,
    "allowUnsandboxedCommands": false
  },
  "hooks": $HOOKS
}
JSON

# The reviewer gets the spec and the diff, and nothing the implementer saw or
# said: not the issue, its comments or the PR's description.
if [[ $ROLE == review ]]; then
  PROMPT="The spec:

$SPEC

The pull request's diff against $PR_BASE:

\`\`\`diff
$DIFF
\`\`\`"
else
  PROMPT="GitHub issue #$NUMBER in this repository.

Title: $TITLE

$BODY"
  if [[ -n $COMMENTS ]]; then
    PROMPT+="

Comments from the maintainers and the factory:

$COMMENTS"
  fi
fi

# Passed on stdin: Linux limits a single argument to 128 KiB, and comments can be long.
printf '%s\n' "$PROMPT" > "$RUN_DIR/prompt.md"

jq -n \
  --arg run_id "$RUN_ID" --arg run_log_id "$RUN_LOG_ID" --arg role "$ROLE" --arg issue "$ISSUE_URL" --arg repo "$REPO" \
  --arg base "$BASE" --arg branch "$BRANCH" --arg workdir "$WORKDIR" \
  --arg model "$MODEL" --argjson time_limit "$TIME_LIMIT_SECONDS" --argjson budget "$BUDGET_USD" \
  --arg tools "$TOOLS" --arg permission_mode "$PERMISSION_MODE" \
  --arg claude_version "$(claude --version)" --arg started_at "$(date -u +%FT%TZ)" \
  --slurpfile settings "$RUN_DIR/settings.json" \
  '{run_id: $run_id, run_log_id: $run_log_id, role: $role, issue: $issue, repo: $repo, base: $base, branch: $branch,
    working_directory: $workdir, model: $model, time_limit_seconds: $time_limit,
    budget_usd: $budget, tools: ($tools | split(",")), allowed_tools: $ARGS.positional,
    permission_mode: $permission_mode, settings: $settings[0],
    claude_version: $claude_version, started_at: $started_at}' \
  --args "${ALLOWED_TOOLS[@]}" > "$RUN_DIR/run.json"

echo "run $RUN_ID: $ROLE agent working in $WORKDIR (limit ${TIME_LIMIT_SECONDS}s)" >&2

# claude runs in its own process group, and the whole group is killed when claude
# exits, when the time limit passes, or when this script is interrupted, so nothing
# the agent or the stop hook started (a hung test, a watcher) outlives the run.
# Sandboxed commands on Linux get a session of their own, but bubblewrap kills them
# when it dies, and bubblewrap is in the group. Perl, because macOS has neither
# timeout(1) nor setsid(1). Exit 142 (128 + SIGALRM) means the time limit passed.
STATUS=0
(cd "$WORKDIR" && perl -e '
  my $limit = shift;
  my $pid = fork // die "fork: $!";
  if (!$pid) { setpgrp; exec @ARGV or die "exec: $!" }
  setpgrp $pid, $pid; # also from here, so the kills below cannot run before the group exists
  $SIG{ALRM} = sub { kill KILL => -$pid; exit 142 };
  $SIG{$_} = sub { kill KILL => -$pid; exit 130 } for qw(INT TERM HUP);
  alarm $limit;
  waitpid $pid, 0;
  my $status = $?;
  kill KILL => -$pid;
  exit($status & 127 ? 128 + ($status & 127) : $status >> 8);
' "$TIME_LIMIT_SECONDS" \
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
# Kept because the clone is not: a run that opens no PR still shows what it changed.
repo_git add -A
repo_git diff --cached --binary > "$RUN_DIR/changes.patch"
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
        checks_passed: (if .role == "implement" then ($gates | last | .passed // false) else null end),
        checks: ($gates | last | .checks // []),
        description_problems: ($gates | last | .description_problems // []),
        gate_attempts: ($gates | length), gate_failures: ($gates | map(select((.passed | not) or ((.description_problems // []) | length > 0))) | length),
        result_subtype: $result.subtype, is_error: $result.is_error,
        num_turns: $result.num_turns, duration_ms: $result.duration_ms,
        cost_usd: $result.total_cost_usd, usage: $result.usage,
        permission_denials: $result.permission_denials}' \
  "$RUN_DIR/run.json" > "$RUN_DIR/run.json.tmp" && mv "$RUN_DIR/run.json.tmp" "$RUN_DIR/run.json"

SUMMARY=$(jq -r '.result // ""' <<<"$RESULT")
# The reviewer never sees comments, so nobody could answer it a question; whatever
# it says is its review.
if [[ $ROLE != review && $STATUS -eq 0 && $SUMMARY == QUESTION:* ]]; then
  QUESTION=$(sed '1s/^QUESTION:[[:space:]]*//' <<<"$SUMMARY")
  jq --arg question "$QUESTION" '. + {question: $question}' "$RUN_DIR/run.json" > "$RUN_DIR/run.json.tmp" \
    && mv "$RUN_DIR/run.json.tmp" "$RUN_DIR/run.json"
  echo "run $RUN_ID: the agent asked a question, so no pull request; see $RUN_DIR" >&2
  printf '%s\n' "$QUESTION"
  OUTCOME=needs_human
  exit 3
fi

if [[ $STATUS -ne 0 || $(jq -r '.result_subtype' "$RUN_DIR/run.json") != success \
      || $(jq -r '.is_error' "$RUN_DIR/run.json") != false || ($ROLE != implement && -z $SUMMARY) ]]; then
  echo "run $RUN_ID: the $ROLE agent failed (exit $STATUS, result $(jq -r '.result_subtype' "$RUN_DIR/run.json")); see $RUN_DIR" >&2
  exit 1
fi

if [[ $ROLE == triage ]]; then
  printf '%s\n' "$SUMMARY"
  OUTCOME=done
  exit 0
fi

if [[ $ROLE == spec ]]; then
  printf '%s\n\n%s\n' "$SPEC_MARKER" "$SUMMARY"
  OUTCOME=done
  exit 0
fi

# Posted as a comment, never as a review: the factory never approves (TL-10).
if [[ $ROLE == review ]]; then
  # The stop hook gave the agent its chances; this is the check that decides. A
  # review whose findings do not each cite a standing rule is not posted (TL-9).
  printf '%s\n' "$SUMMARY" > "$RUN_DIR/review.md"
  if ! CITATIONS=$(cd "$ROOT" && node_modules/.bin/tsx platform/standards/standards.ts check-review "$RUN_DIR/review.md" 2>"$RUN_DIR/check-review.txt"); then
    echo "run $RUN_ID: the review's findings do not each cite a standing rule, so it was not posted; see $RUN_DIR/check-review.txt" >&2
    exit 1
  fi
  # check-review prints "<findings> findings, <cited> citing a rule".
  FINDINGS=${CITATIONS%% *}
  # The reviewed commit is reviewed_sha, not head_sha: rework compares the merged
  # head with the commit the implementer handed off.
  jq --arg pr "$PR_URL" --arg reviewed_sha "$PR_HEAD" --arg findings "$FINDINGS" \
    '. + {pr: $pr, reviewed_sha: $reviewed_sha, review_findings: ($findings | if . == "" then null else tonumber end)}' \
    "$RUN_DIR/run.json" > "$RUN_DIR/run.json.tmp" && mv "$RUN_DIR/run.json.tmp" "$RUN_DIR/run.json"
  if [[ -n $REPLAY ]]; then
    OUTCOME=done
    echo "$RUN_DIR/review.md"
    exit 0
  fi
  REVIEW_BODY="$SUMMARY

---

Reviewed unattended at \`$PR_HEAD\` by the factory's review agent, which saw only the spec and this diff. A human decides whether to merge.

$(jq -r '"| Run | `\(.run_id)` |\n| --- | --- |\n| Model | \(.model_id) |\n| Turns | \(.num_turns) |\n| Agent time | \(.duration_ms / 1000 | floor)s |\n| Cost | $\(.cost_usd * 100 | round / 100) |"' "$RUN_DIR/run.json")"
  gh pr comment "$PR_URL" --body-file - <<<"$REVIEW_BODY" >/dev/null
  OUTCOME=done
  echo "$PR_URL"
  exit 0
fi

if [[ $(jq -r '.checks_passed' "$RUN_DIR/run.json") != true || $CHANGED -eq 0 || $WORKFLOWS_CHANGED -ne 0 ]]; then
  echo "run $RUN_ID: no pull request (agent exit $STATUS, result $(jq -r '.result_subtype' "$RUN_DIR/run.json"), checks passed $(jq -r '.checks_passed' "$RUN_DIR/run.json"), $CHANGED files changed, $WORKFLOWS_CHANGED under .github); see $RUN_DIR" >&2
  exit 1
fi

# A replay stops here, with the outcome the run would have had, and publishes nothing.
if [[ -n $REPLAY ]]; then
  echo "$RUN_DIR/changes.patch"
  if [[ -n $(jq -r '.description_problems[]' "$RUN_DIR/run.json") ]]; then
    OUTCOME=needs_human
    exit 4
  fi
  OUTCOME=done
  exit 0
fi

# Built before the push, so a failure here cannot leave a branch without a PR.
PR_BODY="$(jq -r '.result // "The agent left no summary."' <<<"$RESULT")

---

Opened unattended by \`scripts/run-issue.sh\` in [factory-platform](https://github.com/JakobKrzyston/factory-platform). A human reviews and merges.

$(jq -r '"| Run | `\(.run_id)` |\n| --- | --- |\n| Model | \(.model_id) |\n| Tools | \(.tools | join(", ")) (Read and Edit limited to the clone, Bash sandboxed) |\n| Checks | \(if .checks == [] then "none defined" else (.checks | map(.name) | join(", ")) + " passed" end); \(.gate_failures) of \(.gate_attempts) attempts to finish refused |\n| Time limit | \(.time_limit_seconds)s |\n| Turns | \(.num_turns) |\n| Agent time | \(.duration_ms / 1000 | floor)s |\n| Cost | $\(.cost_usd * 100 | round / 100) |"' "$RUN_DIR/run.json")

Closes #$NUMBER"

# A human may close the issue while the agent works; a PR that says "Closes #N"
# would then reopen nothing and only add noise.
if [[ $(gh issue view "$ISSUE_URL" --json state --jq .state) != OPEN ]]; then
  echo "run $RUN_ID: #$NUMBER was closed during the run, so no pull request; see $RUN_DIR" >&2
  exit 1
fi

repo_git add -A
repo_git commit --quiet -m "Resolve #$NUMBER: $TITLE"
repo_git push --quiet -u origin "$BRANCH"

PR_URL=$(gh pr create --repo "$REPO" --draft --base "$BASE" --head "$BRANCH" \
  --title "$TITLE" --body "$PR_BODY")
# head_sha is what the run handed off; rework compares the merged PR against it.
jq --arg pr "$PR_URL" --arg head_sha "$(repo_git rev-parse HEAD)" '. + {pr: $pr, head_sha: $head_sha}' \
  "$RUN_DIR/run.json" > "$RUN_DIR/run.json.tmp" && mv "$RUN_DIR/run.json.tmp" "$RUN_DIR/run.json"
echo "$PR_URL"
# The stop hook refuses an incomplete description, so this is the fallback for a run whose hook gave up blocking.
# It is read only after the push: deciding the issue's label must not be able to lose the work. The PR stays
# open so a person can fill in what is missing rather than pay for a rerun.
DESCRIPTION_PROBLEMS=$(jq -r '.description_problems[]' "$RUN_DIR/run.json")
if [[ -n $DESCRIPTION_PROBLEMS ]]; then
  echo "run $RUN_ID: the pull request's description is incomplete; see $RUN_DIR" >&2
  printf '%s\n' "$DESCRIPTION_PROBLEMS"
  OUTCOME=needs_human
  exit 4
fi
OUTCOME=done
