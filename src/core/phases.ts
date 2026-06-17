/**
 * Phase tracking + event emission.
 *
 * phase() starts a named phase; subsequent agent() calls are grouped under it
 * (the "current phase" is read by agent() when no explicit opts.phase is given).
 * log() emits a progress message. Both feed the run's onEvent callback, the
 * same pattern pi uses for agent.subscribe().
 */

import type { WorkflowEvent } from "../types.ts";

export class PhaseTracker {
  private current = "";
  private readonly emit: (event: WorkflowEvent) => void;

  constructor(emit: (event: WorkflowEvent) => void = () => {}) {
    this.emit = emit;
  }

  /** The phase agent() falls back to when opts.phase is absent. */
  get currentPhase(): string {
    return this.current;
  }

  phase(title: string): void {
    this.current = title;
    this.emit({ type: "phase", title });
  }

  log(message: string): void {
    this.emit({ type: "log", message });
  }

  /** Forward an arbitrary event (used by agent/budget wiring). */
  event(event: WorkflowEvent): void {
    this.emit(event);
  }
}
