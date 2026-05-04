'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Auto-scrolls a container to the bottom when new content arrives,
 * but respects the user's scroll position — if they've scrolled up
 * to read history, it won't yank them back down.
 */
export function useAutoScroll(ref: RefObject<HTMLElement | null>) {
  const stickRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const scrollToBottom = () => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    };

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      stickRef.current = scrollHeight - scrollTop - clientHeight < 50;
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
    scrollToBottom();

    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [ref]);
}
