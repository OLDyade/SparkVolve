# 分发、复现与发布

能力 Bundle 和自进化设施都沿用 DSH 原生安装。发布前先交付可审查的实际包、依赖清单和验证记录；目前仓库保持私有，流程不会自动公开仓库、创建 Release 或发布 npm 包。

```text
固定源码与锁文件 → 检查 / 原生集成 → 干净安装 → npm pack
                                               │
                         ┌─────────────────────┼───────────────────┐
                         ▼                     ▼                   ▼
                   可安装 bundle.tgz     依赖 SBOM + 锁文件    身份与 SHA256
                         └─────────────────────┼───────────────────┘
                                               ▼
                             私有 CI Artifact / 本地交付目录
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

| 文件 | 用途 |
|---|---|
| `*.tgz` | 本次实际 npm 包；沿用 `dsh plugin --profile sdk add /absolute/package.tgz` 安装 |
| `artifact.json` | 源提交、工作树是否有修改、运行版本、包内文件、包与依赖清单摘要 |
| `dependencies.cdx.json` | npm 原生 CycloneDX SBOM，来自锁文件，排除仅开发依赖 |
| `package-lock.json` | 生成该清单时的完整仓库锁快照 |
| `SHA256SUMS` | 检查本次交付的字节身份 |

安装测试通过 `HE_INSTALL_PACKAGE` 指定同一实际 tarball，并核对安装前后摘要；未指定时测试自行打包。包名或版本改变时使用 `artifact.json` 的 `archive.file`，CI 也从该字段读取。SBOM 描述仓库依赖快照，消费者 DSH Profile 的最终解析仍需实际安装验证。摘要可检测字节变化，不能证明发布者身份。脏工作树会明确记录，不能把该包归称为某个干净提交的产物。当前 `0.0.0-development` 是开发标识，不声称稳定发布。

## 实际发布决定

- 版本、仓库可见性、发布目标及许可证保持明确；公开操作需要项目所有者指令。当前许可为仓库的 Apache-2.0，第三方归属保留于 NOTICE。
- Release 说明列出变更、准确支持矩阵、独立验收入口和已知限制；研究分数必须引用完整实验记录。配置、接口和依赖升级写明新合同要求，历史实验不改写兼容。
- 安装包、冻结候选、源提交、运行镜像和研究成绩分别标识；同一个版本号不能代替具体产物身份。
- CI 上传的是未发布构建产物，无 registry 写权限。云端额度限制未解除前，不把已配置的任务标成通过。

研究依据：同事仓库 [Publish workflow](https://github.com/XHToken/dsh-intelligent-router/blob/d762b8e8ebd9f07dcea34fe2da56202f9f727fe4/.github/workflows/publish.yaml) 将构建、测试、标签版本核对和分发串联。本项目借鉴可核验产物链，当前保留私有交付；没有启用其公开发布触发器。SBOM 使用 [npm 官方命令](https://docs.npmjs.com/cli/v12/commands/npm-sbom)，已核对安装版 npm 12.2.0 的锁文件加载与 pre-build 标识实现。
