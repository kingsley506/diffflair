# DiffFlair launch copy

## English

I built **DiffFlair** to make API changes easier to hand off.

Compare two JSON responses locally, ignore noisy fields, and export a readable HTML report that opens offline. Sensitive field values are masked by default using a heuristic. There is also a zero-dependency Node.js CLI and RFC 6902 patch export.

**JSON changes. Made clear.**

Try the demo: https://kingsley506.github.io/diffflair/

Source: https://github.com/kingsley506/diffflair

MIT licensed. Feedback and small, anonymized examples are welcome. If it helps your next handoff, a star helps others find it.

## 中文

我做了 **DiffFlair**，让 API 数据的变化更容易看清、交接。

在本地对比两份 JSON，忽略时间戳等噪声字段，再导出一份同事断网也能打开的 HTML 差异报告。报告默认按敏感字段名遮罩数值；这是启发式处理，分享前仍需检查。也提供零运行时依赖的 Node.js 命令行工具和 RFC 6902 Patch 导出。

**JSON 的变化，一目了然。**

在线体验：https://kingsley506.github.io/diffflair/

开源代码：https://github.com/kingsley506/diffflair

MIT 开源。欢迎反馈和提供经过匿名处理的小样例。如果能帮你省下交接时间，欢迎点个 Star，让更多开发者找到它。

## Short versions

**English:** DiffFlair turns JSON changes into shareable, offline reports. Compare locally, skip noisy fields, and mask sensitive field values by default. Browser workbench + zero-dependency CLI. MIT open source. https://github.com/kingsley506/diffflair · Demo: https://kingsley506.github.io/diffflair/

**中文：** DiffFlair：在本地看清 JSON 变化，一键导出可离线打开的差异报告。支持忽略噪声字段、启发式敏感值遮罩，配零依赖 CLI。MIT 开源。代码：https://github.com/kingsley506/diffflair · 体验：https://kingsley506.github.io/diffflair/

## Sharing note

The HTML report is the shareable artifact. Review it before sending: field-name masking does not detect every secret. JSON Patch exports contain original values and should be treated as source data.
