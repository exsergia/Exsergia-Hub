import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollectionRef, getDocs, LOCAL_WRITE_EVENT } from './supabaseDb';

const collectionCache = new Map<string, { snap: any }>();

function invalidateCollectionCache(table?: string) {
  if (!table) {
    collectionCache.clear();
    return;
  }

  for (const key of Array.from(collectionCache.keys())) {
    try {
      if (JSON.parse(key)?.table === table) collectionCache.delete(key);
    } catch {
      collectionCache.delete(key);
    }
  }
}

/**
 * Mantem uma captura estavel dos dados durante a sessao da pagina.
 * Alteracoes externas aparecem somente depois de uma recarga manual do app.
 * Gravacoes feitas nesta aba continuam aparecendo imediatamente.
 */
export function useCollection(
  ref: CollectionRef | null | undefined,
  paused = false
): [any | undefined, boolean, Error | undefined, () => Promise<void>] {
  const refKey = useMemo(() => JSON.stringify(ref || null), [ref]);
  const cached = collectionCache.get(refKey);
  const [snap, setSnap] = useState<any>(cached?.snap);
  const [loading, setLoading] = useState(!!ref && !cached);
  const [error, setError] = useState<Error>();

  const hasLoadedRef = useRef(false);
  const isFetchingRef = useRef(false);
  const pausedRef = useRef(paused);
  const pendingRefreshRef = useRef(false);

  const loadData = useCallback(async (isInitial: boolean) => {
    if (!ref) {
      setSnap(undefined);
      setLoading(false);
      return;
    }

    const cachedResult = collectionCache.get(refKey);
    if (isInitial && cachedResult) {
      setSnap(cachedResult.snap);
      setLoading(false);
      hasLoadedRef.current = true;
      return;
    }

    if (!isInitial && pausedRef.current) return;
    if (!isInitial && isFetchingRef.current) return;

    isFetchingRef.current = true;
    if (isInitial && !hasLoadedRef.current) setLoading(true);

    try {
      setError(undefined);
      const result = await getDocs(ref);
      collectionCache.set(refKey, { snap: result });
      setSnap(result);
      hasLoadedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      isFetchingRef.current = false;
      if (isInitial) setLoading(false);
    }
  }, [refKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const wasPaused = pausedRef.current;
    pausedRef.current = paused;
    if (wasPaused && !paused && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      loadData(false);
    }
  }, [paused, loadData]);

  useEffect(() => {
    let alive = true;
    hasLoadedRef.current = false;

    const cachedResult = collectionCache.get(refKey);
    if (cachedResult) {
      setSnap(cachedResult.snap);
      setLoading(false);
    } else if (ref) {
      setSnap(undefined);
      setLoading(true);
    }

    const run = async () => {
      if (!alive) return;
      await loadData(true);
    };

    run();
    return () => {
      alive = false;
    };
  }, [loadData]);

  // Somente uma acao local do usuario pode atualizar uma tela ja aberta.
  useEffect(() => {
    if (!ref?.table || typeof window === 'undefined') return;

    const handleLocalWrite = (event: Event) => {
      const table = (event as CustomEvent<{ table?: string }>).detail?.table;
      if (table && table !== ref.table) return;

      invalidateCollectionCache(ref.table);
      if (pausedRef.current) {
        pendingRefreshRef.current = true;
        return;
      }
      loadData(false);
    };

    window.addEventListener(LOCAL_WRITE_EVENT, handleLocalWrite as EventListener);
    return () => window.removeEventListener(LOCAL_WRITE_EVENT, handleLocalWrite as EventListener);
  }, [ref?.table, loadData]);

  const refetch = useCallback(() => loadData(false), [loadData]);

  return [snap, loading, error, refetch];
}
