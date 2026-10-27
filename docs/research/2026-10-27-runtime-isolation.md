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

独立 Linux 宿主上的 runsc、受控出口及 MicroVM 后端仍未完成，保留在完整交付范围内。
