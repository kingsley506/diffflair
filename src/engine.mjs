/**
 * DiffFlair's dependency-free JSON comparison and export engine.
 * Object keys are compared in lexical order. Arrays are compared by index;
 * trailing removals are emitted in descending order so the patch is applicable.
 */
export const MAX_DEPTH = 100;
export const REDACTED = "[REDACTED]";
const invalidPatches = new WeakMap();
const ignoredArrayPatchError =
  "Cannot export a valid patch for partially ignored array additions; ignore the whole array or clear ignore paths.";
const shiftedIgnoredArrayError =
  "Cannot export a patch that preserves an ignored array index while removing earlier items; ignore the whole array or clear ignore paths.";

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const escapeSegment = (value) => value.replace(/~/g, "~0").replace(/\//g, "~1");
const decodeSegment = (value) => value.replace(/~1/g, "/").replace(/~0/g, "~");

function setOwn(target, key, value) {
  // Assignment to __proto__ is special on ordinary objects; define data instead.
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function validateJSON(value, label, depth = 0, ancestors = new WeakSet()) {
  if (depth > MAX_DEPTH) {
    throw new RangeError(
      `${label} exceeds the maximum JSON depth of ${MAX_DEPTH}.`,
    );
  }
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") {
    throw new TypeError(`${label} must contain only JSON values.`);
  }
  if (ancestors.has(value))
    throw new TypeError(`${label} contains a circular reference.`);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      `${label} must contain only plain JSON objects and arrays.`,
    );
  }
  if (
    Object.getOwnPropertySymbols(value).some((symbol) =>
      Object.prototype.propertyIsEnumerable.call(value, symbol),
    )
  ) {
    throw new TypeError(
      `${label} contains a symbol property, which is not JSON.`,
    );
  }
  ancestors.add(value);
  if (array) {
    for (let index = 0; index < value.length; index += 1) {
      if (!own(value, index))
        throw new TypeError(`${label} contains a sparse array.`);
      validateJSON(value[index], label, depth + 1, ancestors);
    }
  } else {
    for (const key of Object.keys(value)) {
      validateJSON(value[key], label, depth + 1, ancestors);
    }
  }
  ancestors.delete(value);
}

function cloneJSON(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneJSON);
  const result = {};
  for (const key of Object.keys(value).sort())
    setOwn(result, key, cloneJSON(value[key]));
  return result;
}

function validatePointer(path) {
  if (
    typeof path !== "string" ||
    (path !== "" && !path.startsWith("/")) ||
    /~(?:[^01]|$)/.test(path)
  ) {
    throw new TypeError(
      "Paths must be RFC 6901 JSON Pointers (empty or beginning with /; use ~0 and ~1).",
    );
  }
}

function containsPointer(value, relativePath) {
  let current = value;
  for (const segment of relativePath.slice(1).split("/").map(decodeSegment)) {
    if (
      current === null ||
      typeof current !== "object" ||
      !own(current, segment)
    )
      return false;
    current = current[segment];
  }
  return true;
}

/** Compare two JSON values. Ignored pointers include their entire subtree. */
export function compare(before, after, { ignorePaths = [] } = {}) {
  validateJSON(before, "Before");
  validateJSON(after, "After");
  if (!Array.isArray(ignorePaths))
    throw new TypeError("ignorePaths must be an array of JSON Pointers.");
  ignorePaths.forEach(validatePointer);
  const ignored = (path) =>
    ignorePaths.some(
      (ignore) =>
        ignore === "" || path === ignore || path.startsWith(`${ignore}/`),
    );
  const changes = [];
  const emit = (kind, path, oldValue, newValue) => {
    // Added/removed containers and type replacements are atomic. Silently
    // including ignored descendants would violate the user's requested scope.
    const conflictingIgnore = ignorePaths.find(
      (ignore) =>
        ignore.startsWith(`${path}/`) &&
        (containsPointer(oldValue, ignore.slice(path.length)) ||
          containsPointer(newValue, ignore.slice(path.length))),
    );
    if (conflictingIgnore !== undefined) {
      throw new Error(
        `Cannot apply ignore path ${JSON.stringify(conflictingIgnore)} inside an atomic ${kind} change at ${JSON.stringify(path || "(root)")}; ignore the whole container or remove that ignore path.`,
      );
    }
    const change = { kind, path };
    if (kind !== "added") change.before = cloneJSON(oldValue);
    if (kind !== "removed") change.after = cloneJSON(newValue);
    changes.push(change);
  };

  function walk(oldValue, newValue, path) {
    if (ignored(path) || oldValue === newValue) return;
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      const commonLength = Math.min(oldValue.length, newValue.length);
      for (let index = 0; index < commonLength; index += 1) {
        walk(oldValue[index], newValue[index], `${path}/${index}`);
      }
      let skippedRemoval = false;
      for (
        let index = oldValue.length - 1;
        index >= newValue.length;
        index -= 1
      ) {
        const nextPath = `${path}/${index}`;
        if (ignored(nextPath)) skippedRemoval = true;
        else {
          if (skippedRemoval)
            invalidPatches.set(changes, shiftedIgnoredArrayError);
          emit("removed", nextPath, oldValue[index]);
        }
      }
      let skippedAddition = false;
      for (let index = oldValue.length; index < newValue.length; index += 1) {
        const nextPath = `${path}/${index}`;
        if (ignored(nextPath)) skippedAddition = true;
        else {
          if (skippedAddition)
            invalidPatches.set(changes, ignoredArrayPatchError);
          emit("added", nextPath, undefined, newValue[index]);
        }
      }
      return;
    }
    if (
      oldValue !== null &&
      newValue !== null &&
      typeof oldValue === "object" &&
      typeof newValue === "object" &&
      !Array.isArray(oldValue) &&
      !Array.isArray(newValue)
    ) {
      const keys = [
        ...new Set([...Object.keys(oldValue), ...Object.keys(newValue)]),
      ].sort();
      for (const key of keys) {
        const nextPath = `${path}/${escapeSegment(key)}`;
        if (ignored(nextPath)) continue;
        if (!own(oldValue, key))
          emit("added", nextPath, undefined, newValue[key]);
        else if (!own(newValue, key)) emit("removed", nextPath, oldValue[key]);
        else walk(oldValue[key], newValue[key], nextPath);
      }
      return;
    }
    emit("changed", path, oldValue, newValue);
  }

  walk(before, after, "");
  return changes;
}

