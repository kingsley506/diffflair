#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import {
  compare,
  summarize,
  toPatch,
  toMarkdown,
  toHTML,
  maskChanges,
} from "../src/engine.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
const FORMATS = new Set(["summary", "json", "patch", "markdown", "html"]);
const HELP = `DiffFlair — understand what changed in your JSON.

Usage:
  node bin/diffflair.mjs BEFORE.json AFTER.json [options]

Options:
  --format FORMAT   summary (default), json, patch, markdown, or html
  --output FILE     Write the result to a file instead of stdout
  --ignore POINTER  Ignore a JSON Pointer and its subtree; repeat as needed
  --no-redact       Include original values in reports
  --check           Exit 1 when differences exist, 0 when equal
  --help, -h        Show this help
  --version, -v     Show the version

Each input must be valid UTF-8 JSON, at most 2 MiB. Report values are
heuristically masked by default. RFC 6902 patches always use original
values so they can be applied. Review reports before sharing.
`;

function parseArgs(args) {
  const options = {
    format: "summary",
    output: null,
    ignorePaths: [],
    redact: true,
    check: false,
  };
  const files = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--no-redact") options.redact = false;
    else if (
      ["--format", "--output", "--ignore"].some(
        (flag) => arg === flag || arg.startsWith(`${flag}=`),
      )
    ) {
      const separator = arg.indexOf("=");
      const flag = separator < 0 ? arg : arg.slice(0, separator);
      const value = separator < 0 ? args[++i] : arg.slice(separator + 1);
      if (
        value === undefined ||
        value.startsWith("--") ||
        (value === "" && flag !== "--ignore")
      ) {
        throw new Error(`${flag} requires a value.`);
      }
      if (flag === "--format") options.format = value;
      else if (flag === "--output") options.output = value;
      else options.ignorePaths.push(value);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else files.push(arg);
  }
  if (files.length !== 2)
    throw new Error(
      "Provide exactly two JSON files. Run with --help for usage.",
    );
  if (!FORMATS.has(options.format))
    throw new Error(`Unknown format: ${options.format}`);
  for (const path of options.ignorePaths) {
    if (path !== "" && (!path.startsWith("/") || /~(?![01])/u.test(path))) {
      throw new Error(
        `Invalid JSON Pointer: ${path}. Use /path, with ~0 for ~ and ~1 for /.`,
      );
    }
  }
  return { files, options };
}

async function readJSON(path) {
  let bytes;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Expected a regular file.");
    if (info.size > MAX_BYTES)
      throw new Error("Input exceeds the 2 MiB limit.");
    bytes = await readFile(path);
    if (bytes.length > MAX_BYTES)
      throw new Error("Input exceeds the 2 MiB limit.");
  } catch (error) {
    throw new Error(`${path}: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`${path}: invalid UTF-8 JSON (${error.message}).`, {
      cause: error,
    });
  }
}

function renderSummary(changes) {
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const change of changes) counts[change.kind] += 1;
  if (!changes.length) return "No differences.\n";
  const lines = [
    `${changes.length} difference${changes.length === 1 ? "" : "s"}: ${counts.added} added, ${counts.removed} removed, ${counts.changed} changed.`,
  ];
  for (const change of changes)
    lines.push(
      `  ${change.kind.padEnd(7)} ${JSON.stringify(change.path || "(root)")}`,
    );
  return `${lines.join("\n")}\n`;
}

function render(changes, options) {
  if (options.format === "summary") return renderSummary(changes);
  if (options.format === "patch")
    return `${JSON.stringify(toPatch(changes), null, 2)}\n`;
  const reportOptions = {
    redact: options.redact,
    ignorePaths: options.ignorePaths,
  };
  if (options.format === "markdown") return toMarkdown(changes, reportOptions);
  if (options.format === "html") return toHTML(changes, reportOptions);
  const reportChanges = options.redact ? maskChanges(changes) : changes;
  return `${JSON.stringify({ summary: summarize(changes), rules: { ignorePaths: options.ignorePaths, arrayComparison: "positional", redact: options.redact }, changes: reportChanges }, null, 2)}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write("0.1.0\n");
    return;
  }
  const { files, options } = parseArgs(args);
  const [before, after] = await Promise.all(files.map(readJSON));
  const changes = compare(before, after, { ignorePaths: options.ignorePaths });
  const report = render(changes, options);
  if (options.output) {
    await writeFile(options.output, report, "utf8");
    process.stderr.write(`Saved ${options.format} to ${options.output}\n`);
  } else process.stdout.write(report);
  if (options.check && changes.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`DiffFlair: ${error.message}\n`);
  process.exitCode = 2;
});
