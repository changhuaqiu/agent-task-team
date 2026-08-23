'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Auto-scrolls a container to the bottom when new content arrives,
 * but respects the user's scroll position — if they've scrolled up
 * to read history, it won't yank them back down.
 */
export function useAutoScroll(
  ref: RefObject<HTMLElement | null>,
  options: { scopeKey?: string | null; onAtBottom?: () => void } = {},
) {
  const stickRef = useRef(true);
  const onAtBottomRef = useRef(options.onAtBottom);
  const [isAtBottom, setIsAtBottom] = useState(true);

  useEffect(() => {
    onAtBottomRef.current = options.onAtBottom;
  }, [options.onAtBottom]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = ref.current;
    if (!el) return;
    stickRef.current = true;
    setIsAtBottom(true);
    onAtBottomRef.current?.();
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const nextIsAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      stickRef.current = nextIsAtBottom;
      setIsAtBottom(nextIsAtBottom);
      if (nextIsAtBottom) onAtBottomRef.current?.();
    };

    const onContentChange = () => {
      if (stickRef.current) scrollToBottom();
    };

    // Watch existing children for size changes (streaming text growth)
    const ro = new ResizeObserver(onContentChange);
    for (const child of el.children) ro.observe(child);

    // Watch for new messages being added
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) ro.observe(node);
        }
      }
      onContentChange();
    });
    mo.observe(el, { childList: true, subtree: true });

    el.addEventListener('scroll', onScroll, { passive: true });
    scrollToBottom('auto');

    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [options.scopeKey, ref, scrollToBottom]);

  return { isAtBottom, scrollToBottom };
}
