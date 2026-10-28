# 实验与证据

[返回首页](../../README.md) · [实验协议](../research-protocol.md) · [实现状态](../completion.md)

这里保留实际运行结果，包括收益、退步、失败与尚未成立的结论。公开合成任务的工程验收与正式 Benchmark 研究分别解释。

| 实验 | 观察与边界 |
|---|---|
| [官方 DeepSeek 原生闭环](2026-10-28-official-deepseek-results.md) | 自主改造、独立验证、原归档安装及四类任务复用；同时保留人工修复衍生包的业务退步 |
| [联合插件开发](../acceptance-joint-development.md) | 65.625% → 81.25%；候选含不接受的启发式恢复，未作为接受能力分发 |
| [联合候选独立复验](2026-10-28-joint-independent-results.md) | 基线 93.75%，候选 77.08%；24/24 次评分，拒绝晋级 |
| [同 G 反馈对照](2026-10-28-paired-feedback-results.md) | 4 次独立搜索、8 次变异、60 次任务评分；均值差不能归功于变异 |
| [连续搜索与接续](../acceptance-continuous.md) | 三次真实变异、会话接续、失败与负结果 |
| [结构化数据领域](../acceptance-structured-data.md) | 同一控制器完成第二领域变异、评分、拒绝退步及安装调用 |
| [优化器自身进化](2026-10-28-optimizer-study-results.md) | G/H 分别版本化、等预算比较与封闭验证 |
| [原生行为实验](2026-10-28-native-probe-spreadsheet-results.md) | 工具机制的真实调用、反例和显式失败 |
| [公开 CI 与分发](2026-10-28-public-ci-and-delivery.md) | 云端检查、运行时矩阵与同一 tarball 安装 |

## 连续搜索记录

![连续搜索与独立复验的完整结果](../assets/experiment-results.svg)

图表来自[机器记录](../evidence/2026-10-27-continuous-acceptance.json)。复验中存在一次传输故障和两次取消，保留完整分母；不以开发集最高分代替稳定收益结论。

## 核查与复现

- [原始端到端验收](../acceptance.md)
- [干净检出用户旅程](../research/2026-10-28-user-journey.md)
- [原生实现核验](../research/2026-10-27-native-implementation.md)
- [候选原字节证据](../evidence-access.md)
- [能力卡与用量](../capability-cards.md)
- [发布与登记故障恢复](../research/2026-10-28-publication-recovery.md)
- [研究资产复用](../research-assets.md)
- [生态与设计深度审校](../research/2026-10-27-harness-evolution-design-review.md)
- [评审落实账本](../review-ledger.md)
- [历史资料与同步来源](../research/archive/README.md)

导出自己的实验报告：`node dist/cli.js report --root <实验目录> --output <新文件.json>`。该命令读取现有产物，不重跑任务。
