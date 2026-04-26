/**
 * Lightweight checkpoint system for agent pipelines.
 *
 * Allows pipelines to save state at phase boundaries and resume from the
 * last successful checkpoint if a later phase fails.
 */

export interface PipelineCheckpoint<TState> {
  /** Phase name that produced this checkpoint (e.g. "classify", "extract"). */
  phase: string;
  /** Serializable pipeline state at this point. */
  state: TState;
  /** When the checkpoint was saved. */
  timestamp: number;
}

export interface PipelineContext<TState> {
  /** Pipeline run identifier. */
  readonly id: string;
  /** Save a checkpoint after completing a phase. */
  save(phase: string, state: TState): Promise<void>;
  /** Get the most recent checkpoint (from resume or latest save). */
  getCheckpoint(): PipelineCheckpoint<TState> | undefined;
  /** Check if a given phase was already completed (for skip-on-resume). */
  isPhaseComplete(phase: string): boolean;
  /** Clear all checkpoints (e.g. on successful pipeline completion). */
  clear(): void;
}

export interface PipelineContextOptions<TState> {
  /** Pipeline run identifier. */
  id: string;
  /** Optional callback to persist checkpoints externally (database, file, etc.). */
  onSave?: (checkpoint: PipelineCheckpoint<TState>) => Promise<void>;
  /** Resume from a previously saved checkpoint. */
  resumeFrom?: PipelineCheckpoint<TState>;
  /** Ordered phase names. When provided, resuming from a phase marks prior phases complete too. */
  phaseOrder?: string[];
}

/**
 * Create a pipeline context for checkpoint-based save/resume.
 *
 * In-memory by default. Consumers can provide `onSave` to persist checkpoints
 * to external storage and `resumeFrom` to resume from a prior checkpoint.
 */
export function createPipelineContext<TState>(
  opts: PipelineContextOptions<TState>,
): PipelineContext<TState> {
  let latest: PipelineCheckpoint<TState> | undefined = opts.resumeFrom;
  const completedPhases = new Set<string>();

  if (opts.resumeFrom) {
    const phaseIndex = opts.phaseOrder?.indexOf(opts.resumeFrom.phase) ?? -1;
    if (phaseIndex >= 0 && opts.phaseOrder) {
      for (const phase of opts.phaseOrder.slice(0, phaseIndex + 1)) {
        completedPhases.add(phase);
      }
    } else {
      completedPhases.add(opts.resumeFrom.phase);
    }
  }

  return {
    id: opts.id,

    async save(phase: string, state: TState) {
      const checkpoint: PipelineCheckpoint<TState> = {
        phase,
        state,
        timestamp: Date.now(),
      };
      latest = checkpoint;
      completedPhases.add(phase);
      await opts.onSave?.(checkpoint);
    },

    getCheckpoint() {
      return latest;
    },

    isPhaseComplete(phase: string) {
      return completedPhases.has(phase);
    },

    clear() {
      latest = undefined;
      completedPhases.clear();
    },
  };
}
