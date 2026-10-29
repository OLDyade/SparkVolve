# 插件变异空间对照 · 预注册

登记时间：2026-10-29，模型调用前。核心问题：相同优化器、起点与预算下，开放插件实现和装配结构，是否比仅修改提示词更容易产生有效改进？

本研究比较三种**可修改范围**，不把它标记为 GEPA 复现，也不混入人工修正版。模型仍通过 DSH 原生插件能力读取证据、编写代码与提交候选。

| 固定项 | 登记 |
|---|---|
| 模型 | 官方 DeepSeek，G/H 均使用 `deepseek-flash`，off，maxTokens 32768；服务端别名无法承诺权重永远不变 |
| 运行底座 | DSH 0.2.1-rc.4 / Cordis 4.0.5；镜像内容 ID、全部运行文件摘要在运行目录冻结 |
| G | 同一份 evidence-driven Bundle、同一源码与构建产物 |
| H0 | 同一表格插件，增加所有组共享的原生 systemPrompt 文本槽 `guidance.md` |
| 反馈与祖先 | full；所有候选从 H0 分叉，避免祖先链差异混入方法对照 |
| 数据 | 四个公开合成业务家族；开发与验证采用不同数值，验证产物不进入搜索反馈 |
| 重复 | 每组两次独立搜索，共六次；每次 H0 + 最多两个新候选 |
| 任务预算 | 每题 600 秒；每次搜索四题并发，最多两个搜索并行；各组同等优化器预算 |
| 选择 | 开发集主指标严格提高；保留与调用成本报告。独立验证不会反向选 G 或 H |

## 三组处理

| 组 | 可修改内容 | 禁止改变的内容 |
|---|---|---|
| prompt | `guidance.md` 自由文本 | 插件实现、依赖与装配 |
| single-plugin | `guidance.md`、`index.mjs`、`workbook.py` | 依赖、装配与额外文件；可改同一插件内部工具和实现 |
| open-plugins | 整个候选 Bundle | 固定模型、评测、任务与权限合同 |

前两组通过通用合同 `hostSearchProtocol.editableFiles` 精确约束源码文件。控制器比较 H0 与候选的完整文件清单、内容和可执行位；增加、删除或改动范围外文件会在接纳前直接报错。开放组仍使用正常候选构建、原生装配与评分链路。具体变异由模型选择，不预先指定新工具或公式。

这项约束控制**候选源码范围**，不会关闭执行器原有的 Shell 或文件工具。单插件实现也能新增内部能力，因此三组不能被理解为严格递增的智能等级。

## 分母、分析与执行

上限为 104 次任务执行：开发搜索 3 组 × 2 次 × 3 候选 × 4 题 = 72；选中 H 的独立验证 24；共享 H0 独立验证 8。另记 G 推理、构建、原生装配与评分成本。提前终止未消耗的候选预算如实记录，不补跑凑数。

实验单位是一次独立搜索，每组只有两次。逐搜索、逐题报告 H* 与同次 H0 的差值，同时给出原始分数、失败、Token、请求数量及耗时；不把八个任务样本当作八次独立进化，不给显著性承诺。每次被选中的 H 还需检查实际源码差分，区分是否真正发生实现或组合变化。

执行顺序由冻结 study job 清单决定，完整时间戳保留。共享机器的并发和官方模型别名都是混杂因素。终态搜索失败采用合同失败分，未观察到的独立验证槽保留为 null；质量失败、服务失败不自动重试，负结果不改写。

```bash
node --env-file=/absolute/private/deepseek.env scripts/verify-feedback-study.mjs \
  --comparison mutation-space --root <NEW-study-directory> \
  --image <immutable-spreadsheet-image> --isolation <isolation.json> \
  --model examples/deepseek/model.json --provider-directory examples/deepseek \
  --controller-ip <container-reachable-IPv4>
```

加 `--check-contracts` 只检查镜像、原生运行环境、构建与合同，不请求模型。首次模型调用之前写入 `research-registration.json`。原始状态在 study 账本中；`validation-comparison.json` 只读汇总，不能覆盖原始评分。

本实验覆盖同类合成任务的新数值，不能代表官方 SpreadsheetBench、未见业务领域或普适方法优势。后续扩展须另行登记，不能追溯调整本轮协议。
