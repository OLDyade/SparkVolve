# 把能力连同证据一起交付

`export` 为终态候选生成 `CAPABILITY.md`，从实际账本整理用途声明、版本身份、评分、失败、用量与运行条件。卡片和机器记录放在原始 Bundle 旁；不会重打包、改源码或改变已验收的 tarball。

```text
export/
├── CAPABILITY.md             安装者先读的能力与证据摘要
├── research-record.json      原始假设、合同、谱系与证据索引
├── experiment-report.json    导出时完整分母及逐次请求记账
├── source/                   原冻结源码与依赖锁
├── artifact/                 原构建产物（构建成功时）
└── bundle.tgz                实际运行的原包（构建成功时）
```

正常导出命令自动生成这些文件：

```bash
node dist/cli.js export --root /absolute/experiment \
  --candidate <candidate-digest> --output /absolute/new-export
```

| 安装者需要知道什么 | 卡片依据 |
|---|---|
| 这个包是什么版本 | 源码、构建、锁文件和 tarball 身份，以及两份导出 JSON 的 SHA-256 |
| 原本想解决什么 | 研究者 objective 与优化器 hypothesis 分别标注为声明 |
| 实际验证了什么 | 原合同用途、当前候选完整任务分母、评分、失败与领域约束 |
| 花了多少资源 | 当前候选执行用量、全实验共享优化器用量分别列出；缺失保持未知，费用为 null |
| 在哪里运行过 | 原模型、DSH Profile、镜像及执行隔离合同；不推断新环境的权限 |
| 如何继续使用 | 指向原始包、构建 manifest、依赖锁及原生安装指南 |

导出可以发生在一个候选终态、其他候选仍在运行时。因此卡片是带原事件位置的导出快照，不自动代表搜索最终报告。搜索结果不自动成为独立验证；验证合同也不自动证明未知任务迁移。模型文本采用字面数据块，不能把 HTML 或 Markdown 内容解释成卡片结构。

构建失败候选只有源码与研究档案，卡片明确没有可安装包。QA 失败或被拒绝的候选即便有 tarball，也继续标记为研究产物。卡片不改变冠军选择、安装授权或公开发布边界。

设计借鉴与固定源码见[新近生态核查](research/2026-10-28-ecosystem-delivery.md)。原始 Bundle 的实际安装和工具调用继续按[能力使用指南](use-capability.md)验收。
