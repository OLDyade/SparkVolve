# 官方 DeepSeek 原生接入

采用锁定 DSH 的 `@deepseek-ai/dsh-llm-deepseek-api-key` 插件、`deepseek-official` 提供方和官方 Messages 入口。无需中转服务；没有备用提供方或自动重试。

`model.json` 声明模型、推理模式、输出预算和凭证变量。`cordis.patch.yml` 使用官方 `/models` 于 2026-10-28 返回的 `deepseek-flash` 元数据：DeepSeek-V4.1-Flash、1,048,576 上下文、393,216 输出上限、文本/图像输入、in-history system 更新及 addition-only 工具更新。示例实际输出预算为 32,768，推理模式为 off。服务端只公开别名；本地冻结配置和目录响应不能保证别名背后的模型权重永远不变。

将 `DEEPSEEK_API_KEY` 放在仓库外的私有环境文件中，权限设为 `0600`。模型凭证只进入可信出口代理，DSH 执行进程拿到本地占位值。`egress.mjs` 生成精确的 `/anthropic/v1/messages` 路由，显式保留适配器的 `anthropic-version`、`anthropic-beta` 和 `accept` 请求头，不发送模型目录探测，也不改写请求正文。官方目前说明 version 被忽略、beta 除 Files 图片场景外被忽略；保留协议头不代表它们是旧流中断的原因。

首次体验可直接运行 `npm start -- --env-file <private.env> --pool <reserved-CIDR>`，自动构建并启动；默认官方 DeepSeek，无需单独拼接准备命令。见[启动指南](../../docs/quick-start.md)。

需要自行编排实验时，表格场景的准备命令显式选择提供方目录：

```bash
node examples/spreadsheet/prepare.mjs <dataset> <immutable-image> \
  examples/deepseek/model.json <spec.json> <isolation.json> examples/deepseek
```

完整原生开发验收包含 4 类业务任务、最多 2 个自主候选、独立 H0/入选版本验证和原归档安装。任务、模型 HTTP、原生 QA 与探测默认 600 秒，优化器总预算按计划等待推导：

```bash
node --env-file=/absolute/private/deepseek.env scripts/verify-native-authoring.mjs \
  --root <new-evidence-root> --image <immutable-spreadsheet-image> \
  --model examples/deepseek/model.json --provider-directory examples/deepseek \
  --isolation <isolation.json> --controller-ip <reachable-IPv4> \
  --install-policy <install-policy.json>
```

再使用 `scripts/verify-installed-capability.mjs` 在四个干净原生 Profile 中安装同一归档并执行业务任务；工程结果与业务分数分别记录。完整运行状态见 [完成记录](../../docs/completion.md)。

已有开发证据可通过 `--research-brief <development-evidence.md>` 交给优化器。驱动在推理前冻结正文、摘要和自身源码，正文只进入开发目标；独立验证合同不受影响。不得把验证集答案或验证反馈塞进该文件。每个新机制使用新证据目录，保留原失败，不修改旧合同或补跑旧分数。

协议依据：[官方模型目录](https://api-docs.deepseek.com/api/list-models/)、[Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api/)、[推理与工具调用](https://api-docs.deepseek.com/guides/thinking_mode/)。实际适配器版本固定为 DSH 0.2.1-rc.4。
