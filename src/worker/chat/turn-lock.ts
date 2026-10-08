// One turn at a time per conversation. acquire() fails with turn_in_progress (HTTP 409) while a turn is
// in flight; release() runs in `finally` on every path, including provider errors and timeouts. A turn
// that exceeds maxTurnMs is aborted through the AbortSignal handed to every LLM call and retrieval.

export class TurnInProgressError extends Error {
  constructor() {
    super("turn_in_progress");
    this.name = "TurnInProgressError";
  }
}

export class TurnTimeoutError extends Error {
  constructor() {
    super("turn_timeout");
    this.name = "TurnTimeoutError";
  }
}

export class TurnLock {
  private held = false;
  private readonly maxTurnMs: number;

  constructor(opts: { maxTurnMs: number }) {
    this.maxTurnMs = opts.maxTurnMs;
  }

  get isHeld(): boolean {
    return this.held;
  }

  acquire(): { signal: AbortSignal; release: () => void } {
    if (this.held) throw new TurnInProgressError();
    this.held = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new TurnTimeoutError()), this.maxTurnMs);
    let released = false;
    return {
      signal: controller.signal,
      release: () => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        this.held = false;
      },
    };
  }

  /**
   * Runs fn under the lock. Resolves with fn's result, or rejects with TurnTimeoutError as soon as the
   * ceiling passes (fn's own I/O sees the aborted signal). The lock is always released.
   */
  async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const { signal, release } = this.acquire();
    try {
      return await new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new TurnTimeoutError());
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
        fn(signal).then(
          (v) => {
            signal.removeEventListener("abort", onAbort);
            resolve(v);
          },
          (e: unknown) => {
            signal.removeEventListener("abort", onAbort);
            reject(e);
          },
        );
      });
    } finally {
      release();
    }
  }
}
