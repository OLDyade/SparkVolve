# gVisor 受控出口：DNS 与真实模型验收

## 原始故障与来源

原正式 Controller 验收在首个模型请求返回 `upstream_error`，账本无解析地址。随后在同一 gVisor runtime、两个自定义 bridge 上做无凭证探测：容器 `/etc/resolv.conf` 为 `127.0.0.11`，`dns.lookup` 返回 `EAI_AGAIN`。默认 bridge 上显式观察到的环境 resolver 为 `0.250.250.200`，解析成功。

[gVisor 官方 FAQ](https://gvisor.dev/docs/user_guide/faq/#docker-bridge)明确指出自定义 bridge 的 Docker 内置 DNS 需要宿主网络栈，runsc netstack 无法访问；仅传 `--dns` 仍会留下内置 DNS 地址。采用其只读挂载 resolver 文件的方案，维持 Sentry 与双网络隔离。

## 实现

- 合同显式冻结 1–3 个 IPv4 resolver；不默认公网地址，不随运行时切换策略。拒绝重复、回环、组播、广播、`0.0.0.0` 和与地址池重叠；允许部署环境明确提供的内部地址。
- 文件逐字生成，broker 只读挂载；合同与容器身份包含 DNS，恢复核验字节及挂载，释放前保存摘要。已有文件漂移直接失败，恢复不重写掩盖。
- broker 账本记录失败阶段与已知原生错误码，不保存异常文本、认证或请求内容。DNS 答案仍一次解析、全量核验，连接固定到核验地址。
- 部署脚本只发现指定镜像/运行时默认 bridge 的候选 resolver；最终受控网络可达性由实际请求验证。CI 保存发现产物并显式传入测试。
- [Linux resolver 文档](https://man7.org/linux/man-pages/man5/resolv.conf.5.html)规定 `MAXNS=3`，实际镜像头文件也为 3；合同超限直接拒绝。

## 实际验收

最终镜像 `sha256:6708cd91fdfb6a802432f20f4a97bff3ca2dfb47116cbbf3c520e00eaa9f3cf3`。编译后的合同、session 与 broker 文件摘要已与实际镜像比对。

| 验收 | 结果 |
|---|---|
| 单元 / 原生 DSH | 53 / 9 通过；新增 DNS 合同与故障诊断断言 |
| runc / gVisor 容器矩阵 | 同一最终镜像各 12 项通过 |
| 真实模型、原容器接续、独立评分 | gVisor 上 4 started / 4 result / 0 failed / 0 unfinished；评分 1 |
| DNS、生命周期、回收 | 实际只读挂载、文件摘要、原 worker/broker 身份核验；容器与两网络已回收；重复 pump 无新增调用 |
| 分发安装 | 实际打包后原生安装与能力调用通过 |

模型输入 1571 / 输出 283 tokens，请求耗时和 5461ms。HTTP 原始账本 3 completed / 1 cancelled，均已连接解析地址并收到 HTTP 200。HTTP 消费者关闭响应与模型完成是不同观察维度；不把 cancelled 改写成 completed，也不据此推断每次关闭的具体原因。实际 [OpenAI SDK 流实现](https://github.com/openai/openai-node/blob/main/src/core/streaming.ts)会在完成标记退出并释放 reader；本地依赖版本 7.19.0 已核对。Context7 两次检索未返回准确 SDK 条目，转查官方源码及实际安装实现。

## 保留的失败

原 DNS 失败未重写；初次镜像的地址校验把 OrbStack resolver 误当整个 `0/8` 的 unspecified 已纠正；测试 loader 原固定 node_modules 相对路径改为原生模块解析，原失败日志保留。最终镜像的一次工程任务已交付并评分，但新增验收断言误要求所有 HTTP 都 completed；原失败报告保留，修正验收条件后在新目录验证同一生产镜像。按 UUID 逐一配对、非空模型用量的附加断言在原最终产物上只读复核，没有再运行模型。

独立 subagent 复审指出 MAXNS 问题并完成复核；对应失败、最终回执、原始日志摘要与文件身份见[证据 JSON](../evidence/2026-10-28-gvisor-controlled-dns.json)。这证明工程链路，不构成正确率增益实验。磁盘配额、MicroVM、稳定质量及云端 CI 仍按完整交付清单推进。
