/**
 * ScopeGuard - 作用域守卫
 *
 * 用于断言所有 source 同属一个 project_id，防止跨项目上下文污染
 */

export interface ScopeViolationError extends Error {
  type: 'mixed_project_id';
  message: string;
  details: {
    expectedProjectId: string;
    violation: Array<{ source: string; projectId: string }>;
  };
}

export interface ScopeGuardOptions {
  projectId: string;
  sources: Array<{ source: string; projectId?: string }>;
}

/**
 * 断言所有 source 同属一个 project_id
 *
 * @param options - 作用域守卫选项
 * @throws {ScopeViolationError} 当检测到跨 project_id 的 source 时
 *
 * @example
 * ```ts
 * scopeGuard({
 *   projectId: 'proj-123',
 *   sources: [
 *     { source: 'history', projectId: 'proj-123' },
 *     { source: 'task', projectId: 'proj-123' },
 *   ],
 * });
 * // Passes - all sources belong to the same project
 * ```
 */
export function scopeGuard(options: ScopeGuardOptions): void {
  const violations: Array<{ source: string; projectId: string }> = [];

  for (const item of options.sources) {
    if (item.projectId !== undefined && item.projectId !== options.projectId) {
      violations.push({
        source: item.source,
        projectId: item.projectId,
      });
    }
  }

  if (violations.length > 0) {
    const error: ScopeViolationError = new Error(
      `Scope violation: ${violations.length} sources belong to different projects`
    ) as ScopeViolationError;
    error.type = 'mixed_project_id';
    error.message = `Expected all sources to belong to project ${options.projectId}, but found violations`;
    error.details = {
      expectedProjectId: options.projectId,
      violation: violations,
    };
    throw error;
  }
}

/**
 * 检查是否存在跨 project_id，但不抛出错误
 *
 * @returns {boolean} true 如果存在跨 project_id
 */
export function hasScopeViolation(options: ScopeGuardOptions): boolean {
  try {
    scopeGuard(options);
    return false;
  } catch {
    return true;
  }
}

/**
 * Legacy API for backward compatibility
 * @deprecated Use scopeGuard({ projectId, sources: [...] }) instead
 */
export interface ScopedItem {
  conversationId?: string;
}

/**
 * Legacy scope guard for backward compatibility with TASK-004
 * @deprecated Use scopeGuard({ projectId, sources: [...] }) instead
 */
export function legacyScopeGuard<T extends ScopedItem>(
  items: T[],
  expectedProjectId: string,
  contextName: string,
): void {
  for (const item of items) {
    if (item.conversationId && item.conversationId !== expectedProjectId) {
      throw new Error(
        `[${contextName}] 跨项目串话检测失败：预期 conversationId=${expectedProjectId}，` +
        `但发现 conversationId=${item.conversationId}`
      );
    }
  }
}

/**
 * Legacy filter for backward compatibility with TASK-004
 * @deprecated Use items.filter(item => item.conversationId === projectId) instead
 */
export function filterByProjectId<T extends ScopedItem>(
  items: T[],
  projectId: string,
): T[] {
  return items.filter(item => item.conversationId === projectId);
}