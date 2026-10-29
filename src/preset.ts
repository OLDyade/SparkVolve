import path from 'node:path';

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
      name: 'SparkVolve',
      description: 'Evidence-driven plugin evolution with independent experiments',
      plugins: [
        {
          id: 'evolution-native-authoring',
          name: path.isAbsolute(options.plugin)
            ? path.join(path.dirname(options.plugin), 'native-authoring.js')
            : `${options.plugin}/native-authoring`,
        },
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
export function sdkPreset(preset: string, bridge: string, profile: 'sdk' | 'sdk-minimal') {
  return [
    ...(profile === 'sdk-minimal' ? [{ id: 'evolution-native-skills', name: '@deepseek-ai/dsh-skill' }] : []),
    { id: 'evolution-cordis-host-runner', name: '@deepseek-ai/dsh-cordis-host-runner' },
    { id: 'evolution-cordis-inspect-providers', name: '@deepseek-ai/dsh-tool-cordis/host' },
    {
      id: 'agent-preset-registry',
      name: '@deepseek-ai/dsh-agent-preset-registry',
      config: { default: preset },
    },
    { id: 'evolution-sdk-preset', name: bridge, config: { preset } },
  ];
}
