import { z } from 'zod';

export const EventCursor = z.strictObject({
  experimentId: z.uuid(),
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type EventCursor = z.infer<typeof EventCursor>;
export interface ExperimentEvent {
  sequence: number;
  at: string;
  type: string;
  body: unknown;
}
export interface EventPage {
  cursor: EventCursor;
  events: ExperimentEvent[];
  hasMore: boolean;
}
