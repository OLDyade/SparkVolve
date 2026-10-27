# 让 Harness 自己进化

## Evolve the Harness, Not the Model.

不改模型权重，让 Harness 在任务中持续进化。

一个基于插件化架构的 Harness 自进化框架，让 Agent 通过真实任务反馈，自主改造自己的能力结构，并将有效改进沉淀为可复用的插件。

## 三个核心设计

- **插件即进化基因：让 Harness 从“人工装配”走向“自主重构”**
- **进化也是插件：给已有 Harness 装上自进化能力**
- **进化成果也是插件：从实验分数到可安装的能力**

## 从这里开始

| 文档 | 内容 |
|---|---|
| [项目全景与核心指导](11.md) | 核心思想、开放指导原则、完整 ASCII 流程与后续重构蓝图 |
| [最新深度审校](docs/research/2026-10-27-harness-evolution-design-review.md) | 相关研究、DSH 机制、搜索方法、实验协议与贡献定位 |
| [前期生态审校](docs/research/2026-10-09-harness-blueprint-audit.md) | 历史概念核验与架构推敲 |
| [历史资料与同步记录](docs/research/archive/README.md) | 来源哈希、历史证据和迁移边界 |

本仓库作为后续设计与实现的主仓库，按照 `11.md` 推进。当前提交建立文档基线，尚未迁入原实验代码、测评数据、运行产物或可执行的 Quick Start；蓝图中的目标能力与已经验证的实现分别披露。

通用框架优先，商业 Excel 是首个场景。架构承接 DeepSeek Harness / Cordis 原生插件生态，研究归属与引用见调研文档。
