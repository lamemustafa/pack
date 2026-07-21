import { browser } from "wxt/browser";

export const LOCAL_PROCESSING_DISCLOSURE_VERSION = "2026-07-21-v1";

export interface LocalProcessingAcknowledgement {
  version: typeof LOCAL_PROCESSING_DISCLOSURE_VERSION;
  acknowledgedAt: string;
}

export async function readLocalProcessingAcknowledgement(
  storageKey: string,
): Promise<LocalProcessingAcknowledgement | null> {
  const values = await browser.storage.local.get(storageKey);
  const value = values[storageKey];
  if (!isCurrentAcknowledgement(value)) return null;
  return value;
}

export async function acknowledgeLocalProcessing(
  storageKey: string,
  now = new Date(),
): Promise<LocalProcessingAcknowledgement> {
  const acknowledgement: LocalProcessingAcknowledgement = {
    version: LOCAL_PROCESSING_DISCLOSURE_VERSION,
    acknowledgedAt: now.toISOString(),
  };
  await browser.storage.local.set({ [storageKey]: acknowledgement });
  return acknowledgement;
}

function isCurrentAcknowledgement(value: unknown): value is LocalProcessingAcknowledgement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record.version === LOCAL_PROCESSING_DISCLOSURE_VERSION &&
    typeof record.acknowledgedAt === "string" &&
    Number.isFinite(Date.parse(record.acknowledgedAt))
  );
}
