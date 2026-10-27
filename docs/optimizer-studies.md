# 让优化器也参与进化

研究入口支持两种明确的实验合同。**优化器自进化**让元优化器生成 G，再从开发结果中选择 G*；**固定方法比较**提前冻结全部 G，逐个运行完整搜索与独立评估。两者复用原生 DSH、候选构建、执行恢复和记账，研究目的分别记录。

| 要回答的问题                                  | 合同                                                 | 最终评估对象                 |
| --------------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| 优化器能否改进自身，并提升后续搜索            | `OptimizerStudy`                                     | 开发阶段选择的 G* 与 G0      |
| 冻结方法或同 G 的宿主反馈条件如何影响搜索结果 | `FixedOptimizerComparison`，`kind: fixed-comparison` | 所有注册臂，不按中间得分删臂 |

## 优化器自进化

普通实验让优化器 G 改写任务 Harness H。Optimizer Study 把 G 的插件实现、配置和装配也放入研究空间：原生 DSH 元优化器读取实际搜索证据，自主提交新的 G；可信宿主用共同 H0 和相同预算上限比较它们。

当前状态：真实元优化器已生成并运行 G1，开发选择和最终独立评分均已完成。G0/G1 开发评分同为 1.0，按规则保留 G0；最终验证为 1.0。G1 的原生工具虽已注册，实际没有调用，源码审查还发现角色与观察作用域错误；它保留为研究记录。原冻结 G1/G0/H0 已独立安装并原生装配通过；完整分母、325 次请求与先前收尾错误见[实际研究报告](experiments/2026-10-28-optimizer-study-results.md)，不据此宣称 G 自进化收益。

```text
冻结研究合同 · G0 · H0 · 数据分区 · 每实例预算
                         │
              原生 DSH 元优化器
       读 G 会话 / H 轨迹 / 原始交付 / 开发反馈
       改写 G 的代码、配置、插件组合 → 构建与 QA
                         │
                G0 与各个冻结 G1
                         │
          ┌──────────────┴──────────────┐
          │ 开发研究：每个 G 从相同 H0 搜索 │
          │ 开发搜索 → 冻结 H* → 独立评分 │
          └──────────────┬──────────────┘
                         │ 开发规则选择 G*
              关闭元优化器控制接口
                         │
          ┌──────────────┴──────────────┐
          │ 最终验证：只运行 G0 与选定 G* │
          │ 新搜索实例 → 冻结 H* → 独立评分│
          └──────────────┬──────────────┘
                         │
            配对结果 · 完整失败 · 分层成本
```

## 合同决定比较条件

`OptimizerStudy` schema 从包的 `study-contracts` 入口导出。输入路径均相对于一个可信输入根目录；初始化冻结输入，运行期间不重新接受外部修改。

| 字段                                   | 约定                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `baseline` / `metaOptimizer`           | G0 和元优化器的源码摘要、实际构建身份、装配入口。构建产物与源码分别验真               |
| `developmentCases` / `validationCases` | 开发研究与最终验证实例。每个实例包含共同 H0、搜索合同和独立评分合同；两套数据路径分离 |
| `repetitions`                          | 每个方法、实例的完整搜索重复次数；不能将单次搜索中的多道题计作多个独立搜索实验        |
| `methodBuild` / `methodQA`             | 新 G 的实际构建环境，以及可选的独立行为验收。原生装配 QA 总会运行                     |
| `metaRuntime`                          | 元优化器的固定模型、运行镜像、权限和出口；没有候选可用的 Docker socket                |
| `budget`                               | 方法候选数、元优化器时间、并行搜索数；各子合同冻结 H 候选、探针和任务预算             |
| `selection`                            | 方法选择的失败限额；只有开发阶段决定 G*，最终验证结果不回流本轮优化                   |

所有方法使用同一实例合同和预算上限，实际消耗另记。模型每次请求的输出上限不等于累计 Token 限额；这里不承诺等 Token 搜索。失败的方法构建、失败的搜索和未完成工作保留原状态，不补抽、不切回其他方法掩盖失败。

## 运行与观察

先准备实际冻结的 G0、元优化器、H0 和研究输入，再初始化：

