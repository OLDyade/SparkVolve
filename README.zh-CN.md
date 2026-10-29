<div align="center">

<img src="docs/assets/brand/logo.png" alt="SparkVolve — 双螺旋环绕星火的品牌标识" width="160" height="160">

# SparkVolve

**Evolve the Harness, Not the Model.**

不改模型权重，让 Harness 在任务中持续进化。

[![CI](https://github.com/OLDyade/SparkVolve/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/OLDyade/SparkVolve/actions/workflows/verify.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-202124?style=flat-square)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-Native_plugins-DDEAF5?style=flat-square&labelColor=202124)](docs/components.md)

[English](README.md) · [快速开始](#quick-start) · [工作原理](#工作原理) · [接入任务](#把你的任务接进来) · [项目全景](11.md)

![SparkVolve：固定模型，进化插件代码、配置与组合，以任务反馈沉淀可复用 Bundle](docs/assets/readme/hero.png)

</div>

一个基于插件化架构的 Harness 自进化框架，让 Agent 通过真实任务反馈，自主改造自己的能力结构，并将有效改进沉淀为可复用的插件。

> 过去我们给 Agent 装能力，现在让 Agent 自己决定需要什么能力、修改什么能力，甚至创造新能力。

## 三个核心设计

**插件即进化基因：让 Harness 从“人工装配”走向“自主重构”**<br>
把插件的配置、代码实现、组合拓扑纳入同一个进化空间。Agent 可以启停、调优、替换、重组，也可以创造新插件。

**进化也是插件：给已有 Harness 装上自进化能力**<br>
沿用 DeepSeek Harness / Cordis 原生生态，通过 Evolution Bundle 和 Preset 接入研究、编码与实验能力。

**进化成果也是插件：从实验分数到可安装的能力**<br>
有效改进随原始 Bundle、候选谱系、能力卡与复现实验一起交付，供其他开发者安装、验证和继续进化。

<details>
<summary>核心思想原文</summary>

# 让 Harness 自己进化

## Evolve the Harness, Not the Model.

不改模型权重，让 Harness 在任务中持续进化。

**一句话定位：** 一个基于插件化架构的 Harness 自进化框架，让 Agent 通过真实任务反馈，自主改造自己的能力结构，并将有效改进沉淀为可复用的插件。

核心记忆点不是“Agent 越用越聪明”，而是：

> 过去我们给 Agent 装能力，现在让 Agent 自己决定需要什么能力、修改什么能力，甚至创造新能力。

## 三个核心设计

### 1. 插件即进化基因：让 Harness 从“人工装配”走向“自主重构”

不再局限于 Prompt、Skills 优化，而是把插件的配置、代码实现、组合拓扑统一作为进化对象。

能启停、能调参、能替换、能重组，还能创造新的插件。

这是最值得投入研究的技术创新点。

### 2. 进化也是插件：给已有 Harness 装上自进化能力

不需要重新造一套 Agent Runtime。基于 DSH 原生插件体系，将优化器、实验控制、执行验证等能力装配到现有环境。

不是创造一个会进化的 Agent，而是让已有的 Harness 具备进化能力。

这是非常适合开源生态传播的产品创新点。

### 3. 进化成果也是插件：从实验分数到可安装的能力

自主发现问题、修改插件、验证收益，最后不只得到一个更高的 Benchmark 分数，还输出可安装的 Bundle、候选谱系与复现实验。

让一次进化的收益，成为其他开发者可直接复用的能力。

这是区别于仅展示优化曲线的研究原型的交付创新点。

</details>

## Quick start

**启动真实进化**：克隆仓库，准备 Node.js 24、Python 3、Docker 和官方 DeepSeek 密钥。将 `SPARKVOLVE_EGRESS_POOL` 设为部署方预留的私有网段，凭证放在仓库外的环境文件中，详见[启动指南](docs/quick-start.md)。

```bash
npm ci
npm start -- --env-file /absolute/private/deepseek.env
```

一个入口完成环境构建、三套任务冻结、DSH 自主改造、H0 与入选版本的独立验证，并在干净 Profile 中安装原始 Bundle，执行新的复用任务。默认使用官方 DeepSeek 和结构化数据示例，每题 **600 秒**；通过 `--recipe` 替换任务与种子插件，Excel 是可选示例。各阶段保留真实分数、失败记录及原包身份。

**先看实际记录**：用浏览器打开[交互式实验导览](docs/tour.html)，离线查看候选、逐题结果和下载记录，无需密钥。

| 想做什么 | 从这里进入 |
|:---|:---|
| 跑通一次进化 | [环境准备与启动](docs/quick-start.md) |
| 换成自己的任务 | [领域适配接口](docs/domain-adapters.md) |
| 直接使用进化成果 | [安装能力 Bundle](docs/use-capability.md) |

## 工作原理

![原生进化闭环：任务合同→DSH优化器→插件变异→构建与QA→DSH执行器→独立评分；证据回流优化器，候选经复验后导出安装](docs/assets/readme/evolution-loop.png)

**优化器决定怎样改，实验系统保证怎样比较。**<br>
DSH 优化器读取真实任务、轨迹和交付，研究原因并自主编码；控制器负责冻结版本、执行预算、调度与记账；独立评分器按固定规则检查交付。

| 进化动作 | 可以改变什么 |
|:---|:---|
| **Enable / Disable** · 启用 / 停用 | 能力、依赖与冗余插件 |
| **Tune / Swap** · 调优 / 替换 | 配置、提示词、Skills、工具实现与接口 |
| **Compose / Author** · 组合 / 创造 | 插件拓扑、作用域、事件接线与全新能力 |

原生开发资料、工具契约和行为实验台帮助优化器检验机制假设。候选经过构建与 QA，再进入真实任务；每轮的高分、退步、失败与成本都保留。通过独立复验的改进，可以封装为可安装能力。<br>
深入了解：[原生插件开发](docs/native-authoring.md) · [行为实验台](docs/behavioral-probes.md) · [架构与恢复](docs/architecture.md)

## 把你的任务接进来

![替换任务与适配器，复用同一进化引擎：输入、运行环境、种子插件、独立评分器；输出能力Bundle与可复核证据](docs/assets/readme/bring-your-task.png)

**通用进化框架，任务由你定义。** 商业 Excel 是首个示例；结构化事件与日志已通过第二领域接入，复用同一控制器。

| 你提供 | 用途 |
|:---|:---|
| **任务与输入** | 明确目标、文件、交付形式和稳定任务 ID |
| **运行环境** | 为任务提供模型、依赖与执行镜像 |
| **种子插件** | 给出进化起点，开放配置、实现和组合结构 |
| **独立评分器** | 将实际交付转为分数与获准反馈 |

准备好这些接口后，在实验合同中设置预算和选择规则，即可运行同一套进化循环。新领域需要实现并验证对应适配器。

[Excel 示例](examples/spreadsheet) · [结构化数据示例](docs/structured-data.md) · **[编写你的领域适配器 →](docs/domain-adapters.md)**

## 让结果带着证据交付

一次进化留下三种可复用资产：

| 能力 | 过程 | 证据 |
|:---|:---|:---|
| 冻结的原生 **Bundle** | 插件源码、装配配置与候选谱系 | 逐题评分、失败、轨迹与用量 |
| 安装到新 Profile 执行任务 | 导入历史变体继续改造 | 独立复验与能力卡 |

[官方 DeepSeek 端到端实验](docs/experiments/2026-10-28-official-deepseek-results.md)已完成自主插件改造、独立验证和原包安装复用：

| 验证阶段 | 实际结果 |
|:---|:---|
| 自主开发搜索 | H0 **56.25%** → H1 **81.25%** → H2 **100%** |
| 独立执行验证 | H0 **81.25%** → H2 **100%** |
| 原归档安装后业务复用 | **4 / 4** 合成任务通过 |

以上为公开合成任务的工程验收，尚不构成稳定提分或跨领域迁移证明。历史实验中的退步、语义错误和传输失败一并公开，详见[实验索引](docs/experiments/README.md)。

最新[插件变异方法对照与原包复用](docs/experiments/2026-10-29-closure-study-results.md)已完成三组、六次独立搜索和 124 次任务评分。一份自主候选在独立验证与新实例原包复用中均为 100%；十二份源码差异、退步分数与语义反例全部保留。当前结果尚未证明开放变异空间占优。[单命令启动验收](docs/experiments/2026-10-29-official-closure-results.md)另行验证了结构化数据任务的完整流程。

## 深入探索

| 方向 | 文档 |
|:---|:---|
| **理解方法** | [完整项目全景](11.md) · [架构](docs/architecture.md) · [组件与生命周期](docs/components.md) |
| **运行与扩展** | [完整用户旅程](docs/user-journey.md) · [领域适配](docs/domain-adapters.md) · [模型与版本](docs/compatibility.md) |
| **研究与复现** | [独立实验协议](docs/research-protocol.md) · [优化器自身进化](docs/optimizer-studies.md) · [实验索引](docs/experiments/README.md) |
| **交付与贡献** | [能力安装](docs/use-capability.md) · [发布](docs/releasing.md) · [贡献指南](CONTRIBUTING.md) · [安全边界](SECURITY.md) |

欢迎贡献新的任务适配器、插件变异机制与可复现实验。也欢迎带着失败案例提出 [Issue](https://github.com/OLDyade/SparkVolve/issues)。

---

基于 **DeepSeek Harness / Cordis** 原生插件生态构建。采用 [Apache-2.0](LICENSE)，第三方归属见 [NOTICE](NOTICE)，研究引用见 [CITATION.cff](CITATION.cff)。当前为开发版本，npm 与版本 Release 单独发布。
