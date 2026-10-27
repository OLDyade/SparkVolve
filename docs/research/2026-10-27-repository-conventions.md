# 开源仓库建设依据

用户指定参考 [XHToken/dsh-intelligent-router](https://github.com/XHToken/dsh-intelligent-router)，本次核验固定到 [`d762b8e8ebd9f07dcea34fe2da56202f9f727fe4`](https://github.com/XHToken/dsh-intelligent-router/tree/d762b8e8ebd9f07dcea34fe2da56202f9f727fe4)。

| 借鉴方向 | 本仓库落实 |
|---|---|
| 一句话理解价值与机制 | 保留用户核心原句，README 给完整反馈流程和入口 |
| 原生插件安装与调用说明 | `npm pack → dsh plugin add`；独立分发测试实际调用已安装工具 |
| 版本和运行边界透明 | 固定 DSH、Node、npm、镜像；兼容性文档与失败记录 |
| 可参与、可引用、可验证 | Contribution、Issue / PR 模板、行为准则、CITATION、CI |
| 明确许可与归属 | 对方 LICENSE 与 package.json 为 Apache-2.0；本仓库同样采用标准 Apache-2.0，并保留本项目独立版权 |

未引入对方路由器实现、产品名或模型降级策略。README 的传播表达不替代真实实验；分发测试、真实模型验收和独立研究结论分别列出。

其他核验：

- npm 12 修改了 `pack --json` 结构，改为包名键控对象。本地 npm 12.2.0 实测与 [npm 12 变更记录](https://github.com/npm/cli/blob/latest/CHANGELOG.md)及[实现](https://github.com/npm/cli/blob/latest/lib/commands/pack.js)一致。安装测试据锁定版本处理，没有双格式兼容兜底。
- DSH 原生命令负责把 Bundle 纳入目标 Profile；目标 Profile 的 pnpm 构建授权仍需显式配置。依据安装版本 `@deepseek-ai/dsh@0.2.1-rc.4` 的 `runPlugin` / `runPluginCommand` 和实际安装输出。
- DSH 适配器可通过 finish 事件的 `reason.kind=error` 返回传输失败。遥测必须将其计为 failed，即使生成器没有 throw；真实 SDK 子进程测试覆盖这个路径。

此前 GitHub Actions 曾受账号支付/消费额度限制，任务未启动。随后提交 `fcf76f2`、`a486ce5` 发生了另一项实际错误：在 job 级 `env` 使用 `runner.temp`，导致工作流未通过解析。两种失败分别记录，不能将配置错误归于账户限制。云端结果单独列为未完成项，本地测试结果不会写成云端矩阵通过。

依据 [GitHub 上下文作用域表](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)，将临时目录初始化移入步骤，通过 `GITHUB_ENV` 传给后续步骤；制品上传的 step `with` 继续使用合法的 `runner.temp`。加入固定版本 [actionlint 1.7.12](https://github.com/rhysd/actionlint/tree/v1.7.12)，本地复现原错误并验证修改通过。与 CI 相同的 `go run` 首次因 Go 校验服务 EOF 失败，保留校验设置后再次执行成功；未禁用依赖校验。只读子代理复核通过。

## 双语入口、技术图与实测图

再次核对同事仓库的固定提交后，借鉴其价值定位、架构、使用演示、生命周期及开发者入口的组织方式。保留本项目核心原句，补英文 README、组件与接续图，以及直接从机器记录生成的实验图。

- GitHub 官方支持 Markdown 中的 [Mermaid 图](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams)，此处使用基础 flowchart、stateDiagram 和 sequenceDiagram，实际通过 Mermaid CLI 渲染核验。
- [官方工作流徽章](https://docs.github.com/en/actions/how-tos/monitor-workflows/add-a-status-badge)连接实际 workflow，不手写通过状态。私有仓库徽章不保证在外部站点可见。
- 结果图使用 Matplotlib `3.10.8`，读取既有 JSON 的候选身份、分数和终态；固定完整分母，显示负结果及服务失败。图片和 SVG 均可重建，未手工编造优化曲线。
- 子代理评审指出并置图应明确复验候选身份，已由机器记录匹配 Mutation 1；核心思想和 `11.md` 均未变更。
