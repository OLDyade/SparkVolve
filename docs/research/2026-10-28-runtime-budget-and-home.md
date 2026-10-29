# Native Runtime Environment and Long-Request Budget

Verified versions: DSH `0.2.1-rc.4`, Cordis `4.0.5`, Undici `8.12.2`. This fix does not change the model, Agent Loop, candidate source code, scorer, or failure denominator.

## Two Actual Failures

| Failure | Direct Evidence | Handling |
| --- | --- | --- |
| Docker HOME is writable, yet writes are still rejected inside native bash | Native Landlock `workspace-write` only allows the workspace, `/tmp`, etc.; `/home/node` is not in that set | Place a HOME tmpfs with its own capacity limit at `/tmp/evolution-home`, explicitly set and create the XDG directories; keep the native sandbox |
| Both the task and the model are configured for 600 seconds, yet HTTP still terminates at about 302 seconds | Native Pi/OpenAI returns `TIMEOUT`, explicitly indicating the Node fetch response-header timeout; the same broker records it as a caller cancellation | Install the Cordis transport plugin in the isolated native DSH host, using a matching Undici fetch and Agent; the connect, response-header, and response-body idle budgets match the host execution budget |

The task's total wall-clock limit is still enforced by the controller. The model's own per-request and stream-idle limits remain in effect. Extending the underlying transport budget does not increase the number of model calls, does not retry failed requests, and does not extend an experiment contract that has already started.

## Native Wiring

```text
Experiment contract execution budget
  ├─ Docker process supervision → worker / SDK request deadline
  └─ worker injects native Cordis plugin
       ├─ http-transport: matching fetch / Request / Response and explicit Agent
       │    └─ native Pi adapter → OpenAI SDK → controlled egress → provider
       └─ telemetry: native identity for requests, sessions, Agent lifecycle, and tool execution

Docker isolated HOME tmpfs (128 MiB, 0700, contract UID/GID)
  └─ /tmp/evolution-home/{config,cache,data,state,run}
       └─ native bash / Landlock → LibreOffice default user configuration
```

Only one HTTP plugin is allowed per isolated host; on unload it releases its own connections and restores the global objects it still holds. No DSH or provider SDK files were modified. The native event ledger and the request usage ledger are stored separately; tool timing is not counted again as tokens, and a response model or usage that is not provided is explicitly marked missing, not inferred.

HOME/XDG is set uniformly by the runtime contract. All environment values are validated before directories are created; conflicting configuration passed by the caller raises an error directly. The verified default LibreOffice path comes from actual native bash and does not bypass the inner sandbox. This record is not extrapolated to other sandbox implementations that have not yet been tested.

## Upstream Basis

- [Undici timeout configuration](https://github.com/nodejs/undici/blob/v8.12.2/docs/docs/getting-started.md): the Agent's `headersTimeout` and `bodyTimeout` each default to 300 seconds.
- [Undici install](https://github.com/nodejs/undici/blob/v8.12.2/index.js): installs the fetch family of the same implementation.
- The actually installed `openai/client.d.mts` explicitly states: the SDK timeout and the Node fetch timeout are independent of each other, and a matching Undici fetch/dispatcher is required.
- The actual DSH `dsh-llm-pi-ai/lib/index.js` passes the profile timeout to Pi; the current version does not expose custom fetch through profile JSON. Therefore the transport plugin is assembled within the native host lifecycle, preserving the original adapter.

Regression entry points: `tests/http-transport.test.ts`, `tests/native/http-transport.test.ts`, `tests/container/runtime-home.test.ts`. Setting `SPARKVOLVE_HTTP_HEADER_DELAY_MS=305000` starts a real local HTTP service that waits 305 seconds before sending response headers, completing one request through native DSH → Pi → OpenAI SDK; it does not consume remote model tokens.
