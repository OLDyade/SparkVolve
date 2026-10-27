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
| [可执行架构与边界](docs/architecture.md) | 原生插件、控制服务、身份、恢复、隔离与成本 |
| [当前实现核验](docs/research/2026-10-27-native-implementation.md) | 实际发布物、源码差异、原生验证和工程决策 |
| [真实模型端到端验收](docs/acceptance.md) | 自主代码变异、真实评分、失败裁决和原生安装后的实际任务 |
| [连续进化与独立复验](docs/acceptance-continuous.md) | 三次真实变异、双会话接续、负结果与研究资产复用 |

## 它如何运行

```text
任务与实验合同
      │
      ▼
DSH 优化器 ── 真实证据 ──► 改写插件配置 / 实现 / 组合
      ▲                              │
      │                              ▼
      │                      冻结 Bundle → 独立 QA
      │                              │
      │                              ▼
      │                    DSH 执行器 × 固定任务清单
      │                              │
      └── 评分、轨迹、交付 ◄── 独立评分 / 完整分母
                                     │
                          严格择优 → 独立复验 → 可安装 Bundle
```

优化器沿用 DSH Agent Loop 和编码工具，依据反馈选择改动。控制器只执行实验合同：冻结、调度、记账、评分与选择。框架没有预置题目答案或逐题变异脚本。

## Quick start：真实 Excel 闭环

需要 Node **24.16.0**、npm **12.2.0**、pnpm **12.15.0** 和运行中的 Docker。示例采用用户指定的 Venus 模型快照；其他模型通过原生 DSH Provider 配置接入。没有自动模型降级。

```bash
npm ci
npm run check
docker build -t harness-evolution:local .
docker build --build-arg HARNESS_IMAGE=harness-evolution:local \
  -f examples/spreadsheet/Dockerfile -t harness-evolution-spreadsheet:local .

mkdir -p .evolution/business
docker run --rm \
  --mount type=bind,src="$PWD/examples/spreadsheet",dst=/example,readonly \
  --mount type=bind,src="$PWD/.evolution/business",dst=/workspace \
  harness-evolution-spreadsheet:local python3 /example/generate.py /workspace/dataset

node examples/spreadsheet/prepare.mjs .evolution/business/dataset \
  "$(docker image inspect harness-evolution-spreadsheet:local --format '{{.Id}}')" \
  examples/venus/model.json .evolution/business/spec.json

node dist/cli.js init --root .evolution/business/search \
  --spec .evolution/business/spec.json --dataset .evolution/business/dataset \
  --seed examples/spreadsheet/seed
```

将密钥写入仓库外权限为 `0600` 的环境文件，变量名为 `VENUS_API_KEY`。一条命令管理控制服务、执行、评分和优化器会话。端口需空闲，Docker 必须能到达控制服务。macOS Docker Desktop / OrbStack 可通过 `host.docker.internal` 到达宿主；Linux 需明确配置可达接口与防火墙。

```bash
node --env-file=/absolute/private/venus.env dist/cli.js evolve \
  --root .evolution/business/search --host 127.0.0.1 --port 18948 \
  --endpoint http://host.docker.internal:18948

# 查看真实产物与裁决
node dist/cli.js status --root .evolution/business/search
```

示例生成公开合成 XLSX 业务任务，使用真实模型和独立 LibreOffice 重算。它验证产品闭环，不能代表 SpreadsheetBench 分数、迁移收益或统计显著性。历史私有题库、答案和运行产物没有进入仓库。

## 复验与安装

从 `status` 取得冻结候选 digest。[独立复验指南](docs/research-protocol.md)用同一预注册协议运行基线与候选，记录逐题、重复和配对差异；validation 不开放优化器 API。发布决策由研究证据支持，搜索冠军不会自动变成公开版本。

```bash
node dist/cli.js export --root .evolution/business/search \
  --candidate <digest> --output /absolute/new-export-directory

# 导出的 capability Bundle 可直接装入 DSH 的目标 Profile
dsh plugin --profile sdk add /absolute/new-export-directory/<bundle>.tgz
```

进化设施自身同样可安装：`npm pack` 后通过上述原生命令装入 Profile，设置 `EVOLUTION_ENDPOINT` 与 `EVOLUTION_TOKEN`，即可贡献状态、分支、提交、证据、候选源码和结束搜索六项工具。优化器的研究方法也由独立、冻结的原生 Bundle 提供；模型自主选择变异，框架管理实验生命周期。

研究资产支持 `remember → library → import`：保留有效候选与负结果、谱系、来源、账本和证据哈希。导入产生新的可编辑草稿，历史分数不会转移到新实验。详见[架构](docs/architecture.md)。

## 可靠性与证据

- 状态机与单写租约，唯一任务身份，断点接回原容器。
- 固定题集、完整分母、独立评分；同分拒绝，失败与负结果保留。
- 评分故障可以对同一冻结交付 `rescore`；不会重做任务刷分。
- 原生请求账本区分成功、失败、未完成与缺失用量，优化器和执行器分别记账。
- 类型检查、原生 SDK 子进程、容器执行、独立评分、恢复与安装分别验收。

```bash
HE_TEST_IMAGE=$(docker image inspect harness-evolution:local --format '{{.Id}}') npm run test:container
npm audit --audit-level=moderate
```

当前能力和未验证边界明确记录于[架构](docs/architecture.md)与[安全说明](SECURITY.md)。参与开发见 [CONTRIBUTING.md](CONTRIBUTING.md)，接入新任务见[领域适配](docs/domain-adapters.md)，运行版本见[兼容性](docs/compatibility.md)。

采用 [Apache-2.0](LICENSE)，引用信息见 [CITATION.cff](CITATION.cff)，第三方归属见 [NOTICE](NOTICE)。仓库当前保持私有；许可证选择不代表已经公开发布。

通用框架优先，商业 Excel 是首个场景。架构承接 DeepSeek Harness / Cordis 原生插件生态，研究归属与引用见调研文档。
