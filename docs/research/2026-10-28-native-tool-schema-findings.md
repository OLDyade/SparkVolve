# 原生工具契约：一次真实变异为什么没有进入任务执行

核查时间：2026-10-28。范围为[已注册反馈研究](../experiments/2026-10-28-feedback-study-registration.md)第一配对块的原生装配失败。研究继续使用原冻结版本；本页不修改候选、评分或后续臂，也不提前下质量结论。

## 官方契约与实际版本

通过 Context7 发现文档，再读取 DeepSeek Harness 官方 `master` 的固定提交 [`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60)。[Tools 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/subsystems/tools.md)与[工具编写指南](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/cookbook/adding-a-tool.md)明确区分作者使用的 `ParameterSchemaSpec`／`ValueSchemaSpec` 和编译后的模型 JSON Schema。

| 作者需要遵守的契约                                              | 当前安装版的实际行为                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 参数根为属性映射；必填属性写 `required: true`，可选属性省略该键 | `@deepseek-ai/dsh-tools@0.2.1-rc.4` 的 `runSchemaCompiler` 拒绝 `required: false`              |
| 显式 object 节点声明布尔值 `additionalProperties`               | 编译器拒绝缺失字段及 schema 对象值；通用 JSON Schema 的 schema-valued 写法不能直接搬入作者 DSL |
| 嵌套 object、array、标量各自遵循对应节点规则                    | 修复必须落在报错路径对应的节点，给其他层补字段不能修复原节点                                   |
| `execute` 返回 `output.schema` 声明的规范 JSON 值               | `output.render` 负责显示；装配成功仍需实际调用才能验证业务行为                                 |

本地核对位置为 `node_modules/@deepseek-ai/dsh-tools/lib/index.js:603` 与 `:699`；文件 SHA-256：`1e53932e7c4213ea24a7d87f06960b7a7702cb21f8a5741c97242b4a470a442a`。上述契约同时具有官方文档和本轮运行依赖的证据，不依赖对标准 JSON Schema 的印象。

## 实际发生了什么

Full-0 自主新增 `workbook_verify`，目标是在独立评分前让执行器观察原生重算值。候选 `ba1a581e…` 的 `parameters.cells.additionalProperties` 被写成 `{ type: 'array', items: ... }`，原生装配直接拒绝。后续候选 `6c291d78…` 修改了数组元素附近的字段，却仍保留同一个非法 `additionalProperties` 对象；两次装配因此出现同一错误：

```text
parameters.cells.additionalProperties must be explicitly true or false
```

第二次失败的实际报告：

```text
.evolution/feedback-study-live-paired-20261028/study/children/
3635b67d52b6c76bcf3efb5b88f34908e09652bc880f2c517fa936707a7339d8/
qa/6c291d7866c7517162b456c5987f7d3b207c24aefd409b99fbda71784ae5218f/
work/native/composition.json
SHA-256: 6d8d19d60a6c00c1ed6d4f4ed37ef0c48860942ef84cfb158bc29ef67aae5181
```

两个候选均未进入任务执行。候选提案写下的“预计通过 QA”及业务收益属于优化器假设；不能据此宣称工具已使用或公式质量已改善。Mechanical-0 也经历过可选参数写成 `required: false` 的失败，后续候选通过了装配；两种错误均应归入原生接口使用问题。

## 对实现与方法的含义

原生 QA 在此准确暴露了不可装载的工具，没有证据支持放宽 DSH 契约、自动改写 Schema 或替候选补救。可检验的后续问题是：优化器是否读取并正确应用了精确版本的作者契约，能否根据明确报错完成对应节点的修正。代码可安装、工具实际被调用、任务质量改善需要分别取证。

这项发现支持改进插件作者文档与研究归因；它尚不能证明新增说明会提高变异成功率，也不能把整轮质量差异归因于这一类接口错误。当前研究的候选预算、反馈权限和原始失败记录保持不变。
