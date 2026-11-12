/** Reads a factory definition, the directory `factories/<name>/` (TL-17): its `factory.yaml` and the triggers
 *  under `triggers/<trigger>/`. Exports readFactory, readFactories, route, parseSettings and END.
 *  Every field is described in factories/README.md. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the factories live in this repository. */
export const FACTORIES_DIR = fileURLToPath(new URL("../../factories", import.meta.url));

/** The label every chain ends at: the last agent has handed the pull request to a human, who reviews and merges. */
export const END = "factory:in-review";

/** What one label starts: the agent it runs and the label its success moves the issue to. */
export type Trigger = {
  /** The trigger's folder name under `triggers/`. */
  name: string;
  on: "label";
  label: string;
  agent: string;
  next: string;
  color: string;
  description: string;
  /** comment.md: the success comment, with `{output}` and `{run_url}` filled in. */
  comment: string;
  /** question.md, if any: added to the comment when the agent stops to ask a question. */
  question: string | null;
};

export type Factory = {
  /** The factory's folder name under `factories/`. */
  name: string;
  repositories: string[];
  foreman: string;
  agents: string[];
  triggers: Trigger[];
};

/** Parses the plain subset of YAML the definition files use: `key: value` lines, `# comments`, values that
 *  may be double-quoted, and flow lists such as `[a, b]`. A YAML 1.2 parser reads these files the same way.
 *
 *  Args:
 *    text: the file's contents.
 *    file: its path, for error messages.
 *  Returns: each key's value, a string or a list of strings.
 *  Raises: on a line that is not `key: value`, or a key given twice. */
export function parseSettings(text: string, file: string): Map<string, string | string[]> {
  const settings = new Map<string, string | string[]>();
  for (const line of text.split("\n")) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const [, key, raw] = line.match(/^([\w-]+):\s*(.*?)\s*$/) ?? [];
    if (!key) throw new Error(`${file}: not a "key: value" line: ${line}`);
    if (settings.has(key)) throw new Error(`${file}: ${key} is given twice`);
    const list = raw.match(/^\[(.*)\]$/);
    settings.set(key, list ? list[1].split(",").map((item) => unquote(item.trim())).filter(Boolean) : unquote(raw));
  }
  return settings;
}

function unquote(value: string): string {
  return value.replace(/^"(.*)"$/, "$1");
}

/** Reads a settings file, refusing a missing or unknown key. */
function readSettings(file: string, keys: { string: string[]; list?: string[] }) {
  const settings = parseSettings(readFileSync(file, "utf8"), file);
  const known = [...keys.string, ...(keys.list ?? [])];
  const unknown = [...settings.keys()].filter((key) => !known.includes(key));
  if (unknown.length > 0) throw new Error(`${file}: unknown fields: ${unknown.join(", ")}`);
  const string = (key: string): string => {
    const value = settings.get(key);
    if (typeof value !== "string" || value === "") throw new Error(`${file}: ${key} must be a value`);
    return value;
  };
  const list = (key: string): string[] => {
    const value = settings.get(key);
    if (!Array.isArray(value) || value.length === 0) throw new Error(`${file}: ${key} must be a list such as [a, b]`);
    return value;
  };
  return { string, list };
}

