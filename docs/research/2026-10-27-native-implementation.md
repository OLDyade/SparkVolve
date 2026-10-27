# DSH 原生实现核验与工程决策

本记录支持代码实现；项目核心思想以 [`11.md`](../../11.md) 原句为准。没有用历史实验分数代替新实现的验收。

## 版本事实

| 对象 | 本次核验 | 决策 |
|---|---|---|
| DSH GitHub 源码 | `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` | 引用固定 commit，避免随 main 漂移 |
| npm `@deepseek-ai/dsh-sdk-client` 与原生插件 | `0.2.1-rc.4`，2026-10-26 发布 | 实际执行以锁文件和 npm 发布物为准 |
| Cordis / Schemastery | `4.0.5` / `3.18.5` | 使用原生插件注册、依赖与销毁 |
| Node / npm | `24.16.0` / `12.2.0` | 跨平台原生测试；Docker 基础镜像固定 digest |

GitHub HEAD 与 npm 发布物存在 API 差异。例如源码中的拆分工具执行包没有对应 npm 发布物；实际 rc.4 的 `dsh-tools.ToolRuntime` 提供执行入口。仓库没有拼接不同版本接口。

主要来源：[DSH 固定源码](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60)、[npm SDK](https://www.npmjs.com/package/@deepseek-ai/dsh-sdk-client/v/0.2.1-rc.4)、[模型适配源码](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/llm/llm-pi-ai)。实际安装包的类型、实现和原生进程共同核验。

## 影响架构的事实

| 机制 | 核实结果 | 对应实现 |
|---|---|---|
| Profile / Bundle | Profile 按层装配；Bundle 在 package.json 声明 `dsh.bundle.patch` | 进化包和候选均为原生 Bundle；导出后用 `dsh plugin --profile … add` 验证 |
| Provider 配置 | 默认 SDK Profile 已有 `llm-pi-ai`；覆盖该节点的 providers 配置 | Venus 环境使用 `id: llm-pi-ai` 配置覆盖，避免重复挂载同一插件 |
| 工具注册与执行 | `ctx.tools.register(defineTool(...))`；输出 render 返回内容块 | 进化工具经过原生模型 schema 和原生工具执行链 |
| 生命周期 | Cordis Fiber 管理释放，`ctx.fiber.dispose()` 可撤销注册 | 原生测试验证注册、执行、销毁；卸载不声称撤销外部文件副作用 |
| SDK | 管理 DSH 子进程和 JSON-RPC；返回 result 不必然代表成功 | 额外检查根 `turn/end`，模型错误与退出码进入失败状态 |
| 重启 | Session 恢复不等于外部任务恢复 | SQLite 阶段、唯一容器名、冻结交付共同对账；执行缺失不重抽 |
| 遥测 | `llm/stream` 能观察原生 adapter 流；供应商内部重试不可全知 | 每次流调用 UUID、请求、结果、用量、耗时留痕；缺失用量单列 |
| 模型合同 | provider/model 与推理档位是适配器的准确路由 | 固定配置；未知路由、缺凭证、无完成事件立即失败 |

社区 [#10826](https://github.com/deepseek-ai/deepseek-harness/discussions/10826) 报告运行中热更新可能与 Agent Loop 的 idle 等待形成生命周期死锁。这是外部问题报告，本项目没有据此宣称复现。它支持当前选择：草稿离线修改，候选冻结后由新进程加载。

## 容器与 Excel 的实际边界

- DSH 原生模块加载器会把动态库复制到临时缓存。容器 `/tmp` 禁止执行时发生 `failed to map segment from shared object`；使用明确的 `exec,nosuid,nodev` 临时挂载后通过真实容器验收。[Docker tmpfs 官方说明](https://docs.docker.com/engine/storage/tmpfs/)
- openpyxl 的 `data_only` 读取已有缓存，不能自行计算公式。业务验收由独立 LibreOffice 容器重算后读取；公开合成用例的评分器与原 SpreadsheetBench 官方裁判没有混用。[openpyxl 官方说明](https://openpyxl.readthedocs.io/en/stable/tutorial.html)
- openpyxl 并不保证完整保留所有 Excel 对象。当前示例覆盖数值、公式、文字与批注；宏、形状、复杂图表和第三方扩展需要单独的能力与验收，不能从基础用例外推。
- Venus 模型快照与协议来自用户指定配置；已进行真实请求验证。网关内部供应商路由未由本仓库锁定，不把逻辑模型 ID 宣称为物理后端完全固定。

## 工程质量依据

[OpenSSF Best Practices](https://www.bestpractices.dev/en/criteria/0) 提供可验证构建、测试、依赖与安全披露的质量参照。仓库用锁文件、Actions SHA、类型检查、状态机测试、原生 SDK 测试、容器测试和真实模型验收兑现这些要求，不以徽章或代码量替代证据。

首次依赖审计发现 zod、undici、MCP client、fflate、yaml 的已知问题。依据官方修复范围采用明确版本覆盖，重新干净安装并运行原生验收，审计归零。涉及 [zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)、[undici advisory](https://github.com/advisories/GHSA-xjj6-f33q-929c)、[MCP advisory](https://github.com/advisories/GHSA-6prh-2h8m-c8cw)。覆盖清单在 package.json，更新时重新验证。

## 社区与 X 信号的使用

- [DSH 稳定性与重复工具调用讨论](https://x.com/xiaomovps/status/2113570114083893470)：用于提醒记录真实请求与完整失败成本，不能推导本项目收益。
- [Petri / Cordis 组合实践](https://x.com/AmoebaFarm/status/2114977001907818688)：作为原生生态复用线索，具体接口仍以源码和实际调用验证。
- [插件扩展传播案例](https://x.com/GithubProjects/status/2106678219412038141)：解释生态关注方向，不作为方法新颖性或效果证据。

研究结论必须继续区分：原生接线通过、真实模型完成闭环、固定任务质量变化、独立复验与迁移。四者不能互相替代。
## 运行中补充核验：预算、安装与依赖

- 原生 `SystemPrompt.context()` 会在 assembly / admission refresh 更新动态事实；本框架用它呈现执行预算，不新增 Agent Loop、强制续轮或保存门。
- 强制终止容器不会执行 JavaScript `finally`。调用统计由宿主再次读取持久 stream 事件生成，未完成请求单列。真实超时验收已暴露并覆盖这条路径。
- pnpm 更新至注册表核实的 `12.15.0`。安装脚本负责将平台二进制装到命令入口；阻止脚本会使 DSH 的 `spawn('pnpm')` 返回 `ENOEXEC`。项目仅授权已核实的精确依赖版本，Docker 从项目安装的命令路径运行。
- DSH 包安装与 Bundle 激活是两个状态。安装脚本失败后留下的依赖，重复 `add` 不必然重新启用；上游更新操作保留禁用选择。干净 Profile 的首次安装与实际模型工具调用已分别核验，不能只凭包管理器退出码宣称可用。
- 宿主自行安装 Bundle 时，宿主的 lockfile 与安装脚本授权仍由宿主管理；本项目的 npm overrides 不会传递成所有消费者的全局策略。

来源：[DSH Profile 与插件管理](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60)、实际安装的 `dsh-system-prompt@0.2.1-rc.4` 类型、`dsh-plugin-manager@0.2.1-rc.4` 的 `reconcile()` / `setBundleEnabled()`、`pnpm@12.15.0/install.js`、[pnpm 安装脚本授权](https://pnpm.io/cli/approve-builds)与[配置说明](https://pnpm.io/settings)。

