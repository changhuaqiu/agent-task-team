'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export const DELIVERY_REQUIREMENT_DRAFT_STORAGE_KEY = 'agent-task-team.delivery-requirement-drafts.v1';

type DeliveryDrafts = Record<string, string>;

function readDrafts(): DeliveryDrafts {
  if (typeof window === 'undefined') return {};
  try {
    const value = window.localStorage.getItem(DELIVERY_REQUIREMENT_DRAFT_STORAGE_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function writeDrafts(drafts: DeliveryDrafts) {
  try {
    window.localStorage.setItem(DELIVERY_REQUIREMENT_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // A draft is a convenience, so storage restrictions must not block the composer.
  }
}

export function useDeliveryRequirementDraft(deliveryId: string | null): {
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  clear: () => void;
} {
  const [drafts, setDrafts] = useState<DeliveryDrafts>(readDrafts);
  const value = deliveryId ? drafts[deliveryId] ?? '' : '';

  useEffect(() => {
    writeDrafts(drafts);
  }, [drafts]);

  const setValue = useCallback<Dispatch<SetStateAction<string>>>((nextValue) => {
    if (!deliveryId) return;
    setDrafts((current) => {
      const resolved = typeof nextValue === 'function'
        ? nextValue(current[deliveryId] ?? '')
        : nextValue;
      if (resolved === current[deliveryId]) return current;
      if (!resolved) {
        const remaining = { ...current };
        delete remaining[deliveryId];
        return remaining;
      }
      return { ...current, [deliveryId]: resolved };
    });
  }, [deliveryId]);

  const clear = useCallback(() => {
    if (!deliveryId) return;
    setDrafts((current) => {
      if (!(deliveryId in current)) return current;
      const remaining = { ...current };
      delete remaining[deliveryId];
      return remaining;
    });
  }, [deliveryId]);

  return { value, setValue, clear };
}
