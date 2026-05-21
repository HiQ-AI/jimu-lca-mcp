#!/usr/bin/env node
/**
 * Subprocess-friendly CLI. What `npx -y jimu-lca <subcommand>` runs.
 *
 * Every tool from {@link allTools} is exposed as a subcommand. Outputs JSON
 * by default (pipe-friendly: `jimu-lca products --space=x | jq ...`); pass
 * `--pretty` for the human-readable renderer.
 *
 * Two extra non-tool subcommands:
 *   - `login`  — store memberKey in OS keychain
 *   - `version` — print version
 */
import { z } from "zod";
import yargs from "yargs";
import type { Options, Argv, ArgumentsCamelCase } from "yargs";
import { hideBin } from "yargs/helpers";

import { allTools } from "./tools/index.js";
import { contextFromEnv, writeKeychain } from "./auth.js";
import { stderrLogger } from "./logger.js";
import { JimuLcaError, type ToolDef } from "./types.js";
import { VERSION } from "./env.js";

interface CliOpts {
  pretty?: boolean;
  errorsAsJson?: boolean;
}

function exitCodeFor(err: unknown): number {
  if (err instanceof JimuLcaError) {
    switch (err.kind) {
      case "auth": return 2;
      case "validation": return 3;
      case "upstream": return 4;
      case "transport": return 5;
      default: return 1;
    }
  }
  return 1;
}

function emitResult(tool: ToolDef, result: unknown, opts: CliOpts): void {
  if (opts.pretty && tool.cli?.renderHuman) {
    process.stdout.write(tool.cli.renderHuman(result as never) + "\n");
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
}

function emitError(err: unknown, opts: CliOpts): void {
  const code = exitCodeFor(err);
  const msg = err instanceof JimuLcaError
    ? { error: err.kind, upstream_code: err.upstreamCode ?? null, message: err.message }
    : { error: "unknown", message: err instanceof Error ? err.message : String(err) };
  const text = opts.errorsAsJson ? JSON.stringify(msg, null, 2) : `[${msg.error}${msg.upstream_code ? `:${msg.upstream_code}` : ""}] ${msg.message}`;
  process.stderr.write(text + "\n");
  process.exit(code);
}

/**
 * Walk a Zod schema's JSON Schema representation and produce yargs option specs.
 * Uses `z.toJSONSchema` (stable in Zod 4) so we don't depend on the unstable
 * `_def` internals.
 */
function schemaToYargsOptions(schema: z.ZodObject<z.ZodRawShape>): {
  options: Record<string, Options>;
  arrayFields: Set<string>;
} {
  const json = z.toJSONSchema(schema) as {
    properties?: Record<string, { type?: string; description?: string; enum?: string[]; default?: unknown; items?: unknown }>;
    required?: string[];
  };
  const options: Record<string, Options> = {};
  const arrayFields = new Set<string>();
  const required = new Set(json.required ?? []);
  for (const [name, prop] of Object.entries(json.properties ?? {})) {
    const opt: Options = {
      description: prop.description ?? "",
    };
    if (required.has(name) && prop.default === undefined) opt.demandOption = true;
    if (prop.default !== undefined) opt.default = prop.default;

    const t = prop.type;
    if (t === "string") {
      opt.type = "string";
      if (prop.enum) opt.choices = prop.enum;
    } else if (t === "number" || t === "integer") {
      opt.type = "number";
    } else if (t === "boolean") {
      opt.type = "boolean";
    } else if (t === "array") {
      opt.type = "string";
      opt.description = (opt.description ?? "") + " (JSON-encoded array string)";
      arrayFields.add(name);
    } else {
      opt.type = "string";
    }
    options[name] = opt;
  }
  return { options, arrayFields };
}

function snakeToKebab(s: string): string {
  return s.replace(/_/g, "-");
}

function buildToolCommand(tool: ToolDef) {
  const schema = tool.inputSchema as z.ZodObject<z.ZodRawShape>;
  const { options, arrayFields } = schemaToYargsOptions(schema);

  return {
    command: snakeToKebab(tool.name),
    describe: tool.cli?.summary ?? tool.description.slice(0, 80),
    builder: (y: Argv) => {
      let out = y;
      for (const [name, opt] of Object.entries(options)) {
        out = out.option(snakeToKebab(name), opt);
      }
      return out
        .option("pretty", { type: "boolean", default: false, description: "Human-readable output (default: JSON)" })
        .option("errors-as-json", { type: "boolean", default: false, description: "Emit errors as JSON on stderr (default: text)" });
    },
    handler: async (argv: ArgumentsCamelCase<Record<string, unknown>>) => {
      const opts: CliOpts = { pretty: argv.pretty as boolean, errorsAsJson: argv["errors-as-json"] as boolean };
      try {
        const ctx = await contextFromEnv(stderrLogger);
        // Re-key kebab → snake, decode JSON-arg fields.
        const args: Record<string, unknown> = {};
        for (const name of Object.keys(options)) {
          const kebab = snakeToKebab(name);
          const v = argv[name] ?? argv[kebab];
          if (v === undefined) continue;
          if (arrayFields.has(name) && typeof v === "string") {
            try {
              args[name] = JSON.parse(v);
            } catch (e) {
              throw new JimuLcaError(
                "validation",
                `--${kebab} must be a valid JSON-encoded array string`,
                e,
              );
            }
          } else {
            args[name] = v;
          }
        }
        const parsed = schema.parse(args);
        const result = await tool.handler(parsed, ctx);
        emitResult(tool, result, opts);
      } catch (err) {
        emitError(err, opts);
      }
    },
  };
}

async function main(): Promise<void> {
  let y = yargs(hideBin(process.argv))
    .scriptName("jimu-lca")
    .strict()
    .help()
    .alias("h", "help")
    .demandCommand(1, "");

  for (const tool of allTools) {
    y = y.command(buildToolCommand(tool));
  }

  y = y.command(
    "login <key>",
    "Store a memberKey in your OS keychain.",
    (yy) => yy.positional("key", { type: "string", demandOption: true, describe: "memberKey (app:xxxxxxxxxx)" }),
    async (argv) => {
      try {
        await writeKeychain(argv.key as string);
        process.stdout.write(`stored memberKey in OS keychain (subsequent jimu-lca calls pick it up automatically)\n`);
      } catch (err) {
        emitError(err, { errorsAsJson: false });
      }
    },
  );

  y = y.command(
    "version",
    "Print version.",
    (yy) => yy,
    () => {
      process.stdout.write(VERSION + "\n");
    },
  );

  await y.parseAsync();
}

main().catch((err) => emitError(err, { errorsAsJson: false }));
