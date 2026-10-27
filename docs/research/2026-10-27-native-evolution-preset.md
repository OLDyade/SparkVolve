# 原生 Evolution Preset 核实与实现

核实日期：2026-10-27。官方 master 实查为 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`，运行包固定 `0.2.1-rc.4`。

| 原生机制 | 源码结论 | 项目实现 |
|---|---|---|
| SDK Session | server 明确采用 host-plane，无 SDK Preset 参数 | 显式 SDK 桥接插件，不虚构参数或 fork SDK |
| Agent 创建 | 串行 `agent/created` 全部完成后才释放排队输入，失败回滚创建 | 在首个请求之前调用原生 `select` |
| Session 恢复 | `agentPreset` 投影包含初始身份与后续选择；有历史的 Session 禁止 `select` | 恢复调用 `mount` 还原记录中的身份，不追加伪造选择 |
| Preset 定义 | 原生声明插件创建共享 revision、作用域 Loader 树；引用全部释放后处置退休版本 | 六项工具和研究方法处于同一个 Evolution Preset，普通会话不可见 |
| 方法组合 | 原生 Include 支持文件条目、相对模块和生命周期 | 合同固定 `composition` 清单，整棵方法插件树在 Preset 作用域加载 |
| 分发 | Bundle patch 可插入声明，后续 patch 可替换完整配置 | 进化设施 Bundle 提供 Preset；方法 Bundle 显式替换其子插件清单 |

SDK standard 的编码工具仍由其官方 Profile 提供。本项目增加有作用域的进化能力，并未声称每项宿主能力都由 Preset 隔离。执行器与优化器的文件、模型配置、容器及记账分别受实验合同管理。

验证发现 SDK `RunResult.events` 只覆盖本次活动区间，创建时的 Preset 选择不必出现在该数组。因此恢复与身份验收读取实际注册表/Session 投影，并检查下一次真实模型请求，避免把事件区间误当完整日志。

测试包括同进程作用域隔离、进程重启后原 Session 恢复、缺失定义首请求前拒绝、独立方法包安装和真实优化器容器调用控制服务。测试 Provider 是协议夹具，未产生质量结论。首轮容器夹具暴露未创建任务目录及未声明 reasoning 支持，均修正夹具并保留失败输出；未对质量实验重抽。

分发验收还发现 Include 的相对 `config.path` 从 Profile 目录解析，不能假定它随方法 Bundle 移动。独立方法包现使用明确的 package export 注册实现；容器内冻结的方法清单仍通过绝对挂载路径交给原生 Include。原生 spawn 的实际子会话已验证继承 Preset、方法与六项能力，执行真实控制 API 后完成并由原生管理器处置。

最终验收：`npm run check`（18 单元 + 8 原生）、3 项真实容器测试、进化设施与方法双包原生安装全部通过。容器镜像身份为 `sha256:b5ef3b023a9ef576fe946bdb7dfac233fe2b6bdf3fd6dae188058a2692163cea`。安装用时 71.096 秒；容器套件保留原始日志、Session、构建及评分产物。此处为本地验收，不替代尚受 GitHub 账户账单限制的云端 CI。

## 原始依据

- [SDK server 创建与恢复 Session](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/server/src/server.ts#L481)
- [Agent 创建生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent/src/index.ts#L552)
- [Preset Registry 的作用域、恢复与边界](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry)
- [官方 Web Standard Preset 的完整子插件组合](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/bundle/web-app/presets/standard.patch.yml)

对应本地已安装包 README 和实现另行逐项核对，原生 Bundle 与 Preset 不等同于容器安全边界。
