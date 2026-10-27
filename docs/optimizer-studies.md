# 让优化器也参与进化

研究入口支持两种明确的实验合同。**优化器自进化**让元优化器生成 G，再从开发结果中选择 G*；**固定方法比较**提前冻结全部 G，逐个运行完整搜索与独立评估。两者复用原生 DSH、候选构建、执行恢复和记账，研究目的分别记录。

| 要回答的问题 | 合同 | 最终评估对象 |
|---|---|---|
| 优化器能否改进自身，并提升后续搜索 | `OptimizerStudy` | 开发阶段选择的 G* 与 G0 |
| 预注册的不同方法如何影响搜索结果 | `FixedOptimizerComparison`，`kind: fixed-comparison` | 所有注册方法，不按中间得分删臂 |

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

| 字段 | 约定 |
|---|---|
| `baseline` / `metaOptimizer` | G0 和元优化器的源码摘要、实际构建身份、装配入口。构建产物与源码分别验真 |
| `developmentCases` / `validationCases` | 开发研究与最终验证实例。每个实例包含共同 H0、搜索合同和独立评分合同；两套数据路径分离 |
| `repetitions` | 每个方法、实例的完整搜索重复次数；不能将单次搜索中的多道题计作多个独立搜索实验 |
| `methodBuild` / `methodQA` | 新 G 的实际构建环境，以及可选的独立行为验收。原生装配 QA 总会运行 |
| `metaRuntime` | 元优化器的固定模型、运行镜像、权限和出口；没有候选可用的 Docker socket |
| `budget` | 方法候选数、元优化器时间、并行搜索数；各子合同冻结 H 候选、探针和任务预算 |
| `selection` | 方法选择的失败限额；只有开发阶段决定 G*，最终验证结果不回流本轮优化 |

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

| 字段 | 内容 |
|---|---|
| `kind` | 固定为 `fixed-comparison`，显式选择研究协议 |
| `name` / `objective` | 实验身份和研究问题 |
| `arms` | 至少两个 `{ id, method }`；method 是实际冻结的源码、构建产物和装配入口 |
| `baseline` | 注册臂的 id，决定配对报告的参照；不依据分数重新选择 |
| `cases` | 每项含 `id`、共同 `seed`、`search` 和 `assessment`；结构与上面的研究实例相同 |
| `repetitions` | 每个 case 的完整搜索重复数；同一方法的重复使用此字段 |
| `budget.concurrentSearches` | 宿主并行搜索上限；实际每实例预算由共同子合同决定 |

该合同没有元优化器、开发方法选择或新的 G 构建配置；方法已经冻结，不能在运行中分叉、替换或提交 G。注册检查拒绝重复臂、重复方法身份、未注册的 baseline，以及公共方法/种子目录和封存数据目录的交叉。注册身份不通过添加默认字段改写历史合同。

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

固定方法比较只提供可执行的实验协议，**不自动证明被比较方法的收益或因果效果**。若比较完整反馈与盲变异，仍需宿主实际限制反馈入口；仅更换提示词不能宣称完成盲实验。相关研究设计与尚未准入的规模见[反馈因果协议](research/2026-10-28-feedback-causal-protocol.md)。

实际 Docker + DSH 夹具已通过三方法验收：两方法完成搜索与独立评分，故意失败的方法保留分母及失败值；16 次请求中 15 次返回、1 次失败。终态重入前后 35 份执行/请求证据及清单不变，未打开元优化器接口。镜像内列明的 6 个运行文件与本地构建一致；[机器记录](evidence/2026-10-28-fixed-comparison.json)限定了这一验收范围。失败臂缺独立评分账本，用量完整性继续为 false；没有把它解释成零成本成功。

## 元优化器获得什么能力

| 原生工具 | 用途 |
|---|---|
| `optimizer_study_status` / `wait` | 读取方法、开发实例、预算与已提交事件游标 |
| `optimizer_study_search` | 查看注册开发搜索的 H 候选、任务、探针及真实 G episode 索引 |
| `optimizer_study_evidence` / `materialize` | 读取原始证据或发布原字节只读文件；G 会话与 H 任务轨迹采用不同引用类型 |
| `optimizer_study_branch` / `submit` | 创建 G 源码草稿，提交代码与装配变异；冻结后独立构建和运行 |
| `optimizer_study_finish` | 所有已接纳开发工作结束后关闭开发；宿主才进入最终验证 |

`branch` 返回实际可用的 `/workspace/<draft>`、父候选/源码/方法身份、父装配入口和 `targetRole: search-optimizer`。这是内层搜索优化器的草稿；运行中的元优化器保持冻结。同父同名重放保留已有编辑。`finish` 仅在控制器成功接受且调用未取消后使用 DSH 原生 `concludeTurn()`；HTTP 拒绝继续保留当前研究会话。

证据授权来自注册方法、搜索合同和实际执行身份。工具不提供私有 grader、assessment 文件或最终验证数据。元优化器可以读取开发方法评分用于选择；不能读取这些评分背后的私有验证材料。

`study-report` 将元优化器成本、G 搜索成本和独立评分成本分开汇总。缺失请求账本或用量字段显式保留；不把缺失解释为零消耗。实际模型收益、方法因果效果与跨任务迁移仍需预注册研究和独立重复支持。

生态来源、设计取舍与证据边界见 [G/H 研究依据](research/2026-10-28-optimizer-self-evolution.md)。

已完成实验的验收驱动可独立继续安装检查：`node scripts/verify-optimizer-study.mjs --verify-completed <原实验目录> --root <全新验收目录> --framework-package <已冻结支持包.tgz>`。该路径不调用 `study-init`、`study-run` 或模型，使用原注册 Profile 和原 G/H tarball，核对原证据摘要并输出新回执。任一包安装失败都会保留错误并继续检查其他独立包；整体失败不会改成通过。它不修改旧分数、旧失败或候选代码。
