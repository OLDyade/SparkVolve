# 运行隔离：官方能力、实际宿主与实现选择

2026-10-27 核实。目标是让插件代码变异的执行边界可声明、可检查、可恢复，保留原生 DSH。

## 已核资料

- Docker [Alternative runtimes](https://docs.docker.com/engine/daemon/alternative-runtimes/)：daemon 注册 OCI runtime/shim，容器通过 `--runtime` 显式选择。Context7 `/docker/docs` 查询与 Docker 29.8.2 `info`/`inspect` 交叉核验。
- gVisor [安全模型](https://gvisor.dev/docs/architecture_guide/security/)、[平台选择](https://gvisor.dev/docs/user_guide/platforms/)、[Docker 接入](https://gvisor.dev/docs/user_guide/quick_start/docker/)：Sentry 减少直接暴露给宿主内核的接口；systrap 可用于 VM 内，无需嵌套 KVM。源码定位 [4777ee7811e235e66d5825f6c6ae5ccd3ccccfb3](https://github.com/google/gvisor/tree/4777ee7811e235e66d5825f6c6ae5ccd3ccccfb3)。实际兼容性仍需运行安装、编译和 DSH 动态库负载。
- Firecracker [生产宿主要求](https://github.com/firecracker-microvm/firecracker/blob/b54ebb201303087c699cc4c1711bec962919f893/docs/prod-host-setup.md)：依赖 KVM/CPU 虚拟化，生产建议包含 seccomp 和宿主维护；独立 guest kernel 不自动解决网络、磁盘、调度和数据权限。
- X 搜索返回 GoogleCloudTech 和 LegitSeanSmith 相关转录线索，未拿到可独立核验的原帖，不用于技术或流行度结论。未采用搜索结果中的开销百分比或用户归属传言。

## 决策与实测

macOS/OrbStack Linux aarch64 daemon 只注册 runc 与 io.containerd.runc.v2。未修改全局运行时配置。过去写死的资源和隐含 root 身份改为必填合同，以 inspect 验证真实设置；回执记录实际注册信息，不按名称推断隔离实现。

镜像、命令、挂载和权限进入 intent digest；创建后、恢复前、结束后核验。原容器保留取证，核验失败不重新抽样。

- 单元 25、原生 8 通过。
- 镜像 `sha256:2eff5055a8006398c279766e8145a4638608a331f025e3e62f00cd5336a586b9` 四项真实容器验收通过：编译/依赖打包/禁网安装、原生 DSH→交付→独立评分→恢复、实际隔离探测、原生优化器→控制 API。
- guest 验证非 root、CapEff=0、NoNewPrivs=1、仅回环网络、源码/根目录写入失败、授权目录及临时目录可写；宿主核验资源。
- 原容器经 `docker update` 修改 PID 上限后 collect 拒绝；未注册 runtime 在 create 前失败；恢复复用原容器；回执不含注入探测凭证。
- 上述验证工程执行与恢复，不测量真实模型正确率收益，不证明抗逃逸或多租户安全。
- 真实 Venus DeepSeek 会话在相同非 root 配置下完成 status→wait→finish，返回宿主事件随机 nonce；耗时约 7.86 秒。零任务、零候选，此项只验证真实网络、凭证和原生会话生命周期。
- 独立只读方向评审通过；指出 Quick start 第五参数与 UID/GID 说明需同步，已补齐。

## gVisor 实装与运行矩阵

- 复核 [官方安装说明](https://gvisor.dev/docs/user_guide/install/)和 [20261019.0 发行包](https://github.com/google/gvisor/releases/tag/release-20261019.0)：当前发行物包含 runsc、shim 与 `gvisor-bin` sidecars，必须整体保留。仓库脚本固定发行包及 SHA256；显式注册独立名称 `he-runsc-20261019`，不改默认 runtime。
- [OrbStack isolated machines](https://docs.orbstack.dev/machines/isolated)支持禁用 Mac 文件共享及宿主网络；其[架构](https://docs.orbstack.dev/architecture)仍让机器共享 Linux 内核。本次创建专用 Debian 13 ARM64 机器和 Docker 29.9.2 daemon，关闭宿主共享与网络。可信测试控制器持有该 daemon socket；候选容器不持有。
- 宿主代理、直接 TLS 与 SSH 反向转发均遇到实际网络失败，保留日志。最终离线导入官方签名 APT 索引及 SHA256 校验包，guest APT 验签，未打开宿主访问或停用 TLS 验证。安装包内 runsc 及完整 tar 发行包两个安装入口分别验收。
- runsc/systrap 下四项容器验收全部通过；随后用仓库脚本安装固定发行包，再以 `he-runsc-20261019` 运行同一四项验收，全部通过。13 份运行结束隔离回执记录实际 runtime、用户及网络。没有以注册名称或 hello-world 代替完整 DSH 负载。
- 真实 DeepSeek 会话在 runsc 下完成 status→wait→finish，4 次原生模型流调用全部返回，报告输入 3990 / 输出 686 tokens，单次实验 9.303 秒。零任务、零候选，不推导质量收益。
- 两次安装/测试准备错误保留：初次可信控制器使用错误 socket 组导致权限失败；发行包首次解压缺 bzip2。分别依据实际组修正和安装依赖，并在安装脚本写入依赖预检。均发生在工程验收，不混入质量实验。
- GitHub workflow 新增 runc/gVisor 独立矩阵和失败日志/隔离回执归档，artifact action 固定 [v7.0.2 提交](https://github.com/actions/upload-artifact/tree/cf430e030ddbb5b0abf93d22962f4752f3646cd9)。当前远端 run `40529245525` 的 check `122277182856` 明确因支付/消费额度未启动，不能宣称远端矩阵通过。

独立只读 subagent 方向评审通过，未发现本项交付阻断；明确在线下载入口、Linux x86_64 云端 CI 尚未实跑。机器可核查摘要：[gVisor 验收记录](../evidence/2026-10-27-gvisor-acceptance.json)。Linux x86_64 远端执行、受控出口、磁盘配额及 MicroVM 后端仍未完成，保留在完整交付范围内。
