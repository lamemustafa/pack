export interface ChromeWebStoreAssetDimensions {
  file: string;
  height: number;
  width: number;
}

export interface ChromeWebStoreAsset extends ChromeWebStoreAssetDimensions {
  source: string;
}

export const CHROME_WEB_STORE_ASSETS: readonly ChromeWebStoreAsset[];

export function assertOpaqueRgbPng(buffer: Buffer, asset: ChromeWebStoreAssetDimensions): void;
