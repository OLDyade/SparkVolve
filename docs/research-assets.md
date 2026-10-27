# 让一次进化成为下一次研究的起点

```text
已完成候选：成功 / 退步 / QA失败
       │ export / remember
       ▼
研究档案：源码 + 构建身份 + 假设 + 负结果 + 谱系
       │ 研究者授权，写入新实验合同并冻结
       ▼
evolution_library → evolution_asset → 优化器决定是否复用
                                        │
                                evolution_import
                                        ▼
                         新草稿 + 持久来源记录
                                        │ 自主修改代码 / 配置 / 组合
                                        ▼
                        当前实验构建 → QA → 全量评分
```

三个原生工具提供检索、查看和导入，选择与修改交给 DSH 优化器。按原文检索，不按历史分数自动挑选；失败档案同样可发现。导入不执行插件，不把插件装进优化器，也不继承旧成绩或冠军资格。

## 授权和使用

1. 用 `harness-evolve remember --root <旧实验> --candidate <digest> --library <目录>` 收集终态档案。每个子目录以 archive ID 命名。
2. 选择允许优化器阅读的档案，复制到**新实验数据集**的 `research-assets/`。审查其中源码、任务描述和反馈的访问权限。
3. 用 `harness-evolve digest <数据集>/research-assets` 得到目录摘要，在新实验合同中声明：

```json
"researchLibrary": {
  "directory": "research-assets",
  "digest": "<目录的 SHA-256 摘要>"
}
```

不授权时明确填写 `"researchLibrary": null`。`init` 冻结数据集；控制器启动和每次库访问均核对快照。优化器不能指定宿主文件路径，也不能在实验途中扩大资产范围。研究库由宿主 API 按 ID 提供，不作为整个文件系统挂载到优化器。

`evolution_library` 返回 ID、研究目标、机制假设和历史结果；`evolution_asset` 返回完整研究记录、来源文件清单，指定文件时返回原始 base64 字节；`evolution_import` 将选中源码复制到 `/workspace/<draft>`。后续 `evolution_submit` 给新候选附上 `origin`，重新走当前合同的独立评测。

## 身份与中断语义

| 身份 | 含义 |
|---|---|
| archiveId | 原实验 UUID、完整实验规格摘要、候选源码摘要的组合身份 |
| recordDigest | 完整研究记录内容摘要，包含历史反馈的具体版本 |
| sourceCandidate | 实际复制源码的目录摘要 |
| researchLibrary.digest | 本次允许优化器阅读的完整资产快照 |

摘要证明内容对应关系，不证明作者身份、研究结论或成绩真实。当前本地授权模型不宣称 SLSA 签名认证。查看旧任务或反馈后，这些数据已经进入优化器的可见范围，不能继续称为未见评测。

导入先写 `pending` 意图，在优化器无法访问的 staging 中复制和校验，再发布草稿、提交 `ready` 来源记录。`pending` 草稿禁止提交候选。中断后重复同一导入可接续；已完成的导入返回原草稿，不覆盖之后的修改。更换同名草稿的来源直接报错。中断的私有 staging 留作诊断，不作为候选。

原合同、原分数和旧谱系用于解释来源；新的选择状态只接受本轮实际构建、执行与评分。独立复验实验不开优化器 API。

## 验收

单元验收覆盖未授权拒绝、私有目录重叠、路径越界、元数据/源码篡改、来源跟随提交，以及复制前、发布后和响应丢失三个中断点。原生工具注册、容器任务恢复和真实模型检索导入分别验证；真实模型测试使用显式合成历史档案，不能作为质量收益。

```sh
HE_TEST_IMAGE=sha256:<运行镜像摘要> node --env-file=/安全目录/venus.env \
  --import tsx --test tests/live/library.test.ts
```
