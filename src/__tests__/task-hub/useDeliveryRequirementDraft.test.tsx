// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DELIVERY_REQUIREMENT_DRAFT_STORAGE_KEY,
  useDeliveryRequirementDraft,
} from '@/hooks/useDeliveryRequirementDraft';

describe('useDeliveryRequirementDraft', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it('isolates drafts by delivery and restores them from local storage', () => {
    const { result, rerender, unmount } = renderHook(
      ({ deliveryId }) => useDeliveryRequirementDraft(deliveryId),
      { initialProps: { deliveryId: 'delivery-a' as string | null } },
    );

    act(() => result.current.setValue('A draft'));
    rerender({ deliveryId: 'delivery-b' });
    expect(result.current.value).toBe('');

    act(() => result.current.setValue('B draft'));
    rerender({ deliveryId: 'delivery-a' });
    expect(result.current.value).toBe('A draft');
    expect(JSON.parse(window.localStorage.getItem(DELIVERY_REQUIREMENT_DRAFT_STORAGE_KEY) ?? '{}'))
      .toEqual({ 'delivery-a': 'A draft', 'delivery-b': 'B draft' });

    unmount();
    const restored = renderHook(() => useDeliveryRequirementDraft('delivery-b'));
    expect(restored.result.current.value).toBe('B draft');
  });

  it('removes empty drafts without failing when no delivery is selected', () => {
    const { result, rerender } = renderHook(
      ({ deliveryId }) => useDeliveryRequirementDraft(deliveryId),
      { initialProps: { deliveryId: 'delivery-a' as string | null } },
    );
    act(() => result.current.setValue('temporary'));
    act(() => result.current.clear());
    expect(result.current.value).toBe('');

    rerender({ deliveryId: null });
    act(() => result.current.setValue('unscoped'));
    expect(result.current.value).toBe('');
  });
});
