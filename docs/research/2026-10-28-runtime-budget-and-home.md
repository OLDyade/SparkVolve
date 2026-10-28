# 原生运行环境与长请求预算

核实版本：DSH `0.2.1-rc.4`、Cordis `4.0.5`、Undici `8.12.2`。本次修复不改变模型、Agent Loop、候选源码、评分器或失败分母。

## 两个实际故障

| 故障 | 直接证据 | 处理 |
| --- | --- | --- |
| Docker HOME 可写，原生 bash 内仍拒绝写入 | 原生 Landlock `workspace-write` 只放行工作区、`/tmp` 等；`/home/node` 不在该集合 | 将有独立容量限制的 HOME tmpfs 放在 `/tmp/evolution-home`，明确设置并创建 XDG 目录；保留原生沙箱 |
| 任务及模型都配置 600 秒，HTTP 仍在约 302 秒终止 | 原生 Pi/OpenAI 返回 `TIMEOUT`，明确提示 Node fetch 的 response-header timeout；同次 broker 记录为调用方取消 | 在隔离的原生 DSH 宿主装入 Cordis transport 插件，使用匹配的 Undici fetch 与 Agent；连接、响应头及响应体空闲预算与宿主执行预算一致 |

任务的总墙钟限制仍由控制器执行。模型配置自己的单次请求及 stream-idle 限制继续生效。延长底层传输预算不增加模型调用次数，不重试失败请求，也不延长已经开始的实验合同。

## 原生接线

```text
实验合同的执行预算
  ├─ Docker 进程监督 → worker / SDK 请求截止
  └─ worker 注入原生 Cordis 插件
       ├─ http-transport：匹配 fetch / Request / Response 与显式 Agent
       │    └─ 原生 Pi adapter → OpenAI SDK → 受控出口 → 供应商
       └─ telemetry：请求、会话、Agent 生命周期、工具执行的原生身份

Docker 独立 HOME tmpfs（128 MiB，0700，合同 UID/GID）
  └─ /tmp/evolution-home/{config,cache,data,state,run}
       └─ 原生 bash / Landlock → LibreOffice 默认用户配置
```

HTTP 插件每个隔离宿主只允许一份；卸载时释放自己的连接并恢复仍由它持有的全局对象。未修改 DSH 或供应商 SDK 文件。原生事件账本与请求用量账本分别保存；工具计时不重复计入 token，未提供的响应模型或 usage 明确缺失，不推测。

HOME/XDG 由运行时合同统一设置。启动前先验证所有环境值，再创建目录；调用者传入冲突配置直接报错。已验证的默认 LibreOffice 路径来自实际原生 bash，未绕过内层沙箱。此记录不外推到尚未实测的其他沙箱实现。

## 上游依据

- [Undici 超时配置](https://github.com/nodejs/undici/blob/v8.12.2/docs/docs/getting-started.md)：Agent 的 `headersTimeout` 与 `bodyTimeout` 默认各 300 秒。
- [Undici install](https://github.com/nodejs/undici/blob/v8.12.2/index.js)：安装同一实现的 fetch 家族。
- 实际安装的 `openai/client.d.mts` 明确说明：SDK timeout 与 Node fetch 超时相互独立，需要匹配的 Undici fetch/dispatcher。
- 实际 DSH `dsh-llm-pi-ai/lib/index.js` 将 profile timeout 传给 Pi；当前版本未通过 profile JSON 暴露 custom fetch。因此在原生宿主生命周期内装配传输插件，保留原适配器。

回归入口：`tests/http-transport.test.ts`、`tests/native/http-transport.test.ts`、`tests/container/runtime-home.test.ts`。设置 `HE_HTTP_HEADER_DELAY_MS=305000` 会启动真实本地 HTTP 服务，等候 305 秒才发送响应头，通过原生 DSH → Pi → OpenAI SDK 完成一次请求；不消耗远端模型 token。
