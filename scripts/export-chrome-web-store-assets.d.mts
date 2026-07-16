export interface ChromeWebStoreAssetDimensions {
  file: string;
  height: number;
  width: number;
}

export function assertOpaqueRgbPng(buffer: Buffer, asset: ChromeWebStoreAssetDimensions): void;
