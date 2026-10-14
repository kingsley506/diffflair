import test from "node:test";
import assert from "node:assert/strict";
import {
  compare,
  toPatch,
  summarize,
  maskChanges,
  toMarkdown,
  toHTML,
  MAX_DEPTH,
  REDACTED,
} from "../src/engine.mjs";

const copy = (value) => JSON.parse(JSON.stringify(value));

// Independent RFC 6902 subset interpreter: validates existence and array bounds.
// Uses JSON cloning and own-property data definitions rather than engine helpers.
function applyPatch(input, patch) {
  let result = copy(input);
  for (const operation of patch) {
    const { op, path } = operation;
    assert.ok(["add", "remove", "replace"].includes(op));
    if (path === "") {
      assert.notEqual(op, "remove");
      result = copy(operation.value);
      continue;
    }
    const parts = path
      .slice(1)
      .split("/")
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    const final = parts.pop();
    let parent = result;
    for (const segment of parts) {
      assert.equal(
        Object.hasOwn(parent, segment),
        true,
        `Missing parent ${segment} for ${path}`,
      );
      parent = parent[segment];
    }
    assert.ok(
      parent !== null && typeof parent === "object",
      `Non-container parent for ${path}`,
    );
    if (Array.isArray(parent)) {
      const index =
        final === "-" && op === "add" ? parent.length : Number(final);
      assert.ok(
        Number.isInteger(index) &&
          index >= 0 &&
          String(index) === (final === "-" ? String(parent.length) : final),
      );
      assert.ok(
        index < parent.length || (op === "add" && index === parent.length),
        `Out-of-bounds ${path}`,
      );
      if (op === "remove") parent.splice(index, 1);
      else if (op === "add") parent.splice(index, 0, copy(operation.value));
      else parent[index] = copy(operation.value);
    } else {
      if (op !== "add")
        assert.equal(
          Object.hasOwn(parent, final),
          true,
          `Missing target ${path}`,
        );
      if (op === "remove") delete parent[final];
      else
        Object.defineProperty(parent, final, {
          value: copy(operation.value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
  }
  return result;
}

test("key order does not create changes; output is deterministic", () => {
  assert.deepEqual(
    compare({ b: { y: 2, x: 1 }, a: true }, { a: true, b: { x: 1, y: 2 } }),
    [],
  );
  const expected = [
    { kind: "added", path: "/a", after: 1 },
    { kind: "removed", path: "/b", before: 2 },
    { kind: "changed", path: "/c/n", before: 3, after: 4 },
  ];
  assert.deepEqual(
    compare({ c: { n: 3 }, b: 2 }, { c: { n: 4 }, a: 1 }),
    expected,
  );
  assert.deepEqual(
    compare({ b: 2, c: { n: 3 } }, { a: 1, c: { n: 4 } }),
    expected,
  );
  assert.deepEqual(summarize(expected), {
    added: 1,
    removed: 1,
    changed: 1,
    total: 3,
  });
});

test("root primitives, null, object/array type changes reconstruct the after value", () => {
  for (const [before, after] of [
    [null, {}],
    [{}, null],
    [false, true],
    [1, "1"],
    ["old", []],
    [[], {}],
    [null, null],
  ]) {
    const changes = compare(before, after);
    assert.deepEqual(applyPatch(before, toPatch(changes)), after);
    if (changes.length) assert.equal(changes[0].path, "");
  }
});

test("nested arrays use positional changes, descending removals, ascending additions", () => {
  const before = { rows: [{ n: 1, inner: [0, 1, 2] }, { n: 2 }, { n: 3 }] };
  const after = { rows: [{ n: 8, inner: [9] }] };
  const changes = compare(before, after);
  assert.deepEqual(
    changes.map((change) => change.path),
    [
      "/rows/0/inner/0",
      "/rows/0/inner/2",
      "/rows/0/inner/1",
      "/rows/0/n",
      "/rows/2",
      "/rows/1",
    ],
  );
  assert.deepEqual(applyPatch(before, toPatch(changes)), after);
  const growth = compare({ rows: [] }, { rows: [null, { n: 2 }, [3]] });
  assert.deepEqual(
    growth.map((change) => change.path),
    ["/rows/0", "/rows/1", "/rows/2"],
  );
  assert.deepEqual(applyPatch({ rows: [] }, toPatch(growth)), {
    rows: [null, { n: 2 }, [3]],
  });
  const insertion = compare(["a", "b"], ["z", "a", "b"]);
  assert.deepEqual(
    insertion.map((change) => change.kind),
    ["changed", "changed", "added"],
  );
  assert.deepEqual(applyPatch(["a", "b"], toPatch(insertion)), ["z", "a", "b"]);
});

test("RFC 6901 escaping, empty keys and prototype-looking own keys are safe", () => {
  const before = JSON.parse(
    '{"a/b":{"~key":1},"":1,"__proto__":{"polluted":false},"constructor":1}',
  );
  const after = JSON.parse(
    '{"a/b":{"~key":2},"":2,"__proto__":{"polluted":true},"constructor":2,"prototype":3}',
  );
  const changes = compare(before, after);
  assert.deepEqual(
    changes.map((change) => change.path),
    ["/", "/__proto__/polluted", "/a~1b/~0key", "/constructor", "/prototype"],
  );
  assert.deepEqual(applyPatch(before, toPatch(changes)), after);
  assert.equal({}.polluted, undefined);
  const objectAdded = compare({}, JSON.parse('{"__proto__":{"a":1}}'));
  assert.equal(Object.hasOwn(objectAdded[0].after, "a"), true);
  const entireObject = compare(null, after)[0].after;
  assert.equal(Object.hasOwn(entireObject, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(entireObject), Object.prototype);
});

test("ignore paths use subtree boundaries and respect escaped names and root", () => {
  const before = {
    meta: { timestamp: 1, nested: { x: 1 } },
    metadata: 1,
    "a/b": 1,
    items: [1, 2],
  };
  const after = {
    meta: { timestamp: 2, nested: { x: 2 } },
    metadata: 2,
    "a/b": 2,
    items: [3, 2],
  };
  const changes = compare(before, after, {
    ignorePaths: ["/meta", "/a~1b", "/items/0"],
  });
  assert.deepEqual(changes, [
    { kind: "changed", path: "/metadata", before: 1, after: 2 },
  ]);
  assert.deepEqual(compare(before, after, { ignorePaths: [""] }), []);
  assert.throws(
    () => compare(before, after, { ignorePaths: ["meta"] }),
    /JSON Pointer/,
  );
  assert.throws(
    () => compare(before, after, { ignorePaths: ["/bad~2escape"] }),
    /JSON Pointer/,
  );
});

test("partial ignored array additions still export reports but reject an invalid patch", () => {
  const sparse = compare([], ["hidden", "visible"], { ignorePaths: ["/0"] });
  assert.deepEqual(sparse, [{ kind: "added", path: "/1", after: "visible" }]);
  assert.throws(
    () => toPatch(sparse),
    /partially ignored array additions; ignore the whole array or clear ignore paths/,
  );
  assert.ok(toHTML(sparse).includes("visible"));
  assert.ok(toMarkdown(sparse).includes("visible"));
  const ignoredTail = compare([], ["visible", "hidden"], {
    ignorePaths: ["/1"],
  });
  assert.deepEqual(applyPatch([], toPatch(ignoredTail)), ["visible"]);
  const ignoredWholeArray = compare(
    { items: [] },
    { items: [1, 2] },
    { ignorePaths: ["/items"] },
  );
  assert.deepEqual(toPatch(ignoredWholeArray), []);
});

test("ignore rules cannot silently leak descendants of atomic container changes", () => {
  const profile = { name: "A", token: "hidden" };
  for (const [before, after] of [
    [{}, { profile }],
    [{ profile }, {}],
    [{ profile }, { profile: null }],
    [{ profile: false }, { profile }],
  ]) {
    assert.throws(
      () => compare(before, after, { ignorePaths: ["/profile/token"] }),
      /inside an atomic .*ignore the whole container/,
    );
  }
  assert.throws(
    () => compare(null, { profile }, { ignorePaths: ["/profile/token"] }),
    /\(root\)/,
  );
  assert.deepEqual(compare({}, { profile }, { ignorePaths: ["/profile"] }), []);
  const nonexistent = compare(
    {},
    { profile },
    { ignorePaths: ["/profile/absent"] },
  );
  assert.deepEqual(applyPatch({}, toPatch(nonexistent)), { profile });
});

test("patches cannot silently shift retained ignored array indices", () => {
  const shifted = compare(["a", "b", "keep"], ["a"], { ignorePaths: ["/2"] });
  assert.deepEqual(shifted, [{ kind: "removed", path: "/1", before: "b" }]);
  assert.throws(
    () => toPatch(shifted),
    /preserves an ignored array index while removing earlier items/,
  );
  assert.ok(toHTML(shifted).includes("&quot;b&quot;"));
  const retainedEarlier = compare(["a", "keep", "c"], ["a"], {
    ignorePaths: ["/1"],
  });
  assert.deepEqual(applyPatch(["a", "keep", "c"], toPatch(retainedEarlier)), [
    "a",
    "keep",
  ]);
});

test("inputs, changes, redacted copies and patch values remain detached", () => {
  const before = { a: { token: "old", keep: 1 }, rows: [1, 2] };
  const after = { a: { token: "new", keep: 2 }, rows: [1], b: { keep: 3 } };
  const initialBefore = copy(before);
  const initialAfter = copy(after);
  const changes = compare(before, after);
  const snapshot = copy(changes);
  maskChanges(changes);
  toMarkdown(changes);
  toHTML(changes);
  assert.deepEqual(changes, snapshot);
  const patch = toPatch(changes);
  patch.find((operation) => operation.path === "/b").value.keep = 99;
  assert.equal(changes.find((change) => change.path === "/b").after.keep, 3);
  changes.find((change) => change.path === "/b").after.keep = 88;
  assert.deepEqual(before, initialBefore);
  assert.deepEqual(after, initialAfter);
});

test("default reports redact sensitive path ancestors and nested fields, patches remain exact", () => {
  const before = { token: { expiry: 1 }, config: null };
  const after = {
    token: { expiry: 2 },
    config: {
      password: "pass-secret",
      api_key: "api-secret",
      privateKey: "private-secret",
      Authorization: "auth-secret",
      cookie: "cookie-secret",
      nested: [{ accessToken: "access-secret", keep: "public" }],
    },
  };
  const changes = compare(before, after);
  const masked = maskChanges(changes);
  assert.equal(
    masked.find((change) => change.path === "/token/expiry").after,
    REDACTED,
  );
  const config = masked.find((change) => change.path === "/config").after;
  assert.equal(config.password, REDACTED);
  assert.equal(config.api_key, REDACTED);
  assert.equal(config.privateKey, REDACTED);
  assert.equal(config.Authorization, REDACTED);
  assert.equal(config.cookie, REDACTED);
  assert.equal(config.nested[0].accessToken, REDACTED);
  assert.equal(config.nested[0].keep, "public");
  for (const exportText of [toMarkdown(changes), toHTML(changes)]) {
    for (const secret of [
      "pass-secret",
      "api-secret",
      "private-secret",
      "auth-secret",
      "cookie-secret",
      "access-secret",
    ])
      assert.equal(exportText.includes(secret), false);
    assert.ok(exportText.includes(REDACTED));
    assert.ok(exportText.includes("public"));
  }
  assert.ok(toMarkdown(changes, { redact: false }).includes("pass-secret"));
  assert.ok(toHTML(changes, { redact: false }).includes("pass-secret"));
  assert.deepEqual(applyPatch(before, toPatch(changes)), after);
});

test("HTML is offline, text-escaped and records ignore and redaction settings", () => {
  const malicious =
    '</pre><script>alert(1)</script><img src="https://attacker.invalid/x" onerror="evil()">';
  const path = "/<script>alert(2)</script>`\n# injected";
  const changes = [{ kind: "added", path, after: malicious }];
  const html = toHTML(changes, { ignorePaths: ["/<script>ignored</script>"] });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("Content-Security-Policy"));
  assert.equal(/<script|<img|<link|<iframe|<svg/i.test(html), false);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Ignored paths:"));
  assert.ok(html.includes("partial comparison"));
  assert.ok(html.includes("redacted"));
  assert.ok(toHTML(changes, { redact: false }).includes("without redaction"));
});

test("Markdown fences contain backticks, HTML-like values and multiline paths", () => {
  const changes = [
    {
      kind: "changed",
      path: "/```\n# malicious",
      before: "old",
      after: "```\n<script>alert(1)</script>",
    },
  ];
  const markdown = toMarkdown(changes, { ignorePaths: ["/volatile"] });
  assert.ok(markdown.startsWith("# DiffFlair report"));
  assert.ok(markdown.includes("````json"));
  assert.ok(markdown.includes("/```\\n# malicious"));
  assert.equal(markdown.includes("\n# malicious"), false);
  assert.ok(markdown.includes("**Ignored paths:**"));
  assert.ok(markdown.includes("Arrays are compared by position."));
  assert.ok(toMarkdown([]).includes("No changes found."));
});

test("excessive depth, cycles and non-JSON inputs fail with actionable errors", () => {
  let deep = 0;
  for (let index = 0; index <= MAX_DEPTH; index += 1) deep = { inner: deep };
  assert.throws(() => compare(deep, {}), /maximum JSON depth/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => compare(cyclic, {}), /circular reference/);
  for (const invalid of [
    undefined,
    NaN,
    Infinity,
    1n,
    () => {},
    new Date(),
    [undefined],
    new Array(2),
  ]) {
    assert.throws(() => compare(invalid, null), /JSON|sparse array/);
  }
  assert.throws(
    () => toPatch([{ kind: "moved", path: "/x", after: 1 }]),
    /Unknown change/,
  );
});

test("seeded generated documents reconstruct exactly with an independent patch interpreter", () => {
  let state = 0x5eed1234;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
  const pick = (items) => items[Math.floor(random() * items.length)];
  function generate(depth = 0) {
    const type =
      depth >= 4 ? Math.floor(random() * 4) : Math.floor(random() * 6);
    if (type === 0) return null;
    if (type === 1) return random() > 0.5;
    if (type === 2) return Math.floor(random() * 100) - 50;
    if (type === 3)
      return pick(["", "plain", "日本語", "~/escaped", "<script>", "```"]);
    if (type === 4)
      return Array.from({ length: Math.floor(random() * 5) }, () =>
        generate(depth + 1),
      );
    const result = {};
    for (let count = Math.floor(random() * 5); count > 0; count -= 1) {
      Object.defineProperty(
        result,
        pick(["a", "b", "", "~", "/", "__proto__", "token"]),
        {
          value: generate(depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        },
      );
    }
    return result;
  }
  for (let index = 0; index < 700; index += 1) {
    const before = generate();
    const after = generate();
    const changes = compare(before, after);
    assert.deepEqual(
      applyPatch(before, toPatch(changes)),
      after,
      `Generated case ${index}`,
    );
    assert.deepEqual(
      compare(before, after),
      changes,
      `Determinism case ${index}`,
    );
  }
});
