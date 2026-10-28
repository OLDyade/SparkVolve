# 分发、复现与发布

能力 Bundle 和自进化设施都沿用 DSH 原生安装。发布前先交付可审查的实际包、依赖清单和验证记录；源码仓库已于 2026-10-28 按用户指令公开，构建流程不会自动创建 Release 或发布 npm 包。

候选 `export` 同时生成[能力卡](capability-cards.md)、原研究档案和导出时用量报告。它们描述实际冻结包及实验边界，不改 tarball；下方 `package:artifacts` 则用于分发自进化设施本身。

```text
固定源码与锁文件 → 检查 / 原生集成 → 干净安装 → npm pack
                                               │
                         ┌─────────────────────┼───────────────────┐
                         ▼                     ▼                   ▼
                   可安装 bundle.tgz     依赖 SBOM + 锁文件    身份与 SHA256
                         └─────────────────────┼───────────────────┘
                                               ▼
                             CI Artifact / 本地交付目录
                                               │
                              版本与许可审查 + 明确发布决定
                                               ▼
                                     公开 Release / 包仓库
```

## 生成可审查的包

按 [Contributing](../CONTRIBUTING.md) 完成检查、原生安装及对应领域容器验收后执行：

```bash
npm run package:artifacts -- .evolution/release-inspection
HE_INSTALL_PACKAGE="$PWD/.evolution/release-inspection/harness-evolution-dsh-bundle-0.0.0-development.tgz" \
  npm run test:install
cd .evolution/release-inspection
shasum -a 256 -c SHA256SUMS
```

输出目录必须尚不存在，失败证据不覆盖。命令实际执行构建与 `npm pack`，核对 tarball 完整性、必要入口和禁入的运行目录，再生成：

| 文件                    | 用途                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| `*.tgz`                 | 本次实际 npm 包；沿用 `dsh plugin --profile sdk add /absolute/package.tgz` 安装 |
| `artifact.json`         | 源提交、工作树是否有修改、运行版本、包内文件、包与依赖清单摘要                  |
| `dependencies.cdx.json` | npm 原生 CycloneDX SBOM，来自锁文件，排除仅开发依赖                             |
| `package-lock.json`     | 生成该清单时的完整仓库锁快照                                                    |
| `SHA256SUMS`            | 检查本次交付的字节身份                                                          |

安装测试通过 `HE_INSTALL_PACKAGE` 指定同一实际 tarball，并核对安装前后摘要；未指定时测试自行打包。包名或版本改变时使用 `artifact.json` 的 `archive.file`，CI 也从该字段读取。SBOM 描述仓库依赖快照，消费者 DSH Profile 的最终解析仍需实际安装验证。摘要可检测字节变化，不能证明发布者身份。脏工作树会明确记录，不能把该包归称为某个干净提交的产物。当前 `0.0.0-development` 是开发标识，不声称稳定发布。

## 固定研究的原包安装验收

固定方法比较结束后，可一次验收原注册 G、H0 和实际选出的 H。入口读取原 SQLite 与冻结身份，在研究目录外产生新的安装记录；不会启动搜索、评分、打包或模型推理。在途研究直接拒绝。

```bash
node scripts/verify-study-artifacts.mjs \
  --evidence-root <existing-study-evidence-root> \
  --output <new-installation-evidence-directory> \
  --framework-tarball <existing-evolution-framework.tgz> \
  --install-policy <pnpm-install-policy.json> \
  --timeout-seconds 480
```

输入研究目录采用 `verify-feedback-study.mjs` 的布局，包含 `study/registration.json`、`study/study.sqlite` 与原冻结输入。安装策略文件显式声明 `{ "allowBuilds": { "package@exact-version": true } }`，批准的包和版本由实际安装环境确定；脚本不隐式扩大构建权限。支持包单独记录摘要，不冒充本轮 G/H 构建产物。

每个安装上下文共用一个期限（默认 480 秒），包含冷依赖安装和原生装配，不再为每条命令重新计时。验收脚本、安装程序和进程管理模块分别记录摘要；进程管理模块只读挂载，原研究镜像、G/H tarball 与评分结果保持不变。该入口不发送模型请求；候选初始化仍是实际代码执行，网络与权限按登记的安装环境约束。

同一原包按内容身份去重，不同原注册 Profile、模型、环境和装配入口分别验证。结果保留完整作业清单、未选出的槽位、逐包失败与全部原身份。安装失败后仍记录其他包的实际结果；任何失败或未完成的交付槽位都会使整体 `passed` 为 false。安装与装配通过只证明这条交付路径，质量收益另见独立研究报告。

## 实际发布决定

- 版本、仓库可见性、发布目标及许可证保持明确；公开操作需要项目所有者指令。当前许可为仓库的 Apache-2.0，第三方归属保留于 NOTICE。
- Release 说明列出变更、准确支持矩阵、独立验收入口和已知限制；研究分数必须引用完整实验记录。配置、接口和依赖升级写明新合同要求，历史实验不改写兼容。
- 安装包、冻结候选、源提交、运行镜像和研究成绩分别标识；同一个版本号不能代替具体产物身份。
- CI 上传的是未发布构建产物，无 registry 写权限。以具体运行和提交的实际结果判断通过，保留原失败记录。

### 公开后的 CI 运行方式

正式公开后，沿用本仓库的标准 GitHub 托管 Ubuntu/macOS runner。GitHub 对公开仓库的标准 runner 运行免费，不消耗私有仓库的套餐分钟额度；大型 runner 仍收费，运行时间、并发与存储等限制仍需分别管理。只把 reusable workflow 放在公开仓库、由私有仓库调用，仍按调用方计费，不能解决私有仓库额度问题。依据：[Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)、[Reusable workflow billing](https://docs.github.com/en/actions/concepts/billing-and-usage#billing-for-reusable-workflows)（核实于 2026-10-28）。

公共 CI 验证构建、类型、原生装配、容器协议和真实包安装；需要凭证的模型研究单独授权与记账，runner 免费不包含第三方模型 API 费用。仓库公开后的实际运行已消除原分钟额度拦截，并暴露出 macOS 缺少 Go 的工作流问题，已显式安装固定版本；具体矩阵结果见[落实状态](completion.md)。

研究依据：同事仓库 [Publish workflow](https://github.com/XHToken/dsh-intelligent-router/blob/d762b8e8ebd9f07dcea34fe2da56202f9f727fe4/.github/workflows/publish.yaml) 将构建、测试、标签版本核对和分发串联。本项目借鉴可核验产物链，交付审阅用构建包；没有启用其 registry 发布触发器。SBOM 使用 [npm 官方命令](https://docs.npmjs.com/cli/v12/commands/npm-sbom)，已核对安装版 npm 12.2.0 的锁文件加载与 pre-build 标识实现。
