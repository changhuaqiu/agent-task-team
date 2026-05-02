import { useCallback, useRef } from 'react';

export function useIMEGuard() {
  const composingRef = useRef(false);
  const rafRef = useRef(0);

  const onCompositionStart = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    composingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback(() => {
    rafRef.current = requestAnimationFrame(() => {
      composingRef.current = false;
    });
  }, []);

  const isComposing = useCallback(() => composingRef.current, []);

  return { onCompositionStart, onCompositionEnd, isComposing } as const;
}
