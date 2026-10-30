# Official DeepSeek Native Integration

Uses the DSH-locked `@deepseek-ai/dsh-llm-deepseek-api-key` plugin, the `deepseek-official` provider, and the official Messages endpoint. No relay service is needed; there is no fallback provider or automatic retry.

`model.json` declares the model, reasoning mode, output budget, and credential variables. `cordis.patch.yml` uses the `deepseek-flash` metadata returned by the official `/models` on 2026-10-28: DeepSeek-V4.1-Flash, 1,048,576 context, 393,216 output limit, text/image input, in-history system updates, and addition-only tool updates. The example's actual output budget is 32,768, and the reasoning mode is off. The server exposes only an alias; the locally frozen configuration and catalog response cannot guarantee that the model weights behind the alias will never change.

Place `DEEPSEEK_API_KEY` in a private environment file outside the repository, with permissions set to `0600`. Model credentials go only to the trusted egress proxy; the DSH executor process receives a local placeholder value. `egress.mjs` generates the exact `/anthropic/v1/messages` route, explicitly preserving the adapter's `anthropic-version`, `anthropic-beta`, and `accept` request headers, sends no model catalog probe, and does not rewrite the request body. The official documentation currently states that version is ignored and beta is ignored except in the Files image scenario; preserving the protocol headers does not mean they are the cause of the old stream interruption.

For a first experience, you can run `npm start -- --env-file <private.env> --pool <reserved-CIDR>` directly, which builds and starts automatically; it defaults to official DeepSeek, with no need to assemble preparation commands separately. See the [startup guide](../../docs/quick-start.md).

When you need to orchestrate experiments yourself, the preparation command for the spreadsheet scenario explicitly selects the provider directory:

```bash
node tests/fixtures/spreadsheet/prepare.mjs <dataset> <immutable-image> \
  examples/deepseek/model.json <spec.json> <isolation.json> examples/deepseek
```

The full native development acceptance includes 4 types of business tasks, at most 2 autonomous candidates, independent H0/selected-version validation, and installation of the original archive. Tasks, model HTTP, native QA, and probes default to 600 seconds, and the optimizer's total budget is derived from the planned waits:

```bash
node --env-file=/absolute/private/deepseek.env scripts/verify-native-authoring.mjs \
  --root <new-evidence-root> --image <immutable-spreadsheet-image> \
  --model examples/deepseek/model.json --provider-directory examples/deepseek \
  --isolation <isolation.json> --controller-ip <reachable-IPv4> \
  --install-policy <install-policy.json>
```

Then use `scripts/verify-installed-capability.mjs` to install the same archive in four clean native Profiles and execute the business tasks; engineering results and business scores are recorded separately. See the [completion record](../../docs/completion.md) for the full run status.

Existing development evidence can be handed to the optimizer via `--research-brief <development-evidence.md>`. The driver freezes the body, summary, and its own source code before inference, and the body enters only the development target; the independent validation contract is unaffected. Do not stuff validation-set answers or validation feedback into that file. Each new mechanism uses a new evidence directory, preserves the original failures, and does not modify old contracts or re-run old scores.

Protocol references: [official model catalog](https://api-docs.deepseek.com/api/list-models/), [Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api/), [reasoning and tool calls](https://api-docs.deepseek.com/guides/thinking_mode/). The actual adapter version is pinned to DSH 0.2.1-rc.4.