/** Convert compare() output, in its original order, to an RFC 6902 patch. */
export function toPatch(changes) {
  const patchError = invalidPatches.get(changes);
  if (patchError) throw new Error(patchError);
  return changes.map((change) => {
    validatePointer(change.path);
    if (change.kind === "removed") return { op: "remove", path: change.path };
    if (change.kind !== "added" && change.kind !== "changed")
      throw new TypeError("Unknown change kind.");
    validateJSON(change.after, "Patch value");
    return {
      op: change.kind === "added" ? "add" : "replace",
      path: change.path,
      value: cloneJSON(change.after),
    };
  });
}

export function summarize(changes) {
  const result = { added: 0, removed: 0, changed: 0, total: changes.length };
  for (const change of changes) {
    if (!own(result, change.kind) || change.kind === "total")
      throw new TypeError("Unknown change kind.");
    result[change.kind] += 1;
  }
  return result;
}

function sensitiveKey(key) {
  const normalized = key.replace(/[\s_.-]/g, "").toLowerCase();
  return (
    /(?:passwords?|passwd|secrets?|tokens?|apikeys?|privatekeys?|authorization|cookies?|credentials?)$/.test(
      normalized,
    ) || normalized === "pwd"
  );
}

function maskValue(value, depth = 0) {
  if (depth > MAX_DEPTH)
    throw new RangeError(
      `Report exceeds the maximum JSON depth of ${MAX_DEPTH}.`,
    );
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => maskValue(item, depth + 1));
  const result = {};
  for (const key of Object.keys(value).sort()) {
    setOwn(
      result,
      key,
      sensitiveKey(key) ? REDACTED : maskValue(value[key], depth + 1),
    );
  }
  return result;
}

/** Make a detached, redacted report copy. Never use this copy to make patches. */
export function maskChanges(changes) {
  return changes.map((change) => {
    validatePointer(change.path);
    const sensitivePath = change.path
      .split("/")
      .slice(1)
      .some((part) => sensitiveKey(decodeSegment(part)));
    const result = { kind: change.kind, path: change.path };
    for (const side of ["before", "after"]) {
      if (own(change, side)) {
        validateJSON(change[side], "Report value");
        result[side] = sensitivePath ? REDACTED : maskValue(change[side]);
      }
    }
    return result;
  });
}

function escapedHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function fenceFor(value, minimum = 1) {
  const longest = (value.match(/`+/g) || []).reduce(
    (length, run) => Math.max(length, run.length),
    0,
  );
  return "`".repeat(Math.max(minimum, longest + 1));
}

function inlineCode(value) {
  const text = String(value).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  const fence = fenceFor(text);
  return `${fence} ${text} ${fence}`;
}

function jsonBlock(value) {
  const text = JSON.stringify(value, null, 2);
  const fence = fenceFor(text, 3);
  return `${fence}json\n${text}\n${fence}`;
}

export function toMarkdown(changes, { redact = true, ignorePaths = [] } = {}) {
  if (!Array.isArray(ignorePaths))
    throw new TypeError("ignorePaths must be an array of JSON Pointers.");
  ignorePaths.forEach(validatePointer);
  const report = redact ? maskChanges(changes) : changes;
  const counts = summarize(report);
  const lines = [
    "# DiffFlair report",
    "",
    `**${counts.total} changes** · ${counts.added} added · ${counts.removed} removed · ${counts.changed} changed`,
    "",
    redact
      ? "Common sensitive field names are redacted. Review before sharing; unrecognized secrets may remain."
      : "Values are shown without redaction.",
    "",
    "Arrays are compared by position.",
    "",
  ];
  if (ignorePaths.length)
    lines.push(
      `**Ignored paths:** ${ignorePaths.map((path) => inlineCode(path || "(root)")).join(", ")}`,
      "",
      "This is a partial comparison. A patch excludes ignored changes and does not necessarily reconstruct the full after document.",
      "",
    );
  if (!report.length) lines.push("No changes found.", "");
  for (const [index, change] of report.entries()) {
    lines.push(
      `## ${index + 1}. ${change.kind[0].toUpperCase()}${change.kind.slice(1)}`,
      "",
      `**Path:** ${inlineCode(change.path || "(root)")}`,
      "",
    );
    for (const side of ["before", "after"]) {
      if (own(change, side))
        lines.push(
          `**${side === "before" ? "Before" : "After"}**`,
          "",
          jsonBlock(change[side]),
          "",
        );
    }
  }
  return lines.join("\n");
}

export function toHTML(changes, { redact = true, ignorePaths = [] } = {}) {
  if (!Array.isArray(ignorePaths))
    throw new TypeError("ignorePaths must be an array of JSON Pointers.");
  ignorePaths.forEach(validatePointer);
  const report = redact ? maskChanges(changes) : changes;
  const counts = summarize(report);
  const cards = report
    .map((change) => {
      const panes = ["before", "after"]
        .filter((side) => own(change, side))
        .map(
          (side) =>
            `<section class="pane ${side}"><h3>${side === "before" ? "Before" : "After"}</h3><pre>${escapedHTML(JSON.stringify(change[side], null, 2))}</pre></section>`,
        )
        .join("");
      return `<article class="change"><header><span class="badge ${change.kind}">${escapedHTML(change.kind)}</span><code>${escapedHTML(change.path || "(root)")}</code></header><div class="values">${panes}</div></article>`;
    })
    .join("\n");
  const ignoredNote = ignorePaths.length
    ? `<p class="intro">Ignored paths: ${ignorePaths.map((path) => `<code>${escapedHTML(path || "(root)")}</code>`).join(", ")}. This is a partial comparison; a patch excludes ignored changes and does not necessarily reconstruct the full after document.</p>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>DiffFlair report</title>
<style>
:root{color-scheme:light;--ink:#17242c;--muted:#65737b;--line:#dce4e8;--paper:#f4f7f7;--accent:#146a53}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1100px;margin:0 auto;padding:52px 24px}.brand{font-size:13px;text-transform:uppercase;letter-spacing:.18em;color:var(--accent);font-weight:750}h1{font-size:clamp(32px,5vw,52px);line-height:1.1;margin:12px 0 18px;letter-spacing:-.04em}.intro{color:var(--muted);max-width:720px}.stats{display:flex;gap:12px;flex-wrap:wrap;margin:28px 0 34px}.stat{background:white;border:1px solid var(--line);border-radius:12px;padding:13px 20px;min-width:116px}.stat strong{display:block;font-size:26px;line-height:1.25}.stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.change{background:white;border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:18px 0}.change header{display:flex;gap:12px;align-items:center;padding:17px 20px;border-bottom:1px solid var(--line)}code{font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;white-space:pre-wrap}.badge{font-size:11px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;border-radius:6px;padding:4px 8px}.added{color:#126747;background:#dcf5e8}.removed{color:#a03644;background:#ffe6ea}.changed{color:#7a5518;background:#fff0cd}.values{display:flex;flex-wrap:wrap}.pane{flex:1 1 330px;min-width:0;padding:17px 20px}.pane+.pane{border-left:1px solid var(--line)}h3{font-size:11px;margin:0 0 12px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}pre{margin:0;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.empty{background:white;border:1px dashed var(--line);border-radius:14px;padding:36px;text-align:center;color:var(--muted)}footer{margin-top:34px;font-size:12px;color:var(--muted)}@media(max-width:710px){.shell{padding:30px 16px}.pane+.pane{border-left:0;border-top:1px solid var(--line)}.change header{align-items:flex-start}.stat{flex:1 1 100px}}@media print{body{background:white}.shell{padding:12px}.change{break-inside:avoid}.stats{margin:20px 0}}
</style></head><body><main class="shell"><div class="brand">DiffFlair · JSON change report</div><h1>Every change.<br>A clearer picture.</h1><p class="intro">${redact ? "Common sensitive field names are redacted. Review before sharing; unrecognized secrets may remain." : "Values are shown without redaction."}</p>${ignoredNote}<div class="stats"><div class="stat"><strong>${counts.total}</strong><span>Total changes</span></div><div class="stat"><strong>${counts.added}</strong><span>Added</span></div><div class="stat"><strong>${counts.removed}</strong><span>Removed</span></div><div class="stat"><strong>${counts.changed}</strong><span>Changed</span></div></div>${cards || '<div class="empty">No changes found.</div>'}<footer>Generated with DiffFlair. Arrays are compared by position. This report works offline.</footer></main></body></html>`;
}
