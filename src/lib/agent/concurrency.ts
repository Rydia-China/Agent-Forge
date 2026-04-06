/**
 * Global agent concurrency limiter.
 *
 * Controls how many agent tasks can run in parallel across the entire process.
 * Tasks that exceed the limit are queued and executed in FIFO order.
 *
 * Survives Next.js HMR via globalThis caching.
 */

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const MAX_CONCURRENT =
  Math.max(1, parseInt(process.env.MAX_CONCURRENT_AGENTS ?? "3", 10)) || 3;

const TASK_TIMEOUT_MS =
  Math.max(1, parseInt(process.env.TASK_TIMEOUT_MINUTES ?? "30", 10)) * 60_000;

export { TASK_TIMEOUT_MS };

/* ------------------------------------------------------------------ */
/*  Semaphore                                                          */
/* ------------------------------------------------------------------ */

interface Waiter {
  id: string;
  resolve: () => void;
  reject: (err: Error) => void;
}

interface AgentSemaphore {
  active: number;
  max: number;
  queue: Waiter[];
}

const g = globalThis as unknown as { __agentSemaphore?: AgentSemaphore };

function getSemaphore(): AgentSemaphore {
  if (!g.__agentSemaphore) {
    g.__agentSemaphore = { active: 0, max: MAX_CONCURRENT, queue: [] };
  }
  // Hot-reload may change MAX_CONCURRENT
  g.__agentSemaphore.max = MAX_CONCURRENT;
  return g.__agentSemaphore;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface ConcurrencyStatus {
  active: number;
  pending: number;
  max: number;
}

/** Current concurrency status snapshot. */
export function getConcurrencyStatus(): ConcurrencyStatus {
  const sem = getSemaphore();
  return { active: sem.active, pending: sem.queue.length, max: sem.max };
}

/**
 * Queue position for a specific task (0-based).
 * Returns -1 if the task is not in the queue (already running or unknown).
 */
export function getQueuePosition(taskId: string): number {
  const sem = getSemaphore();
  return sem.queue.findIndex((w) => w.id === taskId);
}

/**
 * Acquire execution permit.
 * Resolves immediately if a slot is available, otherwise waits in FIFO queue.
 * The returned release function MUST be called when execution finishes.
 *
 * Throws if the AbortSignal is triggered while waiting.
 */
export function acquire(
  taskId: string,
  signal?: AbortSignal,
): Promise<{ release: () => void }> {
  const sem = getSemaphore();

  if (sem.active < sem.max) {
    sem.active++;
    return Promise.resolve({ release: makeRelease(sem) });
  }

  // Queue the waiter
  return new Promise<{ release: () => void }>((resolve, reject) => {
    const waiter: Waiter = {
      id: taskId,
      resolve: () => resolve({ release: makeRelease(sem) }),
      reject,
    };
    sem.queue.push(waiter);

    // Allow cancellation while queued
    if (signal) {
      const onAbort = () => {
        const idx = sem.queue.indexOf(waiter);
        if (idx >= 0) {
          sem.queue.splice(idx, 1);
          reject(new Error("Task cancelled while queued"));
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** Remove a task from the wait queue without rejecting (for external cancel). */
export function removeFromQueue(taskId: string): boolean {
  const sem = getSemaphore();
  const idx = sem.queue.findIndex((w) => w.id === taskId);
  if (idx >= 0) {
    const waiter = sem.queue.splice(idx, 1)[0]!;
    waiter.reject(new Error("Task cancelled while queued"));
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Internal                                                           */
/* ------------------------------------------------------------------ */

function makeRelease(sem: AgentSemaphore): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    sem.active--;
    // Wake next waiter
    const next = sem.queue.shift();
    if (next) {
      sem.active++;
      next.resolve();
    }
  };
}
