# The settings.json each agent runs with, sourced by run-issue.sh. Defines agent_settings and install_dir.
# Tested by platform/agents/settings.test.ts.

# Prints the root of a tool's own install when it is under the home directory, which the agent's sandbox denies,
# else nothing. pnpm, and sometimes Node, is installed there, and without a read exception the agent cannot run
# it (#75):
#   pnpm  PNPM_HOME, when the pnpm on PATH is in it or in its bin/: ~/Library/pnpm from pnpm's installer.
#         pnpm/action-setup sets PNPM_HOME to <dest>/node_modules/.bin, whose pnpm is a shim into
#         <dest>/node_modules; then <dest>, ~/setup-pnpm, which the action makes for pnpm alone.
#   node  the prefix holding bin/node, as nodeInstall in platform/gates/checks.ts: ~/.nvm/versions/node/v22.x.
# A directory other tools share is never printed: the home directory or one of its ancestors, a bin directory,
# ~/.local or ~/.npm-global. The run then falls back to the clone's node_modules/.bin, as before #75.
# Args: $1: pnpm or node.
install_dir() {
  local bin dir pnpm_home home under=
  bin=$(command -v "$1") || return 0
  if [[ $1 == pnpm ]]; then
    [[ -n ${PNPM_HOME:-} ]] || return 0
    pnpm_home=$(realpath "$PNPM_HOME" 2>/dev/null) || return 0
    dir=$(realpath "$(dirname "$bin")")
    [[ $dir == "$pnpm_home" || $dir == "$pnpm_home/bin" ]] || return 0
    dir=${pnpm_home%/node_modules/.bin}
  else
    dir=$(realpath "$bin")
    [[ $dir == */bin/node ]] || return 0
    dir=${dir%/bin/node}
  fi
  # $HOME may be a symlink, and $dir is resolved.
  for home in "$HOME" "$(realpath "$HOME")"; do
    case $dir in "$home" | "$home/.local" | "$home/.npm-global" | */bin) return 0 ;; esac
    if [[ $home == "$dir"/* ]]; then return 0; fi
    if [[ $dir == "$home"/* ]]; then under=1; fi
  done
  if [[ -n $under ]]; then echo "$dir"; fi
}

# Prints the settings.json for one agent run. Bash runs in the OS sandbox: writes only inside the clone, no reads
# of the owner's home directory, other than the installs install_dir names, or of the key, and no network. A
# reviewer may not read the git metadata either: the PR's commit message holds the issue's title, and other
# factory branches hold earlier attempts.
# Args: $1: the agent's contract (platform/agents/agent.ts); $2: the key's directory; $3: the parent of the clone's git directory; $4: the hooks, as JSON.
agent_settings() {
  local deny=("Read(~/**)" "Read(/$2/**)") allow=() tool dir
  if [[ $1 == review ]]; then deny+=("Read(/$3/**)"); fi
  for tool in pnpm node; do
    dir=$(install_dir "$tool")
    if [[ -n $dir ]]; then allow+=("$dir"); fi
  done
  jq -n --arg key_dir "$2" --argjson hooks "$4" \
    --argjson deny "$(jq -cn '$ARGS.positional' --args "${deny[@]}")" \
    --argjson allow "$(jq -cn '$ARGS.positional' --args ${allow[@]+"${allow[@]}"})" \
    '{apiKeyHelper: "cat \($key_dir)/key", autoMemoryEnabled: false, permissions: {deny: $deny},
      sandbox: {enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true,
                allowUnsandboxedCommands: false, filesystem: {allowRead: $allow}},
      hooks: $hooks}'
}
