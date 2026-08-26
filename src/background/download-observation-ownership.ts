// Shared by the inline observer and durable listener. These sets coordinate
// their live handoff only; persisted checkpoints remain the recovery authority.
export const liveInlineObservationIds = new Set<number>();
export const extensionOwnedCreationIds = new Set<number>();
export const terminalChangesAwaitingPersistence = new Set<number>();
export const pendingExtensionDownloadUrls = new Set<string>();

/**
 * Produces a non-reversible local correlation value for an extension Blob URL.
 * The raw URL stays in memory only; the selected-ZIP recovery checkpoint stores
 * this digest so a restarted MV3 worker can still match its onCreated event.
 */
export async function extensionBlobUrlFingerprint(url: string): Promise<string | null> {
  if (!url.startsWith("blob:")) return null;
  try {
    const bytes = new TextEncoder().encode(url);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch {
    return null;
  }
}

/** Keeps the global listener from racing the flow that already owns this exact ID. */
export function beginLiveFiledReturnsDownloadObservation(downloadId: number): () => void {
  if (!Number.isSafeInteger(downloadId) || downloadId < 0) return () => undefined;
  extensionOwnedCreationIds.delete(downloadId);
  terminalChangesAwaitingPersistence.delete(downloadId);
  liveInlineObservationIds.add(downloadId);
  return () => {
    liveInlineObservationIds.delete(downloadId);
    extensionOwnedCreationIds.delete(downloadId);
    terminalChangesAwaitingPersistence.delete(downloadId);
  };
}

/** Registers one extension Blob URL for the brief onCreated-to-ID-persistence gap. */
export function beginPendingExtensionDownloadUrl(url: string): () => void {
  if (!url.startsWith("blob:chrome-extension://")) return () => undefined;
  pendingExtensionDownloadUrls.add(url);
  return () => pendingExtensionDownloadUrls.delete(url);
}
