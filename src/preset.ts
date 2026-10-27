/** Native declarative entries. DSH owns loading, activation audits, scopes and disposal. */
export function evolutionPreset(options: {
  plugin: string;
  endpoint: string;
  tokenEnv: string;
  composition?: string;
}) {
  return {
    id: 'preset-evolution',
    name: '@deepseek-ai/dsh-agent-preset',
    config: {
      id: 'evolution',
      name: 'Harness Evolution',
      description: 'Evidence-driven plugin evolution with independent experiments',
      plugins: [
        {
          id: 'evolution-tools',
          name: options.plugin,
          config: { endpoint: options.endpoint, tokenEnv: options.tokenEnv },
        },
        ...(options.composition
          ? [
              {
                id: 'evolution-method',
                name: '@deepseek-ai/cordis-plugin-include',
                config: { path: options.composition },
              },
            ]
          : []),
      ],
    },
  };
}

/** The official sdk/sdk-minimal profiles do not supply a preset registry. */
export function sdkPreset(preset: string, bridge: string) {
  return [
    {
      id: 'agent-preset-registry',
      name: '@deepseek-ai/dsh-agent-preset-registry',
      config: { default: preset },
    },
    { id: 'evolution-sdk-preset', name: bridge, config: { preset } },
  ];
}
