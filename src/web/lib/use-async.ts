import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void };

/** Runs an async loader on mount and whenever `deps` change; ignores results from stale runs. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const run = useRef(0);
  useEffect(() => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => {
        if (run.current === id) setState({ data, error: null, loading: false });
      },
      (error: unknown) => {
        if (run.current === id) setState({ data: null, error, loading: false });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
