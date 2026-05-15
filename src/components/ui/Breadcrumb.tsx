'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: LucideIcon;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="面包屑导航" className={`flex items-center gap-2 text-[11px] text-[hsl(var(--text-tertiary))] mb-4 ${className || ''}`}>
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          {item.href ? (
            <Link
              href={item.href}
              className="hover:text-[hsl(var(--text-primary))] transition-colors"
            >
              {item.icon && <item.icon className="w-3.5 h-3.5 mr-1" />}
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-[hsl(var(--text-secondary))]">
              {item.icon && <item.icon className="w-3.5 h-3.5 mr-1" />}
              {item.label}
            </span>
          )}
          {index < items.length - 1 && (
            <span aria-hidden="true" className="text-[hsl(var(--border))]">
              /
            </span>
          )}
        </div>
      ))}
    </nav>
  );
}
