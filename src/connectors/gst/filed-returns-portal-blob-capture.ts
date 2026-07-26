import type {
  FiledReturnsDownloadTarget,
  FiledReturnsMainWorldCaptureRequest,
} from "./filed-returns-contracts";
import { FILED_RETURNS_MONTHS, type FiledReturnsMonth } from "./filed-returns-scope";

// Keep the established attribute value because in-flight capture requests persist it across worlds.
const FILED_RETURNS_CAPTURE_CONTROL_ATTRIBUTE = "data-pack-gstr2b-capture-action";
const FILED_RETURNS_CAPTURE_MAX_BYTES = 36 * 1024 * 1024;

export function prepareFiledReturnsPortalBlobDownloadCapture(
  documentRef: Document,
  control: HTMLElement,
  target: FiledReturnsDownloadTarget,
  options: {
    asyncBlobBinding?: "action-xhr-non-artifact-to-pdf";
    signalPrefix: string;
    timeoutMs?: number;
  },
): FiledReturnsMainWorldCaptureRequest | null {
  const view = documentRef.defaultView;
  const period = canonicalCaptureMonth(target.period);
  if (!view || !period) return null;

  const controlId = createCaptureToken(view);
  control.setAttribute(FILED_RETURNS_CAPTURE_CONTROL_ATTRIBUTE, controlId);
  return {
    actionId: target.actionId,
    ...(options.asyncBlobBinding ? { asyncBlobBinding: options.asyncBlobBinding } : {}),
    controlAttribute: FILED_RETURNS_CAPTURE_CONTROL_ATTRIBUTE,
    controlId,
    maxBytes: FILED_RETURNS_CAPTURE_MAX_BYTES,
    signalPrefix: options.signalPrefix,
    targetBinding: {
      artifactType: target.artifactType ?? "PDF",
      controlTextDigest: digestCaptureControlText(readCaptureControlText(control)),
      financialYear: target.financialYear,
      pathnameDigest: digestCaptureControlText(view.location.pathname),
      period,
      returnType: target.returnType,
    },
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  };
}

function canonicalCaptureMonth(value: string): FiledReturnsMonth | null {
  const normalised = normaliseCaptureTargetText(value);
  const aliases: ReadonlyArray<readonly [FiledReturnsMonth, readonly string[]]> = [
    ["January", ["january", "jan"]],
    ["February", ["february", "feb"]],
    ["March", ["march", "mar"]],
    ["April", ["april", "apr"]],
    ["May", ["may"]],
    ["June", ["june", "jun"]],
    ["July", ["july", "jul"]],
    ["August", ["august", "aug"]],
    ["September", ["september", "sept", "sep"]],
    ["October", ["october", "oct"]],
    ["November", ["november", "nov"]],
    ["December", ["december", "dec"]],
  ];
  const month = aliases.find(([, candidates]) => candidates.includes(normalised))?.[0] ?? null;
  return month && FILED_RETURNS_MONTHS.includes(month) ? month : null;
}

function readCaptureControlText(control: HTMLElement): string {
  const InputConstructor = control.ownerDocument.defaultView?.HTMLInputElement;
  return normaliseCaptureTargetText(
    [
      control.innerText || "",
      control.textContent || "",
      InputConstructor && control instanceof InputConstructor ? control.value : "",
      control.getAttribute("aria-label") ?? "",
      control.getAttribute("title") ?? "",
    ].join(" "),
  );
}

function normaliseCaptureTargetText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function digestCaptureControlText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createCaptureToken(view: Window): string {
  const bytes = new Uint8Array(16);
  view.crypto?.getRandomValues?.(bytes);
  if (bytes.some((byte) => byte !== 0)) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
