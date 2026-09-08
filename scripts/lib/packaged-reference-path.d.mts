export function packagedReferenceUrl(page: string, reference: string): URL | null;
export function isSelfReference(page: string, referenceUrl: URL): boolean;
export function isPageRelativeReference(page: string, reference: string): boolean;
export function isPackagedReferenceUrl(referenceUrl: URL): boolean;
export function packagedReferencePath(referenceUrl: URL): string | null;