function folders(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readTrigger(dir: string): Trigger {
  const file = join(dir, "trigger.yaml");
  const { string } = readSettings(file, { string: ["on", "label", "agent", "next", "color", "description"] });
  if (string("on") !== "label") throw new Error(`${file}: on must be label, the only kind of trigger so far`);
  const label = string("label");
  if (!label.startsWith("factory:")) throw new Error(`${file}: label must start with factory:, the queue's prefix`);
  const color = string("color");
  if (!/^[0-9A-Fa-f]{6}$/.test(color)) throw new Error(`${file}: color must be six hex digits, such as "0E8A16"`);
  const comment = join(dir, "comment.md");
  if (!existsSync(comment)) throw new Error(`${dir}: has no comment.md`);
  const question = join(dir, "question.md");
  return {
    name: basename(dir),
    on: "label",
    label,
    agent: string("agent"),
    next: string("next"),
    color,
    description: string("description"),
    comment: readFileSync(comment, "utf8"),
    question: existsSync(question) ? readFileSync(question, "utf8") : null,
  };
}

/** Reads and checks one factory.
 *
 *  Args:
 *    dir: the factory's directory, `factories/<name>/`.
 *  Returns: the factory, its triggers sorted by folder name.
 *  Raises: if a file is missing or malformed, a trigger calls an agent with no `agents/<agent>/agent.md`, two
 *  triggers share a label, a trigger's next is neither another trigger's label nor `factory:in-review`, the
 *  chain loops, or the foreman is not the agent of the one trigger that no other leads to. */
export function readFactory(dir: string): Factory {
  const file = join(dir, "factory.yaml");
  const { string, list } = readSettings(file, { string: ["foreman"], list: ["repositories"] });
  const agents = folders(join(dir, "agents")).filter((agent) => existsSync(join(dir, "agents", agent, "agent.md")));
  const triggers = folders(join(dir, "triggers")).map((name) => readTrigger(join(dir, "triggers", name)));
  const name = basename(dir);
  const byLabel = new Map<string, Trigger>();

  for (const trigger of triggers) {
    if (byLabel.has(trigger.label)) throw new Error(`${name}: two triggers have the label ${trigger.label}`);
    byLabel.set(trigger.label, trigger);
    if (!agents.includes(trigger.agent)) throw new Error(`${name}: trigger ${trigger.name} calls ${trigger.agent}, which has no agents/${trigger.agent}/agent.md`);
  }
  for (const trigger of triggers) {
    if (trigger.next !== END && !byLabel.has(trigger.next)) {
      throw new Error(`${name}: trigger ${trigger.name} moves to ${trigger.next}, which is neither a trigger's label nor ${END}`);
    }
    // Every chain ends with a human: following next from any trigger must reach END.
    const seen = new Set<string>();
    for (let at: Trigger | undefined = trigger; at; at = byLabel.get(at.next)) {
      if (seen.has(at.label)) throw new Error(`${name}: the chain from ${trigger.label} loops back to ${at.label}`);
      seen.add(at.label);
    }
  }

  const entries = triggers.filter((trigger) => !triggers.some((other) => other.next === trigger.label));
  if (entries.length !== 1) throw new Error(`${name}: needs exactly one trigger that no other leads to; found ${entries.length}`);
  const foreman = string("foreman");
  if (entries[0].agent !== foreman) {
    throw new Error(`${name}: the foreman is ${foreman}, but the entry trigger ${entries[0].label} calls ${entries[0].agent}`);
  }

  return { name, repositories: list("repositories"), foreman, agents, triggers };
}

/** Reads every factory, each folder under `root` that holds a factory.yaml.
 *
 *  Args:
 *    root: the directory holding the factories; this repository's `factories/` by default.
 *  Returns: the factories, sorted by name.
 *  Raises: as readFactory does. */
export function readFactories(root: string = FACTORIES_DIR): Factory[] {
  return folders(root)
    .filter((name) => existsSync(join(root, name, "factory.yaml")))
    .map((name) => readFactory(join(root, name)));
}

/** Finds what a label added to an issue in a repository starts.
 *
 *  Args:
 *    factories: every factory.
 *    repo: `owner/name`.
 *    label: the label that was added.
 *  Returns: the factory serving the repository and its trigger on that label, or null if none.
 *  Raises: if two factories serving the repository trigger on the same label. */
export function route(factories: Factory[], repo: string, label: string): { factory: Factory; trigger: Trigger } | null {
  const matches = factories.flatMap((factory) =>
    factory.repositories.includes(repo)
      ? factory.triggers.filter((trigger) => trigger.label === label).map((trigger) => ({ factory, trigger }))
      : [],
  );
  if (matches.length > 1) throw new Error(`${label} on ${repo} starts ${matches.map((m) => m.factory.name).join(" and ")}`);
  return matches[0] ?? null;
}
