'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: Array<{ label: string; value: string }>;
  onAction?: (value: string) => void;
  className?: string;
}

export const EmptyState = React.memo(function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center flex-1 gap-6 py-12 px-4 ${className || ''}`}>
      <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-[hsl(var(--bg-muted))]">
        <Icon className="w-10 h-10 text-[hsl(var(--text-secondary))]" />
      </div>
      <div className="text-center max-w-[320px]">
        <h3 className="text-[14px] font-bold text-[hsl(var(--text-primary))] mb-2">
          {title}
        </h3>
        <p className="text-[11px] text-[hsl(var(--text-tertiary))] leading-relaxed">
          {description}
        </p>
      </div>
      {actions && actions.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center mt-2">
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onAction?.(action.value)}
              className="text-[11px] px-4 py-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--text-primary))] hover:text-[hsl(var(--text-primary))] transition-all duration-[var(--duration-fast)]"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
