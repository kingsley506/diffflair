# Contributing to DiffFlair

Thanks for helping make JSON changes easier to understand.

## Run the project

Use Node.js 22 or newer. There are no dependencies to install.

```sh
node scripts/serve.mjs
node --test
```

Open the URL printed by the server to work on the browser UI.

## Where things live

| Path | Purpose |
| --- | --- |
| `index.html`, `src/app.mjs`, `styles.css` | Browser workbench |
| `src/engine.mjs` | Comparison, masking, JSON Patch, and report generation |
| `bin/diffflair.mjs` | Node.js CLI |
| `test/` | Tests using Node's built-in test runner |
| `examples/` | Small, fictional comparison fixtures |
| `scripts/serve.mjs` | Local static server |

## Propose a change

For a bug, include a small before/after pair, expected result, actual result, and browser or Node version. Replace real credentials and personal data with fictional values before posting.

For substantial features, open an issue first so we can agree on the use case. Improvements to readability, report portability, comparison correctness, and accessibility are especially useful.

Keep pull requests focused. Explain the problem and the resulting behavior. Run `node --test`; if you change comparison logic, patch operations, escaping, or masking, add a test that demonstrates the behavior. For UI changes, include a screenshot and check a narrow viewport and keyboard navigation.

## Design principles

- Inputs stay local. Avoid introducing a backend, telemetry, or remote runtime assets into the comparison flow.
- Preserve the zero-dependency runtime where practical.
- Reports should explain their comparison rules.
- Masking must remove sensitive values from exported data, not merely hide them visually.
- RFC 6902 patches must remain applicable and preserve original values.
- Keep array matching and ignore semantics explicit.

Contributions are licensed under the repository's MIT license.
