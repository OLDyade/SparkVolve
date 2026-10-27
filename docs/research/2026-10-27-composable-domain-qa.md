# 让 QA 接受完整插件组合

表格示例曾在通用原生装配 QA 通过后，再建立一个只有 SystemPrompt 和 Tools 的独立 Cordis Context，单独加载 `/candidate/index.mjs`。这个额外检查没有业务行为断言，却隐含规定了候选入口和依赖结构：合法的跨插件服务提供者不会加载，改名入口也无法接受检查。这会压缩真实搜索空间。

当前合同明确分开两层验收：

```text
冻结候选产物
    │
实际 Profile + 环境 patch + 候选 patch
    │
创建原生 Agent → 服务依赖 / 生命周期 / Preset / 工具 schema 审计
    │
candidate.qa = 命令 → 额外领域行为检查，非零退出即 qa_failed
candidate.qa = null → 明确没有额外领域检查
    │
任务执行 → 独立评分
```

完整装配始终执行。表格示例删除重复的单入口检查并显式使用 `null`；没有自动猜测、兼容旧入口或跳过失败的路径。额外检查可以读取 `/workspace/native/composition.json`，不能借此把原生激活成功当成业务正确。

## 核实依据

- 官方 [服务注入文档](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/user/develop/framework/service.md)：声明 `inject` 后，消费者等待服务可用。
- 官方 [装配语法](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset/skills/cordis-composition-reference/SKILL.md)：Profile 叠加 patch，插件可以通过 group、配置与服务作用域组合。
- 实际锁定 `0.2.1-rc.4`，核对 [auditRows 实现](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry/src/mount.ts)：等待插件树收敛，记录加载失败及缺失依赖。用这一机制检查实际装配。

原生回归覆盖原表格 Bundle、改名入口与跨插件服务/配置联合变化、缺失服务和非法 schema。最初测试夹具使用 `settings` 行 ID，与 SDK Profile 原生行碰撞；该失败暴露了真实装配差异，夹具改为独立的 `workbook-settings` ID，保留失败报告。没有修改 DSH 或隐藏装配失败。

本项属于工程验收；它证明联合变异能进入真实装配与后续评测。真实模型是否自主选择联合变异、是否获得可复验收益，仍由后续研究实验回答。

最终验收：31 项单元、8 项原生测试通过；runc 和 `he-runsc-20261019` 各 6 项实际容器测试通过。显式领域命令在原生装配通过后故意退出失败，候选保持 `qa_failed`、没有创建任务、再次调度不重跑。首轮容器夹具遗漏必需的构建声明，修正夹具后重验，原失败记录保留。只读 subagent 最终复核通过。镜像与源码哈希、证据目录见 [机器记录](../evidence/2026-10-27-composable-qa-acceptance.json)。
