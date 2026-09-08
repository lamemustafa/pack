export function referencePathPortion(reference: string): string;
export function packagedReferenceUrl(page: string, reference: string): URL | null;
export function isPageRelativeReference(page: string, reference: string): boolean;
export function isPackagedReferenceUrl(referenceUrl: URL): boolean;
export function packagedReferencePath(referenceUrl: URL): string | null;
