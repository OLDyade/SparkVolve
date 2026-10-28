# 普通搜索结束：宿主结论与原生回合结束对齐

真实反馈研究结束后发现普通搜索工具的接线遗漏：`evolution_finish` 已成功登记宿主结论，DSH 仍生成了一次总结请求。此前的结束协议测试覆盖 `optimizer_study_finish`，不能据此声称普通搜索路径也已结束原生回合。

## 原始证据与根因

运行：`.evolution/feedback-study-live-paired-20261028`。Full 第二次搜索 job `2055d52b48575b21330b2b03f23beea5f1d8a95d7dea4c04ac986908a2ad0586` 的 `optimizer/0/trace/notifications.jsonl`：

| 事件 | 观测 |
|---|---|
| seq721 | step100 调用 `evolution_finish` |
| seq722 | 工具成功，回执已含 `conclusion.reason/at/champion` |
| seq724 / seq726 | step101 发起新请求并生成总结 |
| seq728 | 回合自然完成 |

额外请求 `b553c0cd-5700-4a15-bdd7-ac30b23acca7` 耗时 5528 ms，报告输出 617 tokens。这次搜索最终正常结束；未观察到结论丢失或候选重跑。

旧领域镜像 `sha256:ed2c995b6233c41995925b9407d6ab01312f052015cae60a22a4b8871e09715f` 内的 `dist/plugin.js` 与核查时本地构建逐字相同，普通工具只调用 HTTP `/finish`。`dist/study-plugin.js` 的元优化器工具已经调用 `exec.concludeTurn()`。原始测试位于 `tests/native/study-finish.test.ts`，仅覆盖后者。

| 原始证据 | SHA-256 |
|---|---|
| 普通插件 `dist/plugin.js` | `5758065926888f6a4f2e563bc5113fc1e5f2d8bdef642821a10371a2539fe832` |
| 元优化器 `dist/study-plugin.js` | `e473ef62f05bb069ae575c9b2521b53d49855f3d33d36847cfc095b0e131cffe` |
| 上述 notifications.jsonl | `31e8ec42fbceaf8b33f23772d369b0eb11f08d5bcdbc4e65c49407f39602702e` |
| 同目录 requests.jsonl | `33f331f498e8d3c8cec222c57d4fef35b3009cd60ba8231fb848a89730b1a2c4` |

## 原生语义与修复

DSH 的 [工具协议](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/subsystems/tools.md) 将 `concludeTurn()` 定义为成功工具结果上的终止标记。安装版 `@deepseek-ai/dsh-tools@0.2.1-rc.4` 在 `lib/index.js:3251、3659–3665` 生成标记；`dsh-agent-loop/lib/index.js:573` 在提交结果时收集该标记。工具失败不能产生成功终止结果；已经提交的 steering/context 仍遵循原生调度。

普通 `evolution_finish` 现采用与元优化器相同的顺序：

```text
请求 /finish → 宿主成功确认 → 检查调用取消信号 → concludeTurn → 返回原回执
                   │                │
                HTTP 失败         已取消
                   └──── 原生错误结果，不标记成功结束
```

不改宿主结束条件、选择规则、评分及数据权限。研究在 `2026-10-27T21:47:09.175Z` 已终态后才改源码；旧研究、原镜像和额外请求记录保留，不将修复后的调用成本追溯到旧成绩。

## 验证

- `npm run typecheck` 通过，三个修改/新增代码文件 Prettier 通过。
- `node --import tsx --test tests/native/evolution-finish.test.ts`：5 项通过，0 失败。
- 直接原生 Tools 调用验证成功标记、HTTP 拒绝无标记、待确认时 AbortController 取消无标记。
- 实际 SDK 子进程验证：成功只请求一次；HTTP 拒绝继续到第二次请求；宿主回执未返回时关闭 runtime，原调用拒绝且没有第二次请求。

测试使用本地确定性 LLM 协议适配器和 HTTP 宿主夹具，原生 DSH 装配、工具管线和 Agent Loop 真实执行；没有调用付费模型，也没有把此测试当作质量收益证据。[SDK 官方合同](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/client/README.md) 明确没有 prompt-cancel RPC，本测试按实际接口通过 `runtime.close()` 取消拥有的运行时。
