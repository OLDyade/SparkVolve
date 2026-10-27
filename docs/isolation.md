# 冻结运行权限，核验真实容器

隔离合同进入实验身份。构建、QA、优化器、执行器、评分器都显式选择运行时、非 root UID/GID 和资源预算；各角色使用合同内的网络权限。运行时缺失、原容器配置漂移或身份不符会直接失败。

```text
研究者声明 isolation ──冻结──► 实验合同
                                  │
       ┌──────────┬──────────┬────┴─────┬──────────┐
       ▼          ▼          ▼          ▼          ▼
     Build        QA      Optimizer   Executor    Grader
       └──────────┴──────────┴──────────┴──────────┘
                                  │
             daemon 注册运行时 → create → inspect 核验
                                  │
                       isolation.json（启动前）
                                  │
                  原容器执行 / 中断后接回并重新核验
                                  │
                    isolation-final.json（结束后）
```

## 声明与操作

```bash
# 使用当前非 root 用户身份，显式选择已注册运行时；不改变 daemon 配置。
node examples/isolation.mjs runc > isolation.json
# 在独立 Linux 宿主注册并验证 runsc 后，可明确选择该运行时。
node examples/isolation.mjs runsc > isolation.json
```

生成器提供可编辑的工作站配置。框架不补缺失字段、不自动选择默认运行时、不在运行失败后回退。`prepare.mjs` 第五参数必须为此 JSON；冻结后修改合同需要新实验。UID/GID 必须能访问挂载目录，框架不会修改宿主目录权限。远端 Docker 的挂载路径必须真实存在于 daemon 宿主；本地路径不会自动上传。

| 字段 | 含义 |
|---|---|
| `runtime` | Docker 注册的精确名称；名称不证明实现或隔离强度 |
| `user.uid/gid` | 明确的非 root 用户，五类角色共用 |
| `memoryMiB` / `cpus` / `pids` | 每容器内存、CPU、进程上限；swap 总限额等于内存上限 |
| `tmpMiB` / `homeMiB` | 临时文件系统大小及用户所有权；`/tmp` 允许 DSH 动态库执行 |
| `network` | build/optimizer/executor 选择 none 或 bridge；QA/grader 固定 none |

固定清空 capabilities、禁止提权、只读根文件系统、私有 IPC；镜像入口被显式命令替代。核验用户、资源、网络、挂载读写、运行时及命令，拒绝镜像隐式 volumes。恢复沿用原容器，权限变化不触发任务重跑。

## 证据与边界

回执记录容器 ID、镜像 ID、合同、实际设置和 daemon 版本、内核、架构及运行时注册资料。仅序列化白名单字段，不保存 `Config.Env` 或完整 inspect。

| 环境 | 隔离边界 | 当前验收 |
|---|---|---|
| Linux Docker / OrbStack 的 runc | namespaces/cgroups，共享 Linux 内核 | 已实测非 root、禁网、只读、漂移拒绝及完整 DSH 链路 |
| gVisor/runsc | 用户态 Sentry 处理应用系统调用 | 调研完成；本机未注册，完整链路待实测 |
| Firecracker | KVM 驱动独立 guest kernel；还需生产宿主和网络配置 | 调研完成；尚无 MicroVM 执行后端 |

回执依赖可信 daemon，无法对抗宿主管理员，不属于加密远程证明。OrbStack VM 承载多个容器，不能宣称每题独立微虚拟机。bridge 没有域名白名单；同进程插件可读模型凭证。工作目录和日志尚无磁盘配额；内存/PID 限制不解决磁盘耗尽。当前候选应在专用研究宿主运行。更强隔离与受控出口仍需继续实施。

来源及验收见 [运行隔离研究](research/2026-10-27-runtime-isolation.md)。
