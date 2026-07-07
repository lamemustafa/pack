import { browser } from "wxt/browser";
import { syntheticDownloadArtifacts } from "../connectors/gst/demo";
import {
  DEFAULT_GST_RETURN_SCOPE,
  createGstReturnPlan,
  createSyntheticGstResults,
} from "../connectors/gst/planner";
import { createArchiveManifest } from "../core/manifest";
import type { PackMessageResponse } from "../core/messages";

export interface SyntheticDemoDeps {
  productVersion: string;
  officialUrl: string;
  storageKeys: {
    lastManifest: string;
  };
  downloadArtifacts?: boolean;
  now?: () => Date;
}

export async function startSyntheticDemo(deps: SyntheticDemoDeps): Promise<PackMessageResponse> {
  const startedAt = deps.now?.() ?? new Date();
  const plan = createGstReturnPlan(DEFAULT_GST_RETURN_SCOPE, startedAt);
  const completedAt = new Date(startedAt.getTime() + 250);
  const results = createSyntheticGstResults(plan, completedAt);
  const manifest = createArchiveManifest(plan, results, {
    productVersion: deps.productVersion,
    build: browser.runtime.getManifest().version,
    officialUrl: deps.officialUrl,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    browserFamily: "Chrome",
  });

  let downloaded = 0;
  if (deps.downloadArtifacts === true) {
    for (const artifact of syntheticDownloadArtifacts(plan, results, manifest)) {
      await browser.downloads.download({
        conflictAction: "uniquify",
        filename: `Pack-Demo/${artifact.filename}`,
        saveAs: false,
        url: makeDataUrl(artifact.mimeType, artifact.body),
      });
      downloaded += 1;
    }
  }

  await browser.storage.local.set({ [deps.storageKeys.lastManifest]: manifest });
  return { ok: true, downloaded, manifest };
}

function makeDataUrl(mimeType: string, body: string): string {
  return `data:${mimeType};base64,${base64Encode(body)}`;
}

function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
