import { defineTool } from '@deepseek-ai/dsh-tools';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'sum_integers',
      description: 'Add two integers.',
      parameters: { a: { type: 'number', required: true }, b: { type: 'number', required: true } },
      output: {
        schema: { type: 'number' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      execute: ({ a, b }) => a + b,
    }),
  );
}
