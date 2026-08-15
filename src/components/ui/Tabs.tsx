'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

interface TabsProps extends TabsContextValue {
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  children: ReactNode;
  className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  return (
    <div role="tablist" className={className}>
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  count?: number;
}

export function TabsTrigger({
  value,
  children,
  disabled = false,
  className,
  count = 0,
}: TabsTriggerProps) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('TabsTrigger must be used within Tabs');

  const { value: currentValue, onValueChange } = context;
  const isActive = currentValue === value;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      disabled={disabled}
      onClick={() => !disabled && onValueChange(value)}
      className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
        isActive
          ? 'bg-[hsl(var(--accent))] text-white'
          : 'bg-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))]'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]'} ${className || ''}`}
    >
      {children}
      {count > 0 && (
        <span className="ml-1.5 rounded-full bg-[hsl(var(--accent-soft))] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--accent))]">
          {count}
        </span>
      )}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('TabsContent must be used within Tabs');

  const { value: currentValue } = context;
  const isActive = currentValue === value;

  if (!isActive) return null;

  return (
    <div role="tabpanel" className={`animate-fade-in ${className || ''}`}>
      {children}
    </div>
  );
}