```bash
node dist/cli.js study-init --root /absolute/new-study \
  --spec /absolute/study.json --dataset /absolute/trusted-inputs

node --env-file=/absolute/private/model.env dist/cli.js study-run \
  --root /absolute/new-study --host 0.0.0.0 --port 18948 \
  --endpoint http://CONTAINER_REACHABLE_IP:18948 \
  --child-host 0.0.0.0 --child-endpoint http://CONTAINER_REACHABLE_IP:0

node dist/cli.js study-status --root /absolute/new-study
node dist/cli.js study-report --root /absolute/new-study --output /absolute/new-report.json
```

地址须替换为部署方确认容器可达的 IP。`--child-endpoint` 明确使用 `:0`，每个子实验首次绑定后持久保存实际端口；恢复使用原地址，占用冲突直接报错。父控制地址也有独立持久身份。

Ctrl-C 停止宿主观察，保留原容器和 attempt。使用原参数再次运行 `study-run` 恢复；它核实原合同、构建和任务身份，收集原容器，不重新抽样。

需要结束整个研究时，先停止活动宿主，再执行：

```bash
node dist/cli.js study-cancel --root /absolute/new-study
```

取消持有研究租约，关闭新工作准入，只处理账本注册的方法、搜索、评分和元优化器资源。实际停止、日志取证和移除完成后记录回收摘要；回收中断后再次执行同一命令沿原身份继续。已经完成的研究记录保持，原容器的同名替代物不会被当作旧资源移除。普通实验使用 `cancel --root <experiment>`。

## 固定方法比较

把希望比较的方法在运行前全部登记，适用于不同优化器、插件配置或研究机制的对照。每个方法使用同一 case 的 H0、任务、模型、候选和时间上限；各自完成搜索，按共同子合同选择 H*，再用冻结产物做独立评估。

```text
注册全部方法 + 显式基线 + case × 完整搜索重复
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
       G-A              G-B              G-C
   共同 H0 搜索      共同 H0 搜索      共同 H0 搜索
        │                │                │
   冻结 H-A*        冻结 H-B*        冻结 H-C*
        │                │                │
   独立评估          独立评估          独立评估
        └────────────────┼────────────────┘
                         ▼
        全部臂结果 · 实例配对差 · 失败/取消 · 实际成本
```

| 字段                        | 内容                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `kind`                      | 固定为 `fixed-comparison`，显式选择研究协议                                                                                    |
| `name` / `objective`        | 实验身份和研究问题                                                                                                             |
| `arms`                      | 至少两个 `{ id, method, hostSearchProtocol }`；method 是实际冻结的源码、构建产物和装配入口，协议控制该臂的宿主反馈与父版本范围 |
| `baseline`                  | 注册臂的 id，决定配对报告的参照；不依据分数重新选择                                                                            |
| `cases`                     | 每项含 `id`、共同 `seed`、`search` 和 `assessment`；结构与上面的研究实例相同                                                   |
| `repetitions`               | 每个 case 的完整搜索重复数；同一方法的重复使用此字段                                                                           |
| `budget.concurrentSearches` | 宿主并行搜索上限；实际每实例预算由共同子合同决定                                                                               |

该合同没有元优化器、开发方法选择或新的 G 构建配置；方法已经冻结，不能在运行中分叉、替换或提交 G。相同 G 配不同宿主协议可以成为两个臂，宿主仍只登记一份真实 G；相同 G、相同协议的重复使用 `repetitions`。注册检查拒绝重复臂、重复方法与协议组合、未注册的 baseline，以及公共方法/种子目录和封存数据目录的交叉。

`comparisonArm` 单独标识固定比较臂，`method` 保持 G 的内容身份。宿主在注册时验证每臂应用协议后的完整子搜索合同；报告按注册 baseline 臂配对，保留方法与协议，避免把两个同 G 条件合并。开发选择研究的 `comparisonArm` 为 `null`。

每份新子 Experiment 必填 `hostSearchProtocol`；每个固定 arm 同样必须声明。不会为旧注册补默认字段或静默迁移；旧研究保留原文件和对应代码版本，不能修改其 JSON 后继续沿用旧身份。

初始化和报告仍使用 `study-init` / `study-report`。运行只需子实验连接地址：

```bash
node dist/cli.js study-init --root /absolute/new-comparison \
  --spec /absolute/fixed-comparison.json --dataset /absolute/trusted-inputs

node --env-file=/absolute/private/model.env dist/cli.js study-run \
  --root /absolute/new-comparison \
  --child-host 0.0.0.0 --child-endpoint http://CONTAINER_REACHABLE_IP:0

node dist/cli.js study-report --root /absolute/new-comparison \
  --output /absolute/new-comparison-report.json
```

