import { useEffect, useRef, useState } from "react";

// Stale-while-revalidate list fetching: a key change re-runs `load`, but a
// previously loaded key keeps rendering its last value while the fetch is in
// flight — only a never-seen key yields `data: null` (loading state).
export function useCached<T>(
  key: string,
  load: () => Promise<T>
): { data: T | null; error: string | null; reload: () => void } {
  const cacheRef = useRef<Map<string, T>>(new Map());
  const [, bump] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    setError(null);
    load()
      .then((value) => {
        if (!ignore) {
          cacheRef.current.set(key, value);
          bump((n) => n + 1);
        }
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load your list."
          );
        }
      });
    return () => {
      ignore = true;
    };
    // `load` is a fresh closure every render; `key` must capture its inputs.
  }, [key, reloadKey]);

  return {
    data: cacheRef.current.get(key) ?? null,
    error,
    reload: () => setReloadKey((k) => k + 1),
  };
}
