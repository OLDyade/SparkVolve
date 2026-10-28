# 组件与生命周期

本页描述当前实现。完整目标与核心思想保留于 [`11.md`](../11.md)，未完成能力列于[交付状态](completion.md)。

## 原生组合与实验边界

```mermaid
flowchart TB
  Contract["版本化实验合同<br/>模型 · 数据 · 预算 · 选择规则"]
  subgraph Native["DeepSeek Harness / Cordis"]
    Preset["Evolution Preset<br/>方法 Bundle + 进化工具"]
    Optimizer["优化器 Agent<br/>原生编码 / 研究 / 事件等待"]
    Executor["执行器 Agent<br/>冻结候选的插件树"]
    Preset --> Optimizer
  end
  subgraph Protected["受保护实验服务"]
    API["控制 API<br/>草稿 · 证据 · 提交 · 资产库"]
    Store["SQLite<br/>租约 · 事件 · 谱系 · 裁决"]
    Controller["实验控制器<br/>构建 · 调度 · 恢复"]
    API --> Store
    Store --> Controller
  end
  Contract --> Controller
  Optimizer <-->|"状态与持久游标"| API
  Controller -->|"冻结 Bundle"| Executor
  Controller --> Probe["原生行为实验<br/>冻结草稿 + 独立测试 · 禁网"]
  Probe -->|"机制观察，不计任务分数"| Store
  Executor --> Delivery["不可变交付 + Session 轨迹"]
  Delivery --> Grader["独立评分容器<br/>私有评测材料 · 禁网"]
  Grader --> Store
  Store --> Export["同一构建产物 + 研究档案"]
  Export --> Library["授权研究资产库"]
  Library --> API
```

| 组件 | 责任 | 实现入口 |
|---|---|---|
| 进化 Bundle / Preset | 将进化工具与可替换方法装入选定 Agent 作用域 | [`plugin.ts`](../src/plugin.ts)、[`preset.ts`](../src/preset.ts)、[`sdk-preset.ts`](../src/sdk-preset.ts) |
| 优化器方法 | 从证据选择父版本、机制和变异规模；可以独立版本化 | [`optimizers/evidence-driven`](../optimizers/evidence-driven) |
| 原生插件开发能力 | 按需查询 DSH 作者契约和官方 Skill；记录安装来源，G 观察与候选 H 的验证分开 | [`native-authoring.ts`](../src/native-authoring.ts)、[开发能力装配](native-authoring.md) |
| 优化器研究 | 原生元优化器修改 G，可信宿主调度同预算子搜索与封闭最终验证 | [`study-plugin.ts`](../src/study-plugin.ts)、[`optimizer-study.ts`](../src/optimizer-study.ts)、[研究协议](optimizer-studies.md) |
| 控制器与状态 | 冻结、构建、调度、续接原容器、选择与持久事件 | [`controller.ts`](../src/controller.ts)、[`store.ts`](../src/store.ts) |
| 构建与装配 | lock 固定依赖；运行产物冻结；审计完整原生插件树 | [`build.ts`](../src/build.ts)、[`composition.ts`](../src/composition.ts) |
| 原生行为实验 | 自主编写机制测试；独立预算、冻结与反例证据 | [`probes.ts`](../src/probes.ts)、[使用协议](behavioral-probes.md) |
| 执行与隔离 | 原生 DSH 会话、明确 OCI runtime 与权限、请求用量 | [`runtime/worker.ts`](../src/runtime/worker.ts)、[`docker.ts`](../src/docker.ts) |
| 评测与研究 | 独立 grader、声明的领域约束、固定产物配对复验 | [`constraints.ts`](../src/constraints.ts)、[`validation.ts`](../src/validation.ts) |
| 交付与复用 | 导出原构建包、保存来源、导入新草稿重新评测 | [`export.ts`](../src/export.ts)、[`library.ts`](../src/library.ts) |

## 优化器研究的两层闭环

```mermaid
flowchart TB
  Contract["研究合同 · G0/H0 · 数据分区 · 预算"] --> Study["可信 Study 协调器"]
  Meta["原生 DSH 元优化器<br/>方法研究 Bundle"] <-->|"开发证据与事件"| API["Study 能力接口"]
  API --> Study
  Meta -->|"G 代码 / 配置 / 装配草稿"| Freeze["冻结 G · 实际构建 · 原生 QA"]
  Freeze --> Study
  Study --> Dev["开发：G0 / G1 × 固定搜索实例"]
  Dev --> Search["既有进化引擎<br/>从共同 H0 搜索并冻结 H*"]
  Search --> Assess["独立评分<br/>保留全部样本"]
  Assess -->|"开发方法比较"| API
  Assess --> Select["开发规则选择 G*<br/>关闭元优化器接口"]
  Select --> Final["最终验证：G0 / G*<br/>新搜索 → H*<br/>独立评分"]
  Final --> Report["配对结果 · 原始谱系<br/>元优化 / 搜索 / 复验成本"]
```

上图描述已接入代码的扩展模式，[真实模型研究及原包安装](experiments/2026-10-28-optimizer-study-results.md)已经完成，开发同分保留 G0，未证明优化器自进化收益。最终验证没有返回元优化器的连线；开发质量、最终质量和工程验收分别记录。原生 G 会话证据与 H 任务轨迹均可读取，权限以注册实例和执行身份为准。

## 一个候选的生命周期

```mermaid
stateDiagram-v2
  [*] --> Draft: 选择父版本 / 创造插件
  Draft --> Frozen: 提交与源码身份
  Frozen --> BuildFailed: 安装或编译失败
  Frozen --> Built: 锁定依赖与构建产物
  Built --> QAFailed: 装配 / 显式领域检查失败
  Built --> Running: 原生完整装配通过
  Running --> Decision: 全部任务终结 / 失败预算停止
  Decision --> Champion: 质量严格提高且显式约束满足
  Decision --> Rejected: 同分 / 退步 / 约束或失败预算不满足
  BuildFailed --> [*]
  QAFailed --> [*]
  Rejected --> [*]
  Champion --> [*]
```

图中的 Draft、Built、Decision 表示操作阶段；源码中的候选 `phase` 是 `frozen / build_failed / qa_failed / running / rejected / champion`。任务执行、评分和重评分分别记账；导出保留研究记录，晋级不触发公开发布。

## 事件驱动接续

```mermaid
sequenceDiagram
  participant A as DSH 优化器
  participant C as 控制服务
  participant S as SQLite 事件账本
  participant W as 执行与评分容器
  A->>C: 提交候选
  C->>S: 冻结身份与提交事件
  A->>C: status → cursor
  A->>C: evolution_wait(cursor)
  C->>W: 构建、QA、执行、独立评分
  W-->>C: 实际交付与退出状态
  C->>S: 原子提交结果与事件
  S-->>C: 唤醒等待者
  C-->>A: 事件页 + next cursor
  A->>C: 读取原始证据，选择下一变异
  Note over C,W: 控制器重启后收集原容器，保持任务身份
  Note over A,S: 事件游标可重放；等待超时不触发任务重跑
```

插件的启停、调优、替换、组合与创造由优化器依据证据选择。固定合同、独立评测和内容身份由实验层执行。各角色共用 DSH 生态，运行目录、权限与用量分别管理。
