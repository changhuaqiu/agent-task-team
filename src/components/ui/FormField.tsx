'use client';

import { type ReactNode } from 'react';

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  helper?: string;
  children: ReactNode;
}

export function FormField({
  id,
  label,
  error,
  required = false,
  helper,
  children,
}: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))] flex items-center gap-1"
      >
        {label}
        {required && <span className="text-[hsl(var(--status-rejected))]" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error && (
        <div className="text-[10px] text-[hsl(var(--status-rejected))] mt-0.5" role="alert">
          {error}
        </div>
      )}
      {helper && !error && (
        <div className="text-[10px] text-[hsl(var(--text-tertiary))] mt-0.5">
          {helper}
        </div>
      )}
    </div>
  );
}
