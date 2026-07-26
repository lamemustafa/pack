import { browser } from "wxt/browser";

const KEY = "pack.artifact-acquisition.v1";
export type ArtifactAcquisitionCheckpoint = {
  requestId: string;
  artifactType: "PDF" | "JSON";
  state: "intent" | "download-observing";
  downloadId?: number;
};

export async function persistArtifactAcquisitionIntent(input: Omit<ArtifactAcquisitionCheckpoint, "state" | "downloadId">): Promise<void> {
  await browser.storage.session.set({ [KEY]: { ...input, state: "intent" } satisfies ArtifactAcquisitionCheckpoint });
}

export async function persistArtifactAcquisitionDownloadId(input: ArtifactAcquisitionCheckpoint): Promise<void> {
  await browser.storage.session.set({ [KEY]: { ...input, state: "download-observing" } satisfies ArtifactAcquisitionCheckpoint });
}

export async function clearArtifactAcquisitionCheckpoint(requestId: string): Promise<void> {
  const stored = await browser.storage.session.get(KEY);
  if ((stored[KEY] as { requestId?: unknown } | undefined)?.requestId === requestId) await browser.storage.session.remove(KEY);
}
