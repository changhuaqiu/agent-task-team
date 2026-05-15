'use client';

export function LoadingSkeleton() {
  return (
    <main className="h-dvh overflow-hidden bg-[hsl(var(--bg-app))] text-[hsl(var(--text-primary))] flex flex-col">
      {/* Header Skeleton */}
      <header className="h-[64px] px-6 flex items-center gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm">
        <div className="w-9 h-9 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] animate-skeleton" />
        <div className="h-6 w-32 bg-[hsl(var(--bg-muted))] rounded animate-skeleton" />
      </header>

      {/* Main Content Skeleton */}
      <div className="flex-1 flex gap-px">
        {/* Sidebar Skeleton */}
        <aside className="w-[248px] border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 space-y-3 hidden md:flex">
          <div className="h-10 w-full bg-[hsl(var(--bg-muted))] rounded animate-skeleton" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 w-full bg-[hsl(var(--bg-app))] rounded animate-skeleton" />
          ))}
        </aside>

        {/* Chat Skeleton */}
        <section className="flex-1 bg-[hsl(var(--bg-app))] p-6 space-y-4">
          <div className="h-8 w-48 bg-[hsl(var(--bg-muted))] rounded animate-skeleton" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-[hsl(var(--bg-muted))] shrink-0 animate-skeleton" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-[hsl(var(--bg-muted))] rounded animate-skeleton" />
                  <div className="h-3 w-64 bg-[hsl(var(--bg-muted))] rounded animate-skeleton" />
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* Right Panel Skeleton */}
        <aside className="w-full md:w-[360px] lg:w-[440px] border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] p-4 space-y-4 hidden lg:flex">
          <div className="h-24 w-full bg-[hsl(var(--bg-card))] rounded-xl animate-skeleton" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 w-full bg-[hsl(var(--bg-card))] rounded-lg animate-skeleton" />
          ))}
        </aside>
      </div>
    </main>
  );
}
