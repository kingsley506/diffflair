# Changelog

## 0.1.0 — 2026-10-14

First public release of DiffFlair.

- Browser workspace with English and Chinese interfaces, file import, path search, change filters, and ignored JSON Pointer paths.
- Standalone HTML and Markdown reports with common sensitive fields masked by default.
- RFC 6902 patch exports using original values, with checks for unsafe partially ignored array operations.
- Zero-dependency Node.js CLI with five output formats and check-mode exit codes.
- Tests for patch reconstruction, report escaping and masking, array boundaries, and CLI behavior.

Arrays compare by position. Masking uses field-name heuristics; review a report before sharing it. Inputs are limited to 2 MiB and 100 levels of nesting.
