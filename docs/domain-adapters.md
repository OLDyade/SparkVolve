# 接入一个任务领域

领域负责任务、能力和裁判；框架负责候选身份、实验调度、反馈、选择与资产交付。接入新领域无需在控制器添加题目分支。

```text
dataset/
├── inputs/<task>/       优化器获准读取的任务输入
├── evaluation/<task>/   独立裁判和必要私有材料
├── runtime/             原生 Provider / 环境 Bundle
└── optimizer-bundle/    优化方法 Bundle
seed/
├── package.json         dsh.bundle.patch + 许可 + 运行依赖
├── cordis.patch.yml     原生插件装配
└── ...                  能力实现
```

1. **定义任务清单。** 每题有稳定 ID、任务说明、输入路径和评分材料路径。`inputDigest` / `evaluationDigest` 为内容哈希；公开输入和评分目录必须分离。实验运行中不改清单。
2. **提供运行镜像。** 安装该领域必需的运行工具；以镜像 digest 固定。执行器看到 `/input` 只读、`/workspace` 可写、`/candidate` 只读，使用 DSH 原生模型与工具。
3. **提供种子 Bundle。** 通过 Cordis 注册工具、服务或事件能力。优化器可变更配置、实现和组合；包不能依赖仓库绝对路径或未分发的源码。
4. **定义必要 QA。** `candidate.qa` 在独立容器执行，验证真实原生激活和关键协议。它不代替业务评分，也不预置优化方向。示例检查工具注册，提交公式的正确性交给裁判。
5. **提供独立评分器。** 禁网容器只读挂载 `/input`、`/delivery`、`/evaluation`；在 `/workspace/result.json` 写入 `Grade`。裁判程序和私有材料不提供给优化器。
6. **冻结合同。** 用 `Experiment` schema 校验，明确主指标、失败分值、完整分母、重复次数、并发、预算和模型。使用 `init → evolve` 运行。

评分输出：

```json
{"score":0.8,"metrics":{"preserved":1},"feedback":"获准给优化器的具体诊断"}
```

`feedback` 会反馈给优化器，适配器应明确可公开范围，不能返回未授权答案。`metrics` 分别报告辅助指标；只有合同指定的主分决定搜索冠军。异常退出属于评分故障，保留交付后可显式重新评分；禁止把服务失败偷偷改成有效业务分。

现成例子：[`examples/spreadsheet`](../examples/spreadsheet)。`generate.py` 提供三题产品链路验收；`research.py` 提供四类公开业务任务及不同数值的 development / validation 输入。两者均为本项目合成数据，不能替代官方基准结果。
