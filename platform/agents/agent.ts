/** Reads a factory's agent definition, `factories/<name>/agents/<role>/agent.md`: settings as `key: value`
 *  lines between `---` fences, then the role's system prompt. Exports parseAgent and TOOLS; run as a CLI by
 *  run-issue.sh, it prints the definition as JSON.
 *
 *  tsx platform/agents/agent.ts <agent.md> */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The tools an agent may be given. run-issue.sh confines exactly these (Read and Edit to the clone, Bash to
 *  the OS sandbox); any other tool, such as WebFetch, would run unconfined, so a definition naming one is
 *  refused rather than run. */
export const TOOLS = ["Bash", "Edit", "Read"] as const;

/** One role's settings and prompt. */
export type Agent = {
  model: string;
  tools: (typeof TOOLS)[number][];
  budget_usd: number;
  time_limit_seconds: number;
  prompt: string;
};

/** Parses an agent.md file.
 *
 *  Args:
 *    text: the file's contents.
 *  Returns: the agent's settings and its prompt, the text after the closing fence.
 *  Raises: if the fences are missing, a setting is missing, unknown or invalid, a tool is not in TOOLS,
 *  Read is not among the tools, or the prompt is empty. */
export function parseAgent(text: string): Agent {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("agent.md must start with settings between --- lines");
  const settings = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const [, key, value] = line.match(/^(\w+):\s*(.*?)\s*$/) ?? [];
    if (!key) throw new Error(`not a "key: value" line: ${line}`);
    settings.set(key, value);
  }

  const known = ["description", "model", "tools", "budget_usd", "time_limit_seconds"];
  const unknown = [...settings.keys()].filter((key) => !known.includes(key));
  if (unknown.length > 0) throw new Error(`unknown settings: ${unknown.join(", ")}`);
  const required = (key: string) => {
    const value = settings.get(key);
    if (!value) throw new Error(`missing setting: ${key}`);
    return value;
  };
  const positive = (key: string) => {
    const value = Number(required(key));
    if (!(value > 0)) throw new Error(`${key} must be a positive number`);
    return value;
  };
  // The time limit is a perl alarm(), which takes whole seconds.
  const seconds = positive("time_limit_seconds");
  if (!Number.isInteger(seconds)) throw new Error("time_limit_seconds must be a whole number");

  const tools = required("tools").split(",").map((tool) => tool.trim());
  const unconfined = tools.filter((tool) => !(TOOLS as readonly string[]).includes(tool));
  if (unconfined.length > 0) throw new Error(`tools must be among ${TOOLS.join(", ")}; got ${unconfined.join(", ")}`);
  // Every role is handed a clone to read, and run-issue.sh's allowed-tools list starts from Read.
  if (!tools.includes("Read")) throw new Error("tools must include Read");
  const prompt = match[2].trim();
  if (!prompt) throw new Error("the prompt after the settings is empty");

  return {
    model: required("model"),
    tools: tools as Agent["tools"],
    budget_usd: positive("budget_usd"),
    time_limit_seconds: seconds,
    prompt,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path] = process.argv.slice(2);
  if (!path) {
    console.error("usage: agent.ts <agent.md>");
    process.exit(2);
  }
  console.log(JSON.stringify(parseAgent(readFileSync(path, "utf8"))));
}
