# 完整原生插件装配 QA

审查 `11.md` 时发现，原示例 QA 只在独立 Cordis Context 中加载插件入口。它能够检查工具 schema，但没有验证候选 patch 声明的服务、嵌套组合、停用与替换关系。

本次接入独立的原生装配阶段：

```text
冻结候选 + 固定 Profile + 固定环境 Bundle
                  │
          DSH SDK 原生启动
                  │
       创建实际 Agent（不发模型请求）
                  │
   Loader 原生审计 + Preset 诊断 + 工具 schema
                  │
          领域合成业务 QA
                  │
           正式执行与独立评分
```

采用安装版本 `0.2.1-rc.4` 的原生 `DeepSeekHarness.start()`、`HarnessSession.getWorkingDirectory()`、`auditRows()` 和 `agentPresets` API。创建 Agent 会触发原生作用域与生命周期初始化，QA observer 在 `agent/created` 收集实际装配状态。没有调用 `run()` 或发送模型 prompt。

所有启用行必须能够激活；有意停用的插件由 Loader 的 disabled 状态表达。缺失服务、导入失败、配置失败及 broken Preset 会使 QA 失败，保留原生日志与可取得的 `composition.json`。这条门验证程序是否可运行，不判定业务答案或强制模型执行额外检查。合成业务 QA 与官方质量评分各自保留。

QA 容器沿用固定执行镜像，按原顺序加载环境与候选 patch，网络关闭。凭证只通过固定模型声明的环境变量提供给原生 Provider 初始化，不写入配置或报告。报告保留模块、生命周期状态及工具 schema，不序列化 Provider 配置。正式执行保持既有原生流程。

本次验证：17 项单元、6 项原生、1 项真实容器集成、1 项原生包安装测试通过，类型与格式检查通过。新增原生测试覆盖标准 SDK 和 minimal SDK、嵌套插件服务绑定、缺失服务与导入失败。容器测试实际经过新增 QA 后再执行任务、中断恢复、独立评分与打包；安装测试从分发包经原生 DSH 安装后调用工具。协议夹具用于工程验收，未计作真实模型质量结果。

本次容器镜像 ID 为 `sha256:1c16914bb5b293bab1891f8763841625acfc017c82052dbccb24577df74e095f`，原始容器证据保留于本地 `he-container-oxNNJc`。独立方向评审通过；构建生命周期和专用 Preset 仍未完成。

来源：

- [DSH SDK 的启动和 Session 操作](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/client/src/api.ts)
- [Preset 原生装配与 auditRows](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry/src/mount.ts)
- [Preset 注册与生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry/src/index.ts)

完整装配 QA 不等于候选构建系统，也不证明模型质量提高。其余全景缺口单独记录于 [落实状态](../completion.md)。
