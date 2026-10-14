# DiffFlair

**把 JSON 变化，变成同事能直接打开的离线报告。**

一个本地运行的 JSON 对比工作台。比较 API 响应或配置文件、忽略噪声字段，再导出清晰的 HTML 报告；接收者无需登录，也无需联网。

[打开工作台](https://kingsley506.github.io/diffflair/) · [English](README.md) · [参与贡献](CONTRIBUTING.md)

![DiffFlair 工作台：变化统计和清晰的前后值对比](docs/preview.jpg)

[查看离线报告示例](https://kingsley506.github.io/diffflair/docs/example-report.html)。

## 能做什么

- **找出实际变化：** 忽略 JSON 排版和对象键的顺序，用 JSON Pointer 标出每个变化的位置。
- **在本地处理：** 网页在浏览器中运行，CLI 在电脑上运行，无需后端或 API Key。
- **去掉噪声：** 可忽略 `/deployment/lastUpdated` 等字段，也可忽略整个子树。
- **生成离线报告：** 支持 HTML、Markdown 和 JSON，默认对疑似敏感字段的值进行遮罩。
- **导出可执行补丁：** 生成保留真实值的 RFC 6902 JSON Patch，便于应用变化。

零运行时依赖，无需构建。既可用网页，也可用 Node.js 命令行。

## 快速上手

打开[在线工作台](https://kingsley506.github.io/diffflair/)，加载内置示例。也可以使用 Node.js 22+ 在本地运行：

```sh
git clone https://github.com/kingsley506/diffflair.git
cd diffflair
npm start
```

按终端提示打开本地网址。也可直接运行 `node scripts/serve.mjs`，不需要安装依赖。

用仓库示例生成报告：

```sh
node bin/diffflair.mjs examples/before.json examples/after.json \
  --ignore /deployment/lastUpdated \
  --format html --output changes.html
```

用浏览器打开 `changes.html`。结果与样式包含在这一个文件中，示例中的 token 值会被遮罩，报告也会记录比较规则。

## CLI 常用命令

```sh
# 快速查看变化
node bin/diffflair.mjs before.json after.json

# 导出 Markdown
node bin/diffflair.mjs before.json after.json --format markdown --output changes.md

# 导出默认遮罩的 JSON 报告
node bin/diffflair.mjs before.json after.json --format json

# 导出保留真实值的 RFC 6902 补丁
node bin/diffflair.mjs before.json after.json --format patch --output changes.patch.json

# 忽略多个路径及其子树
node bin/diffflair.mjs before.json after.json --ignore /meta --ignore /requestId

# 让变化结果影响退出码，适合自动化检查
node bin/diffflair.mjs before.json after.json --check
```

| 参数 | 含义 |
| --- | --- |
| `--format` | `summary`（默认）、`json`、`patch`、`markdown` 或 `html` |
| `--output FILE` | 写入文件；不设置时输出到 stdout |
| `--ignore POINTER` | 忽略路径及其所有子路径，可重复设置 |
| `--no-redact` | 在 JSON、Markdown 和 HTML 报告中保留真实值 |
| `--check` | 有变化返回 `1`，一致返回 `0` |
| `--help` | 显示帮助 |

参数错误、输入无效或文件操作失败时返回 `2`。不设置 `--check` 时，比较成功均返回 `0`；设置后仍会正常生成指定格式的结果。

路径采用 [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901)，如 `/user/name`。路径中的 `~` 写成 `~0`，`/` 写成 `~1`。`--ignore ''` 会忽略整个文档；忽略规则针对子树，不支持通配符。

## 遮罩报告与真实补丁

报告默认对 `password`、`token`、`secret`、`authorization`、`apiKey` 等疑似敏感字段的值进行遮罩，也覆盖嵌套内容。这是启发式规则：普通字段名下的秘密、字符串内部的敏感文字以及敏感路径名仍可能出现在报告中。分享前请检查导出的内容；`--no-redact` 可关闭遮罩。

**Patch 始终包含真实值。** 遮罩后的值无法还原目标文档，因此补丁需要按原始数据对待。使用了忽略路径时，补丁仅还原参与比较的变化，未必能生成完整的 `after` 文档。

部分被忽略的数组新增会导致索引空洞，部分删除会移动被忽略项的索引。这些情况会拒绝导出补丁，请清除相应忽略规则或忽略整个数组；报告仍可正常导出。

HTML 报告无需外部运行资源，可以离线打开，并会显示比较规则。

## 比较边界

- 每份输入不超过 **2 MiB**、100 层深度，必须是合法 JSON；CLI 要求 UTF-8 编码。
- 数组**按位置**比较。重排可能显示为多处修改，不会识别移动或按对象 ID 匹配。
- 整个容器被新增、删除或替换为其他类型时，忽略其中的某个后代路径会产生歧义。此时会提示你忽略整个容器，或移除该忽略规则。
- 使用 JavaScript 数值精度，超大整数 ID 建议保存为字符串。
- 对象键顺序与空白字符不产生差异。重复键遵循 `JSON.parse` 的行为，保留最后一个值。
- 结果仅覆盖所选比较范围。被忽略的数据不参与输出，启发式遮罩也不能替代完整的秘密扫描。

## 开发与贡献

```sh
npm test
# 等同于 node --test
```

测试覆盖对比引擎、补丁应用、报告转义与遮罩、CLI 行为。GitHub Actions 使用 Node.js 22 和 24。

欢迎带着匿名化的小样例[提交 Issue](https://github.com/kingsley506/diffflair/issues)，告诉我们哪种 API 数据或交接方式还不够清楚。项目结构和贡献规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。

MIT 开源。如果它帮你节省了一次解释 JSON 变化的时间，欢迎点个 Star，让更多开发者找到它。
