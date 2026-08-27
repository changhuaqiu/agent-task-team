'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import { Smile } from 'lucide-react';
import type { EmojiClickData, EmojiStyle } from 'emoji-picker-react';
import { cn } from '@/lib/utils';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => (
    <div className="w-[352px] h-[435px] rounded-[var(--radius-lg)] bg-[hsl(var(--bg-card))] animate-skeleton" />
  ),
});
const NATIVE_EMOJI_STYLE = 'native' as EmojiStyle;

export type EmojiPickerPlacement = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';

export interface EmojiPickerButtonProps {
  /** Called with the native emoji character (e.g. "😀") */
  onEmojiSelect: (emoji: string) => void;
  /** Popover anchor position relative to the trigger button */
  placement?: EmojiPickerPlacement;
  className?: string;
  /** Trigger element — defaults to a Smile icon button */
  children?: ReactNode;
  disabled?: boolean;
}

const placementStyles: Record<EmojiPickerPlacement, string> = {
  'top-start':    'bottom-full left-0 mb-2',
  'top-end':      'bottom-full right-0 mb-2',
  'bottom-start': 'top-full left-0 mt-2',
  'bottom-end':   'top-full right-0 mt-2',
};

export function EmojiPickerButton({
  onEmojiSelect,
  placement = 'bottom-start',
  className,
  children,
  disabled = false,
}: EmojiPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    }

    // Defer listener attachment to avoid the opening click closing immediately
    // Capture phase ensures Escape is caught before parent dialogs/panels can react
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('keydown', handleKeyDown, true);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, close]);

  const handleEmojiClick = useCallback(
    (emojiData: EmojiClickData) => {
      // For custom emojis, pass the unified ID; for native, pass the emoji char
      onEmojiSelect(emojiData.isCustom ? emojiData.unified : emojiData.emoji);
      close();
    },
    [onEmojiSelect, close],
  );

  const toggle = useCallback(() => {
    if (!disabled) setOpen((prev) => !prev);
  }, [disabled]);

  return (
    <div ref={containerRef} className={cn('relative inline-flex', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={open ? '关闭表情面板' : '打开表情面板'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'touch-target-sm rounded-[var(--radius-md)] transition-colors',
          'text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-secondary))]',
          'hover:bg-[hsl(var(--bg-muted))]',
          disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
        )}
      >
        {children ?? <Smile className="w-5 h-5" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="选择表情"
          className={cn(
            'absolute z-50 animate-fade-in',
            placementStyles[placement],
          )}
        >
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[hsl(var(--border-subtle))] shadow-xl shadow-black/10">
            <EmojiPicker
              onEmojiClick={handleEmojiClick}
              emojiStyle={NATIVE_EMOJI_STYLE}
              lazyLoadEmojis
              searchPlaceholder="搜索表情…"
              width={352}
              height={435}
            />
          </div>
        </div>
      )}
    </div>
  );
}
