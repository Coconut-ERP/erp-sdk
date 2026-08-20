import { COMMANDS, type CommandSpec } from "./commands";

export const GLOBAL_FLAGS = [
  {
    name: "base-url",
    value: "url",
    description: "ERP base URL (env ERP_BASE_URL)",
  },
  {
    name: "api-key",
    value: "erp_sk_…",
    description: "Service-account API key (env ERP_API_KEY)",
  },
  {
    name: "token",
    value: "jwt",
    description: "User access token instead of a key (env ERP_ACCESS_TOKEN)",
  },
  {
    name: "workspace",
    value: "id",
    description: "Workspace id, only with --token (env ERP_WORKSPACE_ID)",
  },
  { name: "compact", description: "Print result JSON on a single line" },
  { name: "help", description: "Show help for a command" },
  { name: "version", description: "Print the SDK version" },
];

function signature(command: CommandSpec): string {
  const args = (command.args ?? [])
    .map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`))
    .join(" ");
  return `erp ${command.name}${args ? ` ${args}` : ""}`;
}

/** The whole command surface as data — `erp help --json` for agents. */
export function helpJson(command?: CommandSpec) {
  const describe = (spec: CommandSpec) => ({
    name: spec.name,
    summary: spec.summary,
    usage: signature(spec),
    args: spec.args ?? [],
    flags: spec.flags ?? [],
    examples: spec.examples ?? [],
  });
  if (command) return describe(command);
  return {
    usage: "erp <command> [args] [flags]",
    output: "Results are JSON on stdout; notes and errors are JSON on stderr.",
    globalFlags: GLOBAL_FLAGS,
    env: [
      "ERP_BASE_URL",
      "ERP_API_KEY",
      "ERP_ACCESS_TOKEN",
      "ERP_WORKSPACE_ID",
    ],
    commands: COMMANDS.map(describe),
  };
}

function flagLine(flag: {
  name: string;
  value?: string;
  repeatable?: boolean;
  description: string;
}): string {
  const label = `--${flag.name}${flag.value ? ` <${flag.value}>` : ""}${flag.repeatable ? " (repeatable)" : ""}`;
  return `  ${label.padEnd(34)} ${flag.description}`;
}

export function helpText(command?: CommandSpec): string {
  if (command) {
    const lines = [signature(command), "", command.summary, ""];
    if (command.args?.length) {
      lines.push("Arguments:");
      for (const arg of command.args) {
        lines.push(`  ${`<${arg.name}>`.padEnd(34)} ${arg.description}`);
      }
      lines.push("");
    }
    if (command.flags?.length) {
      lines.push("Flags:");
      for (const flag of command.flags) lines.push(flagLine(flag));
      lines.push("");
    }
    if (command.examples?.length) {
      lines.push("Examples:");
      for (const example of command.examples) lines.push(`  ${example}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  const lines = [
    "erp — setup and discovery for erp-sdk (Coconut ERP backend)",
    "",
    "Usage: erp <command> [args] [flags]",
    "Results print as JSON on stdout; notes and errors go to stderr.",
    "",
    "Reading, writing and analysing records is the SDK's job, not the CLI's:",
    "these commands only prove the credentials work and print the real object",
    "and field names you need before writing code.",
    "",
    "Commands:",
  ];
  for (const spec of COMMANDS) {
    lines.push(`  ${spec.name.padEnd(18)} ${spec.summary}`);
  }
  lines.push("", "Global flags:");
  for (const flag of GLOBAL_FLAGS) lines.push(flagLine(flag));
  lines.push(
    "",
    "Run `erp help <command>` for details, or `erp help --json` for the whole",
    "command surface as machine-readable JSON.",
    "",
  );
  return lines.join("\n");
}