全部 case × repetition × arm 工作在执行前登记。运行失败、主动取消和未完成状态各自保留；终态失败按预注册失败值进入完整分母，尚在途的配对结果不当作已完成均值。重入同一合同收集原工作，不补抽。无元优化器的成本明确为不适用；搜索和独立评估的缺失用量仍保持未知。

固定比较采用 **case × repetition 配对块**：每块包含所有注册臂，派发顺序按重复编号轮转；两臂、两次重复对应 AB／BA。块内遵守 `concurrentSearches`，前块终态后才执行下一块，避免先跑完一整种方法再换另一种方法。计划在首次派发前持久化，实际执行仍记录原 `job.searching` 等事件；恢复接回已有工作，保留终态，不根据分数改变顺序。已有在途工作却没有相应派发计划时明确拒绝，不能补造历史计划。共享负载与供应商时间噪声仍需在研究报告中披露。

固定方法比较只提供可执行的实验协议，**不自动证明被比较方法的收益或因果效果**。同 G 的反馈对照由[宿主反馈视图](feedback-views.md)约束状态、事件、提交重放与证据入口；源码和公开输入仍可用于自主测试。相关研究设计与尚未准入的规模见[反馈因果协议](research/2026-10-28-feedback-causal-protocol.md)。

[真实反馈试验注册说明](experiments/2026-10-28-feedback-study-registration.md)提供独立驱动：先做无模型调用的合同／镜像预检，再在全新目录明确执行真实模型搜索。统计单位为完整搜索重复；单个产物在多道任务上的成绩不能扩大成多次独立进化。

实际 Docker + DSH 夹具已通过三方法验收：两方法完成搜索与独立评分，故意失败的方法保留分母及失败值；16 次请求中 15 次返回、1 次失败。终态重入前后 35 份执行/请求证据及清单不变，未打开元优化器接口。镜像内列明的 6 个运行文件与本地构建一致；[机器记录](evidence/2026-10-28-fixed-comparison.json)限定了这一验收范围。失败臂缺独立评分账本，用量完整性继续为 false；没有把它解释成零成本成功。

## 元优化器获得什么能力

| 原生工具                                   | 用途                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `optimizer_study_status` / `wait`          | 读取方法、开发实例、预算与已提交事件游标                              |
| `optimizer_study_search`                   | 查看注册开发搜索的 H 候选、任务、探针及真实 G episode 索引            |
| `optimizer_study_evidence` / `materialize` | 读取原始证据或发布原字节只读文件；G 会话与 H 任务轨迹采用不同引用类型 |
| `optimizer_study_branch` / `submit`        | 创建 G 源码草稿，提交代码与装配变异；冻结后独立构建和运行             |
| `optimizer_study_finish`                   | 所有已接纳开发工作结束后关闭开发；宿主才进入最终验证                  |

`branch` 返回实际可用的 `/workspace/<draft>`、父候选/源码/方法身份、父装配入口和 `targetRole: search-optimizer`。这是内层搜索优化器的草稿；运行中的元优化器保持冻结。同父同名重放保留已有编辑。`finish` 仅在控制器成功接受且调用未取消后使用 DSH 原生 `concludeTurn()`；HTTP 拒绝继续保留当前研究会话。

证据授权来自注册方法、搜索合同和实际执行身份。工具不提供私有 grader、assessment 文件或最终验证数据。元优化器可以读取开发方法评分用于选择；不能读取这些评分背后的私有验证材料。

`study-report` 将元优化器成本、G 搜索成本和独立评分成本分开汇总。缺失请求账本或用量字段显式保留；不把缺失解释为零消耗。实际模型收益、方法因果效果与跨任务迁移仍需预注册研究和独立重复支持。

生态来源、设计取舍与证据边界见 [G/H 研究依据](research/2026-10-28-optimizer-self-evolution.md)。

已完成实验的验收驱动可独立继续安装检查：`node scripts/verify-optimizer-study.mjs --verify-completed <原实验目录> --root <全新验收目录> --framework-package <已冻结支持包.tgz>`。该路径不调用 `study-init`、`study-run` 或模型，使用原注册 Profile 和原 G/H tarball，核对原证据摘要并输出新回执。任一包安装失败都会保留错误并继续检查其他独立包；整体失败不会改成通过。它不修改旧分数、旧失败或候选代码。
