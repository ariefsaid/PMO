/**
 * Pure rules for timed checkpoints (#2594, AC-STC-011). The database computes the same state when it lists the day; this
 * module lets the screen keep a pending checkpoint's state current between refreshes without a round trip. The punctuality
 * share is the server's (`share_on_time` in the crew punctuality read) and is not restated here (#2753).
 */
export type CheckpointState = 'on_time' | 'late' | 'pending';

export interface CheckpointTimes { due_at: string; grace_minutes: number; recorded_at: string | null }

/** Recorded: on time up to and including due + grace. Unrecorded: late once now is past due + grace. */
export function checkpointState(row: CheckpointTimes, now: Date): CheckpointState {
  const limit = Date.parse(row.due_at) + row.grace_minutes * 60_000;
  if (row.recorded_at) return Date.parse(row.recorded_at) <= limit ? 'on_time' : 'late';
  return now.getTime() > limit ? 'late' : 'pending';
}
