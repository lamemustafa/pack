import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsMainWorldCaptureRequest,
} from "./filed-returns-contracts";
import type { MainWorldCaptureOutcome } from "../../background/main-world-capture-contracts";

type PdfMakeApi = {
  createPdf?: unknown;
};

type PortalActionContext = { kind: "portal-action" };
type XhrPdfActionContext = {
  blobAttempted: boolean;
  continuation: "available" | "reserved" | "running" | "spent";
  continuationExpiresAt: number | null;
  generation: number;
  kind: "xhr-pdf";
  timerContinuationDelayMs: number | null;
  valid: boolean;
  xhr: XMLHttpRequest;
};
type CaptureActionContext = PortalActionContext | XhrPdfActionContext;
type Gstr3bAnchorDownloadRequirement = {
  kind: "gstr3b-pdf-period";
  periodToken: string;
};
type ActiveCaptureActionBinding = {
  anchorDownloadRequirement: Gstr3bAnchorDownloadRequirement | null;
  context: CaptureActionContext;
  id: number;
  previous: ActiveCaptureActionBinding | null;
};
type AsyncBlobBindingOpenContext = { context: PortalActionContext; generation: number };
type AsyncBlobBindingSelection = {
  anchorDownloadRequirement: Gstr3bAnchorDownloadRequirement | null;
  closeScheduled: boolean;
  closed: boolean;
  context: XhrPdfActionContext | null;
  generation: number;
  seenLoadEvent: Event | null;
  seenLoadEndEvent: Event | null;
  seenReadyStateDoneEvent: Event | null;
  loadEndAnchorDownloadRequirement: Gstr3bAnchorDownloadRequirement | null;
  xhr: XMLHttpRequest;
};
type ClosedAsyncBlobBindingLease = {
  anchorDownloadRequirement: Gstr3bAnchorDownloadRequirement;
  blobAttempted: boolean;
  context: XhrPdfActionContext;
  expiresAt: number;
  generation: number;
  requiresReservedContinuation: boolean;
  selection: AsyncBlobBindingSelection;
  xhr: XMLHttpRequest;
};
type PendingAsyncPdfBlob = {
  anchorDownloadRequirement: Gstr3bAnchorDownloadRequirement | null;
  blob: Blob;
  context: XhrPdfActionContext;
  generation: number;
};
type PendingClosedAsyncPdfBlob = {
  blob: Blob;
  lease: ClosedAsyncBlobBindingLease;
};
type TargetBoundNativeFilenameBinding = {
  generation: number;
  installedDownload: string;
  rootOriginalDownload: string;
};
type XhrEventProperty = "onload" | "onloadend" | "onreadystatechange";
type XhrPageListener = EventListenerOrEventListenerObject;
type XhrListenerRecord = {
  abortCleanup: (() => void) | null;
  active: boolean;
  capture: boolean;
  interposed: boolean;
  listener: XhrPageListener;
  once: boolean;
  options: boolean | AddEventListenerOptions | undefined;
  type: "load" | "loadend" | "readystatechange";
  wrapped: EventListener;
  xhr: XMLHttpRequest;
};
type XhrPropertyHandlerState = {
  active: boolean;
  original: ((this: XMLHttpRequest, event: Event) => unknown) | null;
  patch: XhrEventPropertyPatch;
  property: XhrEventProperty;
  wrapped: ((this: XMLHttpRequest, event: Event) => unknown) | null;
  xhr: XMLHttpRequest;
};
type XhrEventPropertyPatch = {
  installedDescriptor: PropertyDescriptor;
  nativeDescriptor: PropertyDescriptor;
  ownDescriptor: PropertyDescriptor | undefined;
  property: XhrEventProperty;
};

export async function capturePortalBlobDownload(
  config: FiledReturnsMainWorldCaptureRequest,
): Promise<FiledReturnsCapturedDownloadRequest | null> {
  const outcome = await capturePortalBlobDownloadWithDiagnostics(config);
  return outcome.capturedDownloadRequest;
}

export async function capturePortalBlobDownloadWithDiagnostics(
  config: FiledReturnsMainWorldCaptureRequest,
): Promise<MainWorldCaptureOutcome> {
  return new Promise((resolve) => {
    const cssEscape = (value: string) => {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
      }
      return value.replace(/["\\]/g, "\\$&");
    };
    const normaliseTargetText = (value: string) =>
      value
        .normalize("NFKC")
        .replace(/[‐‑‒–—−]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const readTargetElementText = (element: Element | null | undefined) => {
      if (!element) return "";
      const InputConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
      return normaliseTargetText(
        [
          "innerText" in element ? (element as HTMLElement).innerText : "",
          element.textContent ?? "",
          InputConstructor && element instanceof InputConstructor ? element.value : "",
          element.getAttribute("aria-label") ?? "",
          element.getAttribute("title") ?? "",
        ].join(" "),
      );
    };
    const digestTargetText = (value: string) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    };
    const targetMonths = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ] as const;
    const monthAliases: ReadonlyArray<readonly [(typeof targetMonths)[number], readonly string[]]> =
      [
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
    const canonicalTargetMonth = (value: string) => {
      const normalised = normaliseTargetText(value);
      return monthAliases.find(([, aliases]) => aliases.includes(normalised))?.[0] ?? null;
    };
    const canonicalTargetFinancialYear = (value: string) => {
      const match = /^(20\d{2})\s*[-/]\s*(\d{2}|20\d{2})$/.exec(normaliseTargetText(value));
      if (!match?.[1] || !match[2]) return null;
      const startYear = Number(match[1]);
      const endYear = match[2].length === 4 ? Number(match[2].slice(2)) : Number(match[2]);
      return endYear === (startYear + 1) % 100
        ? `${match[1]}-${String(endYear).padStart(2, "0")}`
        : null;
    };
    const isIdentityElementHidden = (element: Element) => {
      const tagName = element.tagName.toLowerCase();
      if (["script", "style", "template", "noscript"].includes(tagName)) return true;
      if (
        (element as HTMLElement).hidden ||
        element.hasAttribute("hidden") ||
        element.hasAttribute("inert") ||
        normaliseTargetText(element.getAttribute("aria-hidden") ?? "") === "true"
      ) {
        return true;
      }
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      return (
        style?.display === "none" ||
        style?.visibility === "hidden" ||
        style?.visibility === "collapse" ||
        style?.opacity === "0"
      );
    };
    const isVisibleIdentityElement = (element: Element) => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        if (isIdentityElementHidden(current)) return false;
      }
      return true;
    };
    const readVisibleIdentityText = (root: Node): string => {
      const parts: string[] = [];
      const visit = (node: Node) => {
        if (node.nodeType === 3) {
          if (node.nodeValue) parts.push(node.nodeValue);
          return;
        }
        if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
        if (node.nodeType === 1 && isIdentityElementHidden(node as Element)) return;
        for (const child of Array.from(node.childNodes)) visit(child);
      };
      visit(root);
      return normaliseTargetText(parts.join(" "));
    };
    const collectLabelEvidence = (text: string) => {
      const financialYears = new Set<string>();
      const periods = new Set<(typeof targetMonths)[number]>();
      const financialYearPattern =
        /\b(?:financial\s*year|fy)\b\s*(?:[-:]\s*)?(20\d{2})\s*(?:[-/]\s*)?(\d{2}|20\d{2})\b/gi;
      const periodPattern = /\b(?:(?:return|tax)\s*period|month)\b\s*(?:[-:]\s*)?([a-z]+)\b/gi;
      for (const match of text.matchAll(financialYearPattern)) {
        if (!match[1] || !match[2]) continue;
        const value = canonicalTargetFinancialYear(`${match[1]}-${match[2]}`);
        if (value) financialYears.add(value);
      }
      for (const match of text.matchAll(periodPattern)) {
        if (!match[1]) continue;
        const value = canonicalTargetMonth(match[1]);
        if (value) periods.add(value);
      }
      return { financialYears, periods };
    };
    const collectVisibleHeadingTypes = () => {
      const types = new Set<"GSTR-1" | "GSTR-3B">();
      for (const heading of Array.from(
        document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']"),
      )) {
        if (!isVisibleIdentityElement(heading)) continue;
        const text = readVisibleIdentityText(heading);
        if (/\bgstr\s*-?\s*3b\b/i.test(text)) types.add("GSTR-3B");
        if (/\bgstr\s*-?\s*1\b/i.test(text)) types.add("GSTR-1");
      }
      return types;
    };
    const hasExpectedTargetRoute = (returnType: string) => {
      const pathname = window.location.pathname;
      if (returnType === "GSTR-3B") return /\/returns\/auth\/gstr3b\/?$/i.test(pathname);
      if (returnType === "GSTR-1") return /\/returns\/auth\/gstr1(?:\/|$)/i.test(pathname);
      return false;
    };
    const isQualifyingArtifactControl = (
      control: HTMLElement,
      returnType: string,
      artifactType: string,
    ) => {
      const text = readTargetElementText(control);
      const hasDownload = /\bdownload\b/.test(text);
      const hasPdf = /\bpdf\b/.test(text);
      const hasExcel = /\bexcel\b/.test(text);
      if (returnType === "GSTR-3B") {
        return (
          artifactType === "PDF" &&
          hasDownload &&
          /\bfiled\b/.test(text) &&
          /\bgstr\s*-?\s*3b\b/.test(text) &&
          !/\bsystem\s+generated\b/.test(text) &&
          !hasExcel
        );
      }
      if (returnType === "GSTR-1" && artifactType === "PDF") {
        return (
          hasDownload &&
          (hasPdf || (/\bfiled\b/.test(text) && /\bgstr\s*-?\s*1\b/.test(text))) &&
          !hasExcel &&
          !/\be-?invoices?\b/.test(text)
        );
      }
      if (returnType === "GSTR-1" && artifactType === "EXCEL") {
        return hasDownload && hasExcel && /\b(?:details?|e-?invoices?)\b/.test(text) && !hasPdf;
      }
      return false;
    };
    const captureTargetFailure = (control: HTMLElement) => {
      const binding = config.targetBinding;
      if (!binding) return "capture-target-binding-missing";
      const validArtifact = binding.artifactType === "PDF" || binding.artifactType === "EXCEL";
      const validReturnType = ["GSTR-3B", "GSTR-1"].includes(binding.returnType);
      const validFinancialYear =
        canonicalTargetFinancialYear(binding.financialYear) === binding.financialYear;
      const validPeriod = targetMonths.includes(binding.period);
      const validDigests = [binding.controlTextDigest, binding.pathnameDigest].every((digest) =>
        /^[a-f0-9]{8}$/.test(digest),
      );
      if (
        !validArtifact ||
        !validReturnType ||
        !validFinancialYear ||
        !validPeriod ||
        !validDigests
      ) {
        return "capture-target-binding-invalid";
      }
      if (digestTargetText(window.location.pathname) !== binding.pathnameDigest) {
        return "capture-target-path-mismatch";
      }
      if (digestTargetText(readTargetElementText(control)) !== binding.controlTextDigest) {
        return "capture-control-fingerprint-mismatch";
      }
      const qualifyingControls = Array.from(
        document.querySelectorAll<HTMLElement>(
          "a,button,[role='button'],[ng-click],[data-ng-click]",
        ),
      ).filter(
        (candidate) =>
          isCaptureControlActionable(candidate) &&
          isQualifyingArtifactControl(candidate, binding.returnType, binding.artifactType),
      );
      if (qualifyingControls.length !== 1 || qualifyingControls[0] !== control) {
        return "capture-control-artifact-mismatch";
      }
      if (!hasExpectedTargetRoute(binding.returnType)) {
        return "capture-target-identity-mismatch";
      }
      const headingTypes = collectVisibleHeadingTypes();
      if (headingTypes.size === 0) return "capture-target-identity-missing";
      if (headingTypes.size > 1) return "capture-target-evidence-conflict";
      if (binding.returnType === "GSTR-2B" || !headingTypes.has(binding.returnType)) {
        return "capture-target-identity-mismatch";
      }

      const visibleText = readVisibleIdentityText(document.body);
      const labelEvidence = collectLabelEvidence(visibleText);
      const financialYears = new Set(labelEvidence.financialYears);
      const periods = new Set(labelEvidence.periods);
      const completeSources =
        labelEvidence.financialYears.size === 1 && labelEvidence.periods.size === 1 ? 1 : 0;
      const sourceConflict =
        labelEvidence.financialYears.size > 1 || labelEvidence.periods.size > 1;
      if (sourceConflict || financialYears.size > 1 || periods.size > 1) {
        return "capture-target-evidence-conflict";
      }
      if (completeSources === 0 || financialYears.size === 0 || periods.size === 0) {
        return "capture-target-identity-missing";
      }
      if (!financialYears.has(binding.financialYear) || !periods.has(binding.period)) {
        return "capture-target-identity-mismatch";
      }
      return null;
    };
    const isCaptureControlActionable = (control: HTMLElement) => {
      if (
        !control.isConnected ||
        control.ownerDocument !== document ||
        !document.documentElement.contains(control)
      ) {
        return false;
      }
      for (let current: HTMLElement | null = control; current; current = current.parentElement) {
        if (
          current.hidden ||
          current.hasAttribute("hidden") ||
          current.hasAttribute("inert") ||
          current.classList.contains("disabled") ||
          ("disabled" in current &&
            Boolean((current as HTMLElement & { disabled?: boolean }).disabled)) ||
          normaliseTargetText(current.getAttribute("aria-hidden") ?? "") === "true" ||
          normaliseTargetText(current.getAttribute("aria-disabled") ?? "") === "true"
        ) {
          return false;
        }
        const style = current.ownerDocument.defaultView?.getComputedStyle(current);
        if (
          style?.display === "none" ||
          style?.visibility === "hidden" ||
          style?.visibility === "collapse" ||
          style?.pointerEvents === "none" ||
          style?.opacity === "0"
        ) {
          return false;
        }
      }
      if (control.hasAttribute("disabled")) return false;
      try {
        if (control.matches(":disabled")) return false;
      } catch {
        return false;
      }
      const rectangles = control.getClientRects?.();
      if (rectangles && rectangles.length > 0) return true;
      const rectangle = control.getBoundingClientRect?.();
      return Boolean(rectangle && (rectangle.width > 0 || rectangle.height > 0));
    };
    const isBlobLike = (value: unknown): value is Blob => {
      if (!value || typeof value !== "object") return false;
      const candidate = value as Partial<Blob>;
      return (
        typeof candidate.size === "number" &&
        typeof candidate.type === "string" &&
        typeof candidate.arrayBuffer === "function"
      );
    };
    const isArtifactContentType = (contentType: string) => {
      const normalised = contentType.toLowerCase();
      return [
        "application/pdf",
        "application/octet-stream",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument",
      ].some((expected) => normalised.includes(expected));
    };
    const captureSignals = (source: "blob" | "data-url", filenameObserved: boolean) => [
      ...(source === "blob"
        ? [
            `${config.signalPrefix}-portal-blob-captured`,
            `${config.signalPrefix}-native-blob-click-suppressed`,
          ]
        : [
            `${config.signalPrefix}-portal-data-url-captured`,
            `${config.signalPrefix}-native-data-click-suppressed`,
          ]),
      `${config.signalPrefix}-main-world-capture`,
      ...(suppressedWindowOpen ? [`${config.signalPrefix}-native-window-open-suppressed`] : []),
      ...(filenameObserved ? [`${config.signalPrefix}-portal-filename-observed`] : []),
    ];
    const safeFailureSignals = new Set<string>([`${config.signalPrefix}-main-world-capture-armed`]);
    const addSafeSignal = (signal: string) => safeFailureSignals.add(signal);
    const urlApi = window.URL ?? URL;
    const webkitUrlApi = (window as Window & { webkitURL?: typeof URL }).webkitURL;
    const originalCreateObjectUrl = urlApi.createObjectURL;
    const originalWebkitCreateObjectUrl = webkitUrlApi?.createObjectURL;
    const originalFetch = window.fetch ?? globalThis.fetch;
    const pdfMake = (window as Window & { pdfMake?: PdfMakeApi }).pdfMake;
    const originalPdfMakeCreatePdf = pdfMake?.createPdf;
    const saveAsTarget = window as Window & { saveAs?: unknown };
    const originalSaveAs = saveAsTarget.saveAs;
    const originalWindowOpen = window.open;
    const originalQueueMicrotask = window.queueMicrotask;
    const originalSetTimeout = window.setTimeout;
    const originalDateNow = Date.now;
    const closedAsyncBlobBindingLeaseMs = 1_000;
    // Keep the action-bound name through Brave's immediate native post-click
    // snapshot without extending the page-visible marker beyond that handoff.
    const targetBoundNativeFilenameHandoffMs = 100;
    const targetBoundNativeFilenameBindingKey = Symbol.for(
      "complyeaze.pack.target-bound-native-filename-binding",
    );
    const callOriginalSetTimeout = (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ): number => Reflect.apply(originalSetTimeout, window, [handler, timeout, ...args]) as number;
    const originalClick = HTMLAnchorElement.prototype.click;
    const originalDispatchEvent = HTMLAnchorElement.prototype.dispatchEvent;
    const originalCreateObjectUrlOwnDescriptor = Object.getOwnPropertyDescriptor(
      urlApi,
      "createObjectURL",
    );
    const originalWebkitCreateObjectUrlOwnDescriptor = webkitUrlApi
      ? Object.getOwnPropertyDescriptor(webkitUrlApi, "createObjectURL")
      : undefined;
    const originalFetchOwnDescriptor = Object.getOwnPropertyDescriptor(window, "fetch");
    const originalPdfMakeCreatePdfOwnDescriptor = pdfMake
      ? Object.getOwnPropertyDescriptor(pdfMake, "createPdf")
      : undefined;
    const originalSaveAsOwnDescriptor = Object.getOwnPropertyDescriptor(saveAsTarget, "saveAs");
    const originalWindowOpenOwnDescriptor = Object.getOwnPropertyDescriptor(window, "open");
    const originalSetTimeoutOwnDescriptor = Object.getOwnPropertyDescriptor(window, "setTimeout");
    const originalClickOwnDescriptor = Object.getOwnPropertyDescriptor(
      HTMLAnchorElement.prototype,
      "click",
    );
    const originalDispatchEventOwnDescriptor = Object.getOwnPropertyDescriptor(
      HTMLAnchorElement.prototype,
      "dispatchEvent",
    );
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;
    const originalXhrAddEventListener = XMLHttpRequest.prototype.addEventListener;
    const originalXhrRemoveEventListener = XMLHttpRequest.prototype.removeEventListener;
    const originalXhrOpenOwnDescriptor = Object.getOwnPropertyDescriptor(
      XMLHttpRequest.prototype,
      "open",
    );
    const originalXhrSendOwnDescriptor = Object.getOwnPropertyDescriptor(
      XMLHttpRequest.prototype,
      "send",
    );
    const originalXhrAddEventListenerOwnDescriptor = Object.getOwnPropertyDescriptor(
      XMLHttpRequest.prototype,
      "addEventListener",
    );
    const originalXhrRemoveEventListenerOwnDescriptor = Object.getOwnPropertyDescriptor(
      XMLHttpRequest.prototype,
      "removeEventListener",
    );
    let installedXhrAddEventListenerOwnDescriptor: PropertyDescriptor | undefined;
    let installedXhrRemoveEventListenerOwnDescriptor: PropertyDescriptor | undefined;
    let installedXhrOpenOwnDescriptor: PropertyDescriptor | undefined;
    let installedXhrSendOwnDescriptor: PropertyDescriptor | undefined;
    const originalRevokeObjectUrl = urlApi.revokeObjectURL;
    const originalWebkitRevokeObjectUrl = webkitUrlApi?.revokeObjectURL;
    const originalRevokeObjectUrlOwnDescriptor = Object.getOwnPropertyDescriptor(
      urlApi,
      "revokeObjectURL",
    );
    const originalWebkitRevokeObjectUrlOwnDescriptor = webkitUrlApi
      ? Object.getOwnPropertyDescriptor(webkitUrlApi, "revokeObjectURL")
      : undefined;
    let installedWebkitCreateObjectUrlOwnDescriptor: PropertyDescriptor | undefined;
    let installedRevokeObjectUrlOwnDescriptor: PropertyDescriptor | undefined;
    let installedWebkitRevokeObjectUrlOwnDescriptor: PropertyDescriptor | undefined;
    let installedPdfMakeCreatePdfOwnDescriptor: PropertyDescriptor | undefined;
    let installedSetTimeoutOwnDescriptor: PropertyDescriptor | undefined;
    let installedWindowOpenOwnDescriptor: PropertyDescriptor | undefined;
    let installedSaveAsOwnDescriptor: PropertyDescriptor | undefined;
    let installedFetchOwnDescriptor: PropertyDescriptor | undefined;
    let installedCreateObjectUrlOwnDescriptor: PropertyDescriptor | undefined;
    let installedClickOwnDescriptor: PropertyDescriptor | undefined;
    let installedDispatchEventOwnDescriptor: PropertyDescriptor | undefined;
    let capturePdfMakeCreatePdf: ((this: PdfMakeApi, ...args: unknown[]) => unknown) | undefined;
    const capturedBlobUrls = new Set<string>();
    const capturedBlobsByUrl = new Map<string, Blob>();
    const actionBoundBlobs = new WeakSet<Blob>();
    const invalidatedAsyncBlobUrls = new Set<string>();
    const invalidatedAsyncBlobs = new WeakSet<Blob>();
    const pendingAsyncPdfBlobsByUrl = new Map<string, PendingAsyncPdfBlob>();
    const pendingClosedAsyncPdfBlobsByUrl = new Map<string, PendingClosedAsyncPdfBlob>();
    const pendingAsyncPdfAnchorDispatches = new WeakSet<HTMLAnchorElement>();
    const actionBoundXhrs = new WeakSet<XMLHttpRequest>();
    const actionBoundXhrHandlers = new WeakSet<XMLHttpRequest>();
    const asyncBlobBindingXhrHandlers = new WeakSet<XMLHttpRequest>();
    const asyncBlobBindingOpenContexts = new WeakMap<XMLHttpRequest, AsyncBlobBindingOpenContext>();
    const actionBoundResponseRestorers: Array<() => void> = [];
    const xhrEventPropertyPatches = new Map<XhrEventProperty, XhrEventPropertyPatch>();
    const xhrListenerRecords = new Set<XhrListenerRecord>();
    const xhrListenerRecordsByXhr = new WeakMap<
      XMLHttpRequest,
      WeakMap<object, Map<string, XhrListenerRecord>>
    >();
    const xhrPropertyHandlerStates = new Set<XhrPropertyHandlerState>();
    const xhrPropertyHandlerStatesByXhr = new WeakMap<
      XMLHttpRequest,
      Map<XhrEventProperty, XhrPropertyHandlerState>
    >();
    let activeActionBinding: ActiveCaptureActionBinding | null = null;
    let actionBindingId = 0;
    let asyncBlobBindingGeneration = 0;
    let asyncBlobBindingQualifiedSendCount = 0;
    let asyncBlobBindingSelection: AsyncBlobBindingSelection | null = null;
    let closedAsyncBlobBindingLease: ClosedAsyncBlobBindingLease | null = null;
    let asyncBlobBindingAmbiguous = false;
    let asyncBlobBindingEnabled = config.asyncBlobBinding === "action-xhr-non-artifact-to-pdf";
    let suppressedWindowOpen = false;
    let restored = false;
    let settled = false;
    let targetBoundNativeDelegatedAt: string | null = null;

    const queueActionContextMicrotask = (callback: () => void): boolean => {
      if (typeof originalQueueMicrotask !== "function") return false;
      try {
        Reflect.apply(originalQueueMicrotask, window, [callback]);
        return true;
      } catch {
        return false;
      }
    };
    const activeActionContext = () => activeActionBinding?.context ?? null;
    const activePortalActionContext = () => {
      const context = activeActionContext();
      return context?.kind === "portal-action" ? context : null;
    };
    const activateActionContext = (
      context: CaptureActionContext,
      anchorDownloadRequirement: Gstr3bAnchorDownloadRequirement | null = null,
    ): ActiveCaptureActionBinding => {
      const binding = {
        anchorDownloadRequirement,
        context,
        id: ++actionBindingId,
        previous: activeActionBinding,
      };
      activeActionBinding = binding;
      return binding;
    };
    const releaseActionContext = (binding: ActiveCaptureActionBinding) => {
      if (activeActionBinding === binding) {
        activeActionBinding = binding.previous;
        return;
      }
      let descendant = activeActionBinding;
      while (descendant?.previous) {
        if (descendant.previous === binding) {
          descendant.previous = binding.previous;
          return;
        }
        descendant = descendant.previous;
      }
    };
    const releaseActionContextsFor = (context: CaptureActionContext) => {
      while (activeActionBinding?.context === context) {
        activeActionBinding = activeActionBinding.previous;
      }
      let descendant = activeActionBinding;
      while (descendant?.previous) {
        if (descendant.previous.context === context) {
          descendant.previous = descendant.previous.previous;
          continue;
        }
        descendant = descendant.previous;
      }
    };
    const invalidateClosedAsyncBlobBindingLease = (lease = closedAsyncBlobBindingLease) => {
      if (!lease || closedAsyncBlobBindingLease !== lease) return;
      closedAsyncBlobBindingLease = null;
      for (const [blobUrl, pending] of pendingClosedAsyncPdfBlobsByUrl) {
        if (pending.lease === lease) pendingClosedAsyncPdfBlobsByUrl.delete(blobUrl);
      }
      lease.context.valid = false;
      releaseActionContextsFor(lease.context);
    };
    const liveClosedAsyncBlobBindingLease = () => {
      const lease = closedAsyncBlobBindingLease;
      if (!lease) return null;
      const now = Reflect.apply(originalDateNow, Date, []) as number;
      if (
        settled ||
        restored ||
        !lease.context.valid ||
        asyncBlobBindingAmbiguous ||
        asyncBlobBindingQualifiedSendCount !== 1 ||
        lease.expiresAt < now
      ) {
        invalidateClosedAsyncBlobBindingLease(lease);
        return null;
      }
      return lease;
    };
    const armClosedAsyncBlobBindingLease = (selection: AsyncBlobBindingSelection) => {
      const context = selection.context;
      const anchorDownloadRequirement = selection.anchorDownloadRequirement;
      const now = Reflect.apply(originalDateNow, Date, []) as number;
      if (
        closedAsyncBlobBindingLease ||
        !context?.valid ||
        (context.continuation !== "available" && context.continuation !== "reserved") ||
        (context.continuation === "reserved" &&
          (context.continuationExpiresAt === null || context.continuationExpiresAt < now)) ||
        context.blobAttempted ||
        !anchorDownloadRequirement ||
        asyncBlobBindingAmbiguous ||
        asyncBlobBindingQualifiedSendCount !== 1 ||
        (!selection.seenReadyStateDoneEvent &&
          !selection.seenLoadEvent &&
          !selection.seenLoadEndEvent)
      ) {
        return false;
      }
      const lease: ClosedAsyncBlobBindingLease = {
        anchorDownloadRequirement,
        blobAttempted: false,
        context,
        expiresAt: Math.min(
          now + closedAsyncBlobBindingLeaseMs,
          context.continuationExpiresAt ?? Number.POSITIVE_INFINITY,
        ),
        generation: selection.generation,
        requiresReservedContinuation: context.continuation === "reserved",
        selection,
        xhr: selection.xhr,
      };
      closedAsyncBlobBindingLease = lease;
      releaseActionContextsFor(context);
      try {
        callOriginalSetTimeout(
          () => invalidateClosedAsyncBlobBindingLease(lease),
          Math.max(0, lease.expiresAt - now),
        );
        return true;
      } catch {
        invalidateClosedAsyncBlobBindingLease(lease);
        return false;
      }
    };
    const releaseActionContextAfterMicrotasks = (
      binding: ActiveCaptureActionBinding,
      checkpoints = 1,
    ) => {
      const release = (remaining: number) => {
        const scheduled = queueActionContextMicrotask(() => {
          if (remaining > 1) {
            release(remaining - 1);
            return;
          }
          releaseActionContext(binding);
        });
        if (!scheduled) releaseActionContext(binding);
      };
      release(checkpoints);
    };

    const callOriginalXhrAddEventListener = (
      xhr: XMLHttpRequest,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      Reflect.apply(originalXhrAddEventListener, xhr, [type, listener, options]);
    };
    const callOriginalXhrRemoveEventListener = (
      xhr: XMLHttpRequest,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      Reflect.apply(originalXhrRemoveEventListener, xhr, [type, listener, options]);
    };
    const restoreSafely = (restoreOperation: () => void) => {
      try {
        restoreOperation();
      } catch {
        // One hostile or changed page object must not strand the remaining hooks.
      }
    };
    const propertyDescriptorMatches = (
      currentDescriptor: PropertyDescriptor | undefined,
      installedDescriptor: PropertyDescriptor | undefined,
    ) =>
      Boolean(
        currentDescriptor &&
        installedDescriptor &&
        currentDescriptor.configurable === installedDescriptor.configurable &&
        currentDescriptor.enumerable === installedDescriptor.enumerable &&
        ("value" in currentDescriptor
          ? "value" in installedDescriptor &&
            currentDescriptor.value === installedDescriptor.value &&
            currentDescriptor.writable === installedDescriptor.writable
          : !("value" in installedDescriptor) &&
            currentDescriptor.get === installedDescriptor.get &&
            currentDescriptor.set === installedDescriptor.set),
      );
    const restorePropertyIfOwned = (
      target: object,
      property: PropertyKey,
      originalOwnDescriptor: PropertyDescriptor | undefined,
      installedOwnDescriptor: PropertyDescriptor | undefined,
    ) => {
      if (
        !propertyDescriptorMatches(
          Object.getOwnPropertyDescriptor(target, property),
          installedOwnDescriptor,
        )
      ) {
        return;
      }
      if (originalOwnDescriptor) {
        Object.defineProperty(target, property, originalOwnDescriptor);
      } else {
        delete (target as Record<PropertyKey, unknown>)[property];
      }
    };
    const restoreXhrPrototypeMethod = (
      property: "addEventListener" | "open" | "removeEventListener" | "send",
      ownDescriptor: PropertyDescriptor | undefined,
      installedDescriptor: PropertyDescriptor | undefined,
    ) =>
      restorePropertyIfOwned(
        XMLHttpRequest.prototype,
        property,
        ownDescriptor,
        installedDescriptor,
      );
    const restoreXhrListenerRecord = (record: XhrListenerRecord) => {
      if (!record.interposed) return;
      callOriginalXhrRemoveEventListener(record.xhr, record.type, record.wrapped, {
        capture: record.capture,
      });
      if (record.active) {
        callOriginalXhrAddEventListener(record.xhr, record.type, record.listener, record.options);
      }
      record.abortCleanup?.();
      record.abortCleanup = null;
      record.interposed = false;
    };
    const restoreXhrListenerRecordsFor = (xhr: XMLHttpRequest) => {
      for (const record of xhrListenerRecords) {
        if (record.xhr === xhr) restoreXhrListenerRecord(record);
      }
    };
    const restoreXhrPropertyHandlerState = (state: XhrPropertyHandlerState) => {
      if (!state.active) return;
      if (state.patch.nativeDescriptor.get?.call(state.xhr) === state.wrapped) {
        state.patch.nativeDescriptor.set?.call(state.xhr, state.original);
      }
      state.active = false;
      const states = xhrPropertyHandlerStatesByXhr.get(state.xhr);
      if (states?.get(state.property) !== state) return;
      states.delete(state.property);
      if (states.size === 0) xhrPropertyHandlerStatesByXhr.delete(state.xhr);
    };
    const restoreXhrPropertyHandlerStatesFor = (xhr: XMLHttpRequest) => {
      const states = xhrPropertyHandlerStatesByXhr.get(xhr);
      if (!states) return;
      for (const state of [...states.values()]) restoreXhrPropertyHandlerState(state);
    };

    const restore = () => {
      if (restored) return;
      restored = true;
      invalidateClosedAsyncBlobBindingLease();
      const openSelection = asyncBlobBindingSelection;
      asyncBlobBindingSelection = null;
      if (openSelection) {
        openSelection.closed = true;
        if (openSelection.context) {
          openSelection.context.valid = false;
          releaseActionContextsFor(openSelection.context);
        }
      }
      for (const [blobUrl, pending] of pendingAsyncPdfBlobsByUrl) {
        invalidatedAsyncBlobUrls.add(blobUrl);
        invalidatedAsyncBlobs.add(pending.blob);
      }
      pendingAsyncPdfBlobsByUrl.clear();
      for (const record of xhrListenerRecords) {
        restoreSafely(() => restoreXhrListenerRecord(record));
      }
      for (const state of xhrPropertyHandlerStates) {
        restoreSafely(() => restoreXhrPropertyHandlerState(state));
      }
      while (actionBoundResponseRestorers.length > 0) {
        const restoreResponse = actionBoundResponseRestorers.pop();
        if (restoreResponse) restoreSafely(restoreResponse);
      }
      for (const patch of xhrEventPropertyPatches.values()) {
        restoreSafely(() => restoreXhrEventPropertyPatch(patch));
      }
      restoreSafely(() => {
        restoreXhrPrototypeMethod(
          "addEventListener",
          originalXhrAddEventListenerOwnDescriptor,
          installedXhrAddEventListenerOwnDescriptor,
        );
      });
      restoreSafely(() => {
        restoreXhrPrototypeMethod(
          "removeEventListener",
          originalXhrRemoveEventListenerOwnDescriptor,
          installedXhrRemoveEventListenerOwnDescriptor,
        );
      });
      restoreSafely(() => {
        restoreXhrPrototypeMethod(
          "open",
          originalXhrOpenOwnDescriptor,
          installedXhrOpenOwnDescriptor,
        );
      });
      restoreSafely(() => {
        restoreXhrPrototypeMethod(
          "send",
          originalXhrSendOwnDescriptor,
          installedXhrSendOwnDescriptor,
        );
      });
      restoreSafely(() => {
        restorePropertyIfOwned(
          urlApi,
          "createObjectURL",
          originalCreateObjectUrlOwnDescriptor,
          installedCreateObjectUrlOwnDescriptor,
        );
      });
      if (typeof originalRevokeObjectUrl === "function") {
        restoreSafely(() => {
          restorePropertyIfOwned(
            urlApi,
            "revokeObjectURL",
            originalRevokeObjectUrlOwnDescriptor,
            installedRevokeObjectUrlOwnDescriptor,
          );
        });
      }
      if (webkitUrlApi && originalWebkitCreateObjectUrl) {
        restoreSafely(() => {
          restorePropertyIfOwned(
            webkitUrlApi,
            "createObjectURL",
            originalWebkitCreateObjectUrlOwnDescriptor,
            installedWebkitCreateObjectUrlOwnDescriptor,
          );
        });
      }
      if (webkitUrlApi && originalWebkitRevokeObjectUrl) {
        restoreSafely(() => {
          restorePropertyIfOwned(
            webkitUrlApi,
            "revokeObjectURL",
            originalWebkitRevokeObjectUrlOwnDescriptor,
            installedWebkitRevokeObjectUrlOwnDescriptor,
          );
        });
      }
      restoreSafely(() => {
        restorePropertyIfOwned(
          window,
          "fetch",
          originalFetchOwnDescriptor,
          installedFetchOwnDescriptor,
        );
      });
      if (pdfMake && originalPdfMakeCreatePdf) {
        restoreSafely(() => {
          restorePropertyIfOwned(
            pdfMake,
            "createPdf",
            originalPdfMakeCreatePdfOwnDescriptor,
            installedPdfMakeCreatePdfOwnDescriptor,
          );
        });
      }
      restoreSafely(() => {
        restorePropertyIfOwned(
          saveAsTarget,
          "saveAs",
          originalSaveAsOwnDescriptor,
          installedSaveAsOwnDescriptor,
        );
      });
      restoreSafely(() => {
        restorePropertyIfOwned(
          window,
          "open",
          originalWindowOpenOwnDescriptor,
          installedWindowOpenOwnDescriptor,
        );
      });
      restoreSafely(() => {
        restorePropertyIfOwned(
          window,
          "setTimeout",
          originalSetTimeoutOwnDescriptor,
          installedSetTimeoutOwnDescriptor,
        );
      });
      restoreSafely(() => {
        restorePropertyIfOwned(
          HTMLAnchorElement.prototype,
          "click",
          originalClickOwnDescriptor,
          installedClickOwnDescriptor,
        );
      });
      restoreSafely(() => {
        restorePropertyIfOwned(
          HTMLAnchorElement.prototype,
          "dispatchEvent",
          originalDispatchEventOwnDescriptor,
          installedDispatchEventOwnDescriptor,
        );
      });
      restoreSafely(() => {
        for (const control of Array.from(
          document.querySelectorAll<HTMLElement>(
            `[${config.controlAttribute}="${cssEscape(config.controlId)}"]`,
          ),
        )) {
          control.removeAttribute(config.controlAttribute);
        }
      });
    };

    const settle = (request: FiledReturnsCapturedDownloadRequest | null) => {
      if (settled) return;
      settled = true;
      const outcome: MainWorldCaptureOutcome = {
        capturedDownloadRequest: request,
        safeFailureSignals: request ? [] : Array.from(safeFailureSignals),
        ...(targetBoundNativeDelegatedAt ? { targetBoundNativeDelegatedAt } : {}),
      };
      if (!request) {
        restore();
        resolve(outcome);
        return;
      }
      callOriginalSetTimeout(() => {
        restore();
        resolve(outcome);
      }, 1_000);
    };

    const readBlob = (blob: Blob, filenameObserved = false, actionBound = false) => {
      if (settled) return;
      if (invalidatedAsyncBlobs.has(blob) || (!actionBound && !actionBoundBlobs.has(blob))) {
        addSafeSignal(`${config.signalPrefix}-unbound-blob-ignored`);
        return;
      }
      actionBoundBlobs.add(blob);
      if (!blob.size) {
        addSafeSignal(`${config.signalPrefix}-blob-zero-byte-rejected`);
        return;
      }
      if (blob.size > config.maxBytes) {
        addSafeSignal(`${config.signalPrefix}-blob-oversized-rejected`);
        return;
      }
      if (blob.type && !isArtifactContentType(blob.type)) {
        addSafeSignal(`${config.signalPrefix}-blob-content-type-rejected`);
        return;
      }
      addSafeSignal(`${config.signalPrefix}-blob-bytes-accepted`);
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result !== "string") {
          addSafeSignal(`${config.signalPrefix}-file-reader-result-rejected`);
          settle(null);
          return;
        }
        const safeSignals = captureSignals("blob", filenameObserved);
        settle({
          actionId: config.actionId,
          dataUrl: reader.result,
          safeSignals,
        });
      });
      reader.addEventListener("error", () => {
        addSafeSignal(`${config.signalPrefix}-file-reader-error`);
        settle(null);
      });
      reader.readAsDataURL(blob);
    };

    const captureDataUrl = (dataUrl: string, filename?: string | null, actionBound = false) => {
      if (settled) return;
      if (!actionBound) {
        addSafeSignal(`${config.signalPrefix}-unbound-data-url-ignored`);
        return;
      }
      addSafeSignal(`${config.signalPrefix}-data-url-observed`);
      if (!dataUrl.startsWith("data:") || dataUrl.length > config.maxBytes * 2) {
        addSafeSignal(`${config.signalPrefix}-data-url-rejected`);
        return;
      }
      const metadataEnd = dataUrl.indexOf(",");
      const contentType = metadataEnd > 5 ? dataUrl.slice(5, metadataEnd).split(";", 1)[0] : "";
      if (!contentType || !isArtifactContentType(contentType)) {
        addSafeSignal(`${config.signalPrefix}-data-url-content-type-rejected`);
        return;
      }
      const safeSignals = captureSignals("data-url", Boolean(filename));
      settle({
        actionId: config.actionId,
        dataUrl,
        safeSignals,
      });
    };

    const captureBlobUrl = (blobUrl: string, filename?: string | null, actionBound = false) => {
      if (settled) return;
      if (invalidatedAsyncBlobUrls.has(blobUrl) || !actionBound) {
        addSafeSignal(`${config.signalPrefix}-unbound-blob-url-ignored`);
        return;
      }
      addSafeSignal(`${config.signalPrefix}-blob-url-observed`);
      const capturedBlob = capturedBlobsByUrl.get(blobUrl);
      if (capturedBlob) {
        readBlob(capturedBlob, Boolean(filename), true);
        return;
      }
      if (typeof originalFetch !== "function") {
        addSafeSignal(`${config.signalPrefix}-blob-url-fetch-unavailable`);
        return;
      }
      void originalFetch
        .call(window, blobUrl)
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (blob) readBlob(blob, Boolean(filename), true);
          else addSafeSignal(`${config.signalPrefix}-blob-url-fetch-rejected`);
        })
        .catch(() => addSafeSignal(`${config.signalPrefix}-blob-url-fetch-failed`));
    };

    const captureUrl = (value: string | URL, filename?: string | null, actionBound = false) => {
      const nextUrl = String(value);
      if (nextUrl.startsWith("data:")) captureDataUrl(nextUrl, filename, actionBound);
      if (nextUrl.startsWith("blob:")) captureBlobUrl(nextUrl, filename, actionBound);
    };

    const captureEmbeddedUrls = (text: string, actionBound = false) => {
      for (const [url] of text.matchAll(/\b(?:blob|data):[^"'<>\\\s)]+/g)) {
        captureUrl(url, undefined, actionBound);
      }
    };

    const activePendingAsyncPdfSink = (anchor: HTMLAnchorElement) => {
      if (!anchor.hasAttribute("download") || !anchor.href.startsWith("blob:")) return null;
      const pending = pendingAsyncPdfBlobsByUrl.get(anchor.href);
      if (!pending) return null;
      const context = activeActionContext();
      const selection = asyncBlobBindingSelection;
      const anchorDownloadMatches =
        pending.anchorDownloadRequirement === null ||
        matchesTargetBoundGstr3bAnchorDownload(anchor.download, pending.anchorDownloadRequirement);
      const exactPendingSink =
        context?.kind === "xhr-pdf" &&
        context === pending.context &&
        context.valid &&
        anchorDownloadMatches &&
        selection?.context === context &&
        selection.xhr === context.xhr &&
        selection.generation === pending.generation &&
        !selection.closed &&
        !asyncBlobBindingAmbiguous;
      return exactPendingSink ? { blobUrl: anchor.href, pending } : null;
    };
    const activePendingClosedAsyncPdfSink = (anchor: HTMLAnchorElement) => {
      if (!anchor.hasAttribute("download") || !anchor.href.startsWith("blob:")) return null;
      const pending = pendingClosedAsyncPdfBlobsByUrl.get(anchor.href);
      if (!pending) return null;
      const lease = liveClosedAsyncBlobBindingLease();
      const exactPendingSink =
        lease === pending.lease &&
        lease.context.valid &&
        lease.generation === lease.context.generation &&
        lease.xhr === lease.context.xhr &&
        !asyncBlobBindingAmbiguous &&
        matchesTargetBoundGstr3bAnchorDownload(anchor.download, lease.anchorDownloadRequirement);
      return exactPendingSink ? { blobUrl: anchor.href, pending } : null;
    };
    const captureAnchorDownload = (anchor: HTMLAnchorElement) => {
      const pendingClosedForAnchor = pendingClosedAsyncPdfBlobsByUrl.get(anchor.href);
      const closedLease = liveClosedAsyncBlobBindingLease();
      if (closedLease?.blobAttempted && !pendingClosedForAnchor) {
        invalidateClosedAsyncBlobBindingLease(closedLease);
      }
      if (!anchor.hasAttribute("download")) {
        if (pendingClosedForAnchor) {
          pendingClosedAsyncPdfBlobsByUrl.delete(anchor.href);
          invalidateClosedAsyncBlobBindingLease(pendingClosedForAnchor.lease);
        }
        return false;
      }
      if (anchor.href.startsWith("data:")) {
        if (!activePortalActionContext()) return false;
        captureDataUrl(anchor.href, anchor.getAttribute("download"), true);
        return true;
      }
      if (anchor.href.startsWith("blob:")) {
        if (pendingClosedForAnchor) {
          const exactClosedSink = activePendingClosedAsyncPdfSink(anchor);
          pendingClosedAsyncPdfBlobsByUrl.delete(anchor.href);
          if (!exactClosedSink) {
            invalidateClosedAsyncBlobBindingLease(pendingClosedForAnchor.lease);
            return false;
          }
          const blob = pendingClosedForAnchor.blob;
          capturedBlobUrls.add(anchor.href);
          capturedBlobsByUrl.set(anchor.href, blob);
          invalidateClosedAsyncBlobBindingLease(pendingClosedForAnchor.lease);
          actionBoundBlobs.add(blob);
          readBlob(blob, true, true);
          return true;
        }
        const pending = pendingAsyncPdfBlobsByUrl.get(anchor.href);
        if (pending) {
          if (!activePendingAsyncPdfSink(anchor)) return false;
          pendingAsyncPdfBlobsByUrl.delete(anchor.href);
          capturedBlobUrls.add(anchor.href);
          capturedBlobsByUrl.set(anchor.href, pending.blob);
          actionBoundBlobs.add(pending.blob);
          readBlob(pending.blob, true, true);
          return true;
        }
        if (invalidatedAsyncBlobUrls.has(anchor.href)) return false;
        const actionBound =
          Boolean(activePortalActionContext()) || capturedBlobUrls.has(anchor.href);
        if (!actionBound) return false;
        captureBlobUrl(anchor.href, anchor.getAttribute("download"), true);
        return true;
      }
      if (activePortalActionContext() && /^https?:/i.test(anchor.href)) {
        addSafeSignal(`${config.signalPrefix}-native-https-download-suppressed`);
        return true;
      }
      return false;
    };

    const captureSetTimeout = function setTimeout(
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) {
      const activeContext = activeActionContext();
      const portalActionContext = activeContext?.kind === "portal-action" ? activeContext : null;
      if (portalActionContext && typeof handler === "function") {
        return callOriginalSetTimeout(
          function actionBoundTimerCallback(this: unknown, ...callbackArgs: unknown[]) {
            const actionBinding = activateActionContext(portalActionContext);
            try {
              Reflect.apply(handler, this, callbackArgs);
            } finally {
              releaseActionContextAfterMicrotasks(actionBinding);
            }
          },
          timeout,
          ...args,
        );
      }

      const xhrPdfContext = activeContext?.kind === "xhr-pdf" ? activeContext : null;
      if (!xhrPdfContext || typeof handler !== "function") {
        return callOriginalSetTimeout(handler, timeout, ...args);
      }
      const anchorDownloadRequirement =
        activeActionBinding?.context === xhrPdfContext
          ? activeActionBinding.anchorDownloadRequirement
          : null;

      const timerDelayMs = timeout ?? 0;
      const selection = asyncBlobBindingSelection;
      const exactSelection =
        xhrPdfContext.valid &&
        xhrPdfContext.continuation === "available" &&
        Number.isFinite(timerDelayMs) &&
        timerDelayMs >= 0 &&
        timerDelayMs <= 1_000 &&
        selection?.context === xhrPdfContext &&
        selection.xhr === xhrPdfContext.xhr &&
        selection.generation === xhrPdfContext.generation &&
        !selection.closed &&
        !asyncBlobBindingAmbiguous;
      if (!exactSelection) {
        invalidateXhrPdfActionContext(xhrPdfContext);
        return callOriginalSetTimeout(handler, timeout, ...args);
      }

      xhrPdfContext.continuation = "reserved";
      xhrPdfContext.continuationExpiresAt =
        (Reflect.apply(originalDateNow, Date, []) as number) + closedAsyncBlobBindingLeaseMs;
      xhrPdfContext.timerContinuationDelayMs = timerDelayMs;
      try {
        return callOriginalSetTimeout(
          function xhrPdfTimerContinuation(this: unknown, ...callbackArgs: unknown[]) {
            const now = Reflect.apply(originalDateNow, Date, []) as number;
            if (
              settled ||
              restored ||
              !xhrPdfContext.valid ||
              xhrPdfContext.continuation !== "reserved" ||
              xhrPdfContext.continuationExpiresAt === null ||
              xhrPdfContext.continuationExpiresAt < now
            ) {
              invalidateXhrPdfActionContext(xhrPdfContext);
              Reflect.apply(handler, this, callbackArgs);
              return;
            }
            xhrPdfContext.continuation = "running";
            xhrPdfContext.continuationExpiresAt = null;
            xhrPdfContext.timerContinuationDelayMs = null;
            const actionBinding = activateActionContext(xhrPdfContext, anchorDownloadRequirement);
            try {
              Reflect.apply(handler, this, callbackArgs);
            } finally {
              if (activeActionBinding === actionBinding) {
                activeActionBinding = actionBinding.previous;
              }
              if (xhrPdfContext.continuation === "running") {
                xhrPdfContext.continuation = "spent";
              }
              closeAsyncBlobBindingSelection(selection);
            }
          },
          timerDelayMs,
          ...args,
        );
      } catch (error) {
        if (xhrPdfContext.valid && xhrPdfContext.continuation === "reserved") {
          xhrPdfContext.continuation = "available";
          xhrPdfContext.continuationExpiresAt = null;
          xhrPdfContext.timerContinuationDelayMs = null;
        }
        throw error;
      }
    } as unknown as typeof window.setTimeout;

    const captureWindowOpen = function open(url?: string | URL) {
      const urlText = url ? String(url) : "";
      const actionBound =
        Boolean(activePortalActionContext()) ||
        (urlText.startsWith("blob:") && capturedBlobUrls.has(urlText));
      if (!actionBound) {
        return originalWindowOpen.call(window, url);
      }
      addSafeSignal(`${config.signalPrefix}-window-open-observed`);
      suppressedWindowOpen = true;
      if (url) captureUrl(url, undefined, true);
      const fakeDocument = {
        close() {
          return undefined;
        },
        open() {
          return fakeDocument;
        },
        write(...values: string[]) {
          captureEmbeddedUrls(values.join(""), true);
        },
        writeln(...values: string[]) {
          captureEmbeddedUrls(values.join(""), true);
        },
      };
      return {
        close() {
          return undefined;
        },
        document: fakeDocument,
        focus() {
          return undefined;
        },
        location: {
          assign(value: string | URL) {
            captureUrl(value, undefined, true);
          },
          replace(value: string | URL) {
            captureUrl(value, undefined, true);
          },
          set href(value: string) {
            captureUrl(value, undefined, true);
          },
        },
      } as unknown as WindowProxy;
    };

    if (pdfMake && typeof originalPdfMakeCreatePdf === "function") {
      capturePdfMakeCreatePdf = function createPdf(this: PdfMakeApi, ...args: unknown[]) {
        const actionBound = Boolean(activePortalActionContext());
        const pdf = originalPdfMakeCreatePdf.apply(this, args) as
          | {
              download?: (filename?: string | null) => unknown;
              getBlob?: (callback: (blob: Blob) => void) => unknown;
              open?: (...openArgs: unknown[]) => unknown;
              print?: (...printArgs: unknown[]) => unknown;
            }
          | null
          | undefined;
        if (!pdf || typeof pdf !== "object") return pdf;
        if (!actionBound) return pdf;

        const readPdfBlob = (filename?: string | null) => {
          if (typeof pdf.getBlob !== "function") return;
          try {
            pdf.getBlob((blob) => readBlob(blob, Boolean(filename), true));
          } catch {
            // Let the capture timeout settle portal/pdfMake generation failures.
          }
        };

        if (typeof pdf.download === "function") {
          const originalDownloadOwnDescriptor = Object.getOwnPropertyDescriptor(pdf, "download");
          const captureDownload = function download(filename?: string | null) {
            readPdfBlob(filename);
            return undefined;
          };
          pdf.download = captureDownload;
          const installedDownloadOwnDescriptor = Object.getOwnPropertyDescriptor(pdf, "download");
          actionBoundResponseRestorers.push(() =>
            restorePropertyIfOwned(
              pdf,
              "download",
              originalDownloadOwnDescriptor,
              installedDownloadOwnDescriptor,
            ),
          );
        }
        if (typeof pdf.open === "function") {
          const originalOpenOwnDescriptor = Object.getOwnPropertyDescriptor(pdf, "open");
          const captureOpen = function open() {
            readPdfBlob();
            return undefined;
          };
          pdf.open = captureOpen;
          const installedOpenOwnDescriptor = Object.getOwnPropertyDescriptor(pdf, "open");
          actionBoundResponseRestorers.push(() =>
            restorePropertyIfOwned(
              pdf,
              "open",
              originalOpenOwnDescriptor,
              installedOpenOwnDescriptor,
            ),
          );
        }
        if (typeof pdf.print === "function") {
          const originalPrintOwnDescriptor = Object.getOwnPropertyDescriptor(pdf, "print");
          const capturePrint = function print() {
            readPdfBlob();
            return undefined;
          };
          pdf.print = capturePrint;
          const installedPrintOwnDescriptor = Object.getOwnPropertyDescriptor(pdf, "print");
          actionBoundResponseRestorers.push(() =>
            restorePropertyIfOwned(
              pdf,
              "print",
              originalPrintOwnDescriptor,
              installedPrintOwnDescriptor,
            ),
          );
        }
        return pdf;
      };
    }

    const captureSaveAs = function saveAs(value: unknown, filename?: string | null) {
      const actionBound =
        Boolean(activePortalActionContext()) || (isBlobLike(value) && actionBoundBlobs.has(value));
      if (!actionBound) {
        return typeof originalSaveAs === "function"
          ? originalSaveAs.call(window, value, filename)
          : undefined;
      }
      if (isBlobLike(value)) {
        readBlob(value, Boolean(filename), true);
        return undefined;
      }
      if (typeof value === "string") {
        captureUrl(value, filename, true);
        return undefined;
      }
      return undefined;
    };

    const bindActionBoundFetchResponse = (response: Response): Response => {
      const originalResponseBlob = response.blob;
      if (typeof originalResponseBlob !== "function") return response;
      const readActionBoundBlob = async () => {
        const blob = await originalResponseBlob.call(response);
        if (isBlobLike(blob)) actionBoundBlobs.add(blob);
        return blob;
      };
      try {
        const originalBlobDescriptor = Object.getOwnPropertyDescriptor(response, "blob");
        Object.defineProperty(response, "blob", {
          configurable: true,
          value: readActionBoundBlob,
        });
        const installedBlobDescriptor = Object.getOwnPropertyDescriptor(response, "blob");
        actionBoundResponseRestorers.push(() => {
          restorePropertyIfOwned(response, "blob", originalBlobDescriptor, installedBlobDescriptor);
        });
        return response;
      } catch {
        return new Proxy(response, {
          get(target, property) {
            if (property === "blob") return readActionBoundBlob;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      }
    };

    const captureFetch = function fetch(input: RequestInfo | URL, init?: RequestInit) {
      const actionBound = Boolean(activePortalActionContext());
      return originalFetch.call(window, input, init).then((response) => {
        const contentType = response.headers.get("content-type");
        if (actionBound && contentType && !isArtifactContentType(contentType)) {
          addSafeSignal(`${config.signalPrefix}-fetch-content-type-rejected`);
          return response;
        }
        if (actionBound && contentType && isArtifactContentType(contentType)) {
          addSafeSignal(`${config.signalPrefix}-fetch-artifact-response-observed`);
        }
        return actionBound ? bindActionBoundFetchResponse(response) : response;
      });
    };

    const invalidatePendingAsyncPdfBlobs = (context: XhrPdfActionContext) => {
      for (const [blobUrl, pending] of pendingAsyncPdfBlobsByUrl) {
        if (pending.context !== context) continue;
        pendingAsyncPdfBlobsByUrl.delete(blobUrl);
        invalidatedAsyncBlobUrls.add(blobUrl);
        invalidatedAsyncBlobs.add(pending.blob);
      }
    };
    const invalidateXhrPdfActionContext = (context: XhrPdfActionContext | null) => {
      if (context && closedAsyncBlobBindingLease?.context === context) {
        invalidateClosedAsyncBlobBindingLease(closedAsyncBlobBindingLease);
      }
      if (!context || !context.valid) return;
      context.valid = false;
      invalidatePendingAsyncPdfBlobs(context);
      releaseActionContextsFor(context);
    };
    const closeAsyncBlobBindingSelection = (
      selection: AsyncBlobBindingSelection | null,
      allowClosedTargetLease = false,
    ) => {
      if (!selection || selection.closed) return;
      addSafeSignal(
        selection.context
          ? `${config.signalPrefix}-xhr-selection-closed-with-context`
          : `${config.signalPrefix}-xhr-selection-closed-without-context`,
      );
      selection.closed = true;
      if (asyncBlobBindingSelection === selection) asyncBlobBindingSelection = null;
      if (!allowClosedTargetLease || !armClosedAsyncBlobBindingLease(selection)) {
        invalidateXhrPdfActionContext(selection.context);
      }
    };
    const scheduleAsyncBlobBindingClose = (selection: AsyncBlobBindingSelection) => {
      if (selection.closeScheduled || selection.closed) return;
      selection.closeScheduled = true;
      callOriginalSetTimeout(() => {
        const context = selection.context;
        const reservedTimerDelayMs =
          context?.valid && context.continuation === "reserved"
            ? context.timerContinuationDelayMs
            : null;
        if (reservedTimerDelayMs !== null) {
          callOriginalSetTimeout(
            () => closeAsyncBlobBindingSelection(selection, true),
            reservedTimerDelayMs,
          );
          return;
        }
        closeAsyncBlobBindingSelection(selection, true);
      }, 0);
    };
    const validExplicitMimeType = (contentType: string | null) => {
      const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType) ? mimeType : null;
    };
    const selectedAsyncBlobBindingForEvent = (
      xhr: XMLHttpRequest,
      event: Event,
    ): AsyncBlobBindingSelection | null => {
      const openContext = asyncBlobBindingOpenContexts.get(xhr);
      const selection = asyncBlobBindingSelection;
      if (
        settled ||
        !asyncBlobBindingEnabled ||
        asyncBlobBindingAmbiguous ||
        event.isTrusted !== true ||
        !openContext ||
        !selection ||
        selection.closed ||
        selection.xhr !== xhr ||
        selection.generation !== openContext.generation ||
        xhr.readyState !== 4 ||
        xhr.status < 200 ||
        xhr.status >= 300
      ) {
        return null;
      }
      const mimeType = validExplicitMimeType(xhr.getResponseHeader("content-type"));
      if (!mimeType || isArtifactContentType(mimeType)) return null;
      if (event.type === "readystatechange") {
        if (selection.seenReadyStateDoneEvent && selection.seenReadyStateDoneEvent !== event) {
          return null;
        }
        selection.seenReadyStateDoneEvent = event;
      } else if (event.type === "load") {
        if (selection.seenLoadEvent && selection.seenLoadEvent !== event) return null;
        selection.seenLoadEvent = event;
      } else if (event.type === "loadend") {
        const anchorDownloadRequirement = targetBoundGstr3bAnchorDownloadRequirement();
        if (!anchorDownloadRequirement) return null;
        if (selection.seenLoadEndEvent && selection.seenLoadEndEvent !== event) return null;
        selection.seenLoadEndEvent = event;
        selection.loadEndAnchorDownloadRequirement = anchorDownloadRequirement;
      } else {
        return null;
      }
      addSafeSignal(`${config.signalPrefix}-xhr-content-type-rejected`);
      return selection;
    };
    const isDistinctRepeatedSelectedEvent = (
      selection: AsyncBlobBindingSelection,
      xhr: XMLHttpRequest,
      event: Event,
    ) => {
      if (event.isTrusted !== true || selection.closed || selection.xhr !== xhr) return false;
      if (event.type === "readystatechange") {
        return Boolean(
          xhr.readyState === 4 &&
          selection.seenReadyStateDoneEvent &&
          selection.seenReadyStateDoneEvent !== event,
        );
      }
      if (event.type === "load") {
        return Boolean(selection.seenLoadEvent && selection.seenLoadEvent !== event);
      }
      if (event.type === "loadend") {
        return Boolean(selection.seenLoadEndEvent && selection.seenLoadEndEvent !== event);
      }
      return false;
    };
    const recordSelectedXhrPageCallbackBound = (event: Event) => {
      if (event.type === "readystatechange") {
        addSafeSignal(`${config.signalPrefix}-xhr-page-callback-bound-readystatechange`);
      } else if (event.type === "load") {
        addSafeSignal(`${config.signalPrefix}-xhr-page-callback-bound-load`);
      } else if (event.type === "loadend") {
        addSafeSignal(`${config.signalPrefix}-xhr-page-callback-bound-loadend`);
      }
    };
    const ensureXhrPdfActionContext = (selection: AsyncBlobBindingSelection) => {
      if (!selection.context) {
        selection.context = {
          blobAttempted: false,
          continuation: "available",
          continuationExpiresAt: null,
          generation: selection.generation,
          kind: "xhr-pdf",
          timerContinuationDelayMs: null,
          valid: true,
          xhr: selection.xhr,
        };
      }
      return selection.context;
    };
    const invokeWithDirectContinuationGrant = <T>(
      context: XhrPdfActionContext,
      callback: () => T,
    ): T => {
      const promisePrototype = window.Promise?.prototype;
      const previousThen = promisePrototype?.then;
      const previousQueueMicrotask = window.queueMicrotask;
      const previousThenOwnDescriptor = promisePrototype
        ? Object.getOwnPropertyDescriptor(promisePrototype, "then")
        : undefined;
      const previousQueueMicrotaskOwnDescriptor = Object.getOwnPropertyDescriptor(
        window,
        "queueMicrotask",
      );
      let patchedThen: typeof Promise.prototype.then | null = null;
      let patchedQueueMicrotask: typeof window.queueMicrotask | null = null;
      let installedThenOwnDescriptor: PropertyDescriptor | undefined;
      let installedQueueMicrotaskOwnDescriptor: PropertyDescriptor | undefined;

      const invalidateSecondContinuation = () => invalidateXhrPdfActionContext(context);
      const activeAnchorDownloadRequirement = () =>
        activeActionBinding?.context === context
          ? activeActionBinding.anchorDownloadRequirement
          : null;
      const runReservedContinuation = <TResult>(
        continuation: () => TResult,
        anchorDownloadRequirement: Gstr3bAnchorDownloadRequirement | null,
      ): TResult => {
        const now = Reflect.apply(originalDateNow, Date, []) as number;
        const openSelection = asyncBlobBindingSelection;
        const openGrant =
          openSelection?.context === context &&
          openSelection.xhr === context.xhr &&
          openSelection.generation === context.generation &&
          !openSelection.closed;
        const closedLease = liveClosedAsyncBlobBindingLease();
        const closedGrant = closedLease?.context === context;
        if (
          settled ||
          restored ||
          !context.valid ||
          context.continuation !== "reserved" ||
          context.continuationExpiresAt === null ||
          context.continuationExpiresAt < now ||
          (!openGrant && !closedGrant)
        ) {
          invalidateXhrPdfActionContext(context);
          return continuation();
        }
        context.continuation = "running";
        context.continuationExpiresAt = null;
        if (closedGrant) {
          try {
            return continuation();
          } finally {
            if (context.continuation === "running") context.continuation = "spent";
            const liveLease = liveClosedAsyncBlobBindingLease();
            if (liveLease === closedLease && !liveLease.blobAttempted) {
              invalidateClosedAsyncBlobBindingLease(liveLease);
            }
          }
        }
        const binding = activateActionContext(context, anchorDownloadRequirement);
        try {
          return continuation();
        } finally {
          if (activeActionBinding === binding) activeActionBinding = binding.previous;
          if (context.continuation === "running") context.continuation = "spent";
        }
      };
      const reserveContinuation = <TArgs extends unknown[], TResult>(
        continuation: ((...args: TArgs) => TResult) | null | undefined,
      ): ((...args: TArgs) => TResult) | null | undefined => {
        if (typeof continuation !== "function") return continuation;
        if (context.continuation === "reserved") return continuation;
        if (context.continuation !== "available") {
          invalidateSecondContinuation();
          return continuation;
        }
        const anchorDownloadRequirement = activeAnchorDownloadRequirement();
        context.continuation = "reserved";
        context.continuationExpiresAt =
          (Reflect.apply(originalDateNow, Date, []) as number) + closedAsyncBlobBindingLeaseMs;
        return function reservedContinuation(this: unknown, ...args: TArgs) {
          return runReservedContinuation(
            () => Reflect.apply(continuation, this, args),
            anchorDownloadRequirement,
          );
        };
      };

      if (promisePrototype && typeof previousThen === "function") {
        patchedThen = function then<TResult1 = unknown, TResult2 = never>(
          this: Promise<unknown>,
          onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ): Promise<TResult1 | TResult2> {
          if (!context.valid) {
            return Reflect.apply(previousThen, this, [onfulfilled, onrejected]);
          }
          if (context.continuation === "reserved") {
            return Reflect.apply(previousThen, this, [onfulfilled, onrejected]);
          }
          const hasCallableBranch =
            typeof onfulfilled === "function" || typeof onrejected === "function";
          if (!hasCallableBranch) {
            invalidateSecondContinuation();
            return Reflect.apply(previousThen, this, [onfulfilled, onrejected]);
          }
          if (context.continuation !== "available") {
            invalidateSecondContinuation();
            return Reflect.apply(previousThen, this, [onfulfilled, onrejected]);
          }
          const anchorDownloadRequirement = activeAnchorDownloadRequirement();
          context.continuation = "reserved";
          context.continuationExpiresAt =
            (Reflect.apply(originalDateNow, Date, []) as number) + closedAsyncBlobBindingLeaseMs;
          const wrapPromiseBranch = <TValue, TResult>(
            branch: ((value: TValue) => TResult | PromiseLike<TResult>) | null | undefined,
          ) =>
            typeof branch === "function"
              ? function reservedPromiseBranch(this: unknown, value: TValue) {
                  return runReservedContinuation(
                    () => Reflect.apply(branch, this, [value]),
                    anchorDownloadRequirement,
                  );
                }
              : branch;
          return Reflect.apply(previousThen, this, [
            wrapPromiseBranch(onfulfilled),
            wrapPromiseBranch(onrejected),
          ]);
        } as typeof Promise.prototype.then;
        try {
          promisePrototype.then = patchedThen;
          installedThenOwnDescriptor = Object.getOwnPropertyDescriptor(promisePrototype, "then");
        } catch {
          patchedThen = null;
        }
      }
      if (typeof previousQueueMicrotask === "function") {
        patchedQueueMicrotask = function queueMicrotask(callback: VoidFunction) {
          const reserved = reserveContinuation(callback);
          return previousQueueMicrotask.call(window, reserved ?? callback);
        };
        try {
          window.queueMicrotask = patchedQueueMicrotask;
          installedQueueMicrotaskOwnDescriptor = Object.getOwnPropertyDescriptor(
            window,
            "queueMicrotask",
          );
        } catch {
          patchedQueueMicrotask = null;
        }
      }
      try {
        return callback();
      } finally {
        if (patchedQueueMicrotask) {
          restoreSafely(() => {
            restorePropertyIfOwned(
              window,
              "queueMicrotask",
              previousQueueMicrotaskOwnDescriptor,
              installedQueueMicrotaskOwnDescriptor,
            );
          });
        }
        if (patchedThen && promisePrototype) {
          restoreSafely(() => {
            restorePropertyIfOwned(
              promisePrototype,
              "then",
              previousThenOwnDescriptor,
              installedThenOwnDescriptor,
            );
          });
        }
      }
    };
    const invokePageXhrCallback = <T>(xhr: XMLHttpRequest, event: Event, callback: () => T): T => {
      const selection = selectedAsyncBlobBindingForEvent(xhr, event);
      if (!selection) {
        const currentSelection = asyncBlobBindingSelection;
        if (currentSelection && isDistinctRepeatedSelectedEvent(currentSelection, xhr, event)) {
          closeAsyncBlobBindingSelection(currentSelection);
        }
        const context = activeActionContext();
        if (event.type === "loadend" && context?.kind === "xhr-pdf" && context.xhr === xhr) {
          invalidateXhrPdfActionContext(context);
        }
        return callback();
      }
      const context = ensureXhrPdfActionContext(selection);
      if (!context.valid) return callback();
      recordSelectedXhrPageCallbackBound(event);
      const anchorDownloadRequirement =
        event.type === "loadend"
          ? selection.loadEndAnchorDownloadRequirement
          : targetBoundGstr3bAnchorDownloadRequirement();
      if (anchorDownloadRequirement) {
        selection.anchorDownloadRequirement = anchorDownloadRequirement;
      }
      const binding = activateActionContext(context, anchorDownloadRequirement);
      try {
        return invokeWithDirectContinuationGrant(context, callback);
      } finally {
        if (event.type === "loadend" && anchorDownloadRequirement) {
          releaseActionContextAfterMicrotasks(binding);
        } else if (activeActionBinding === binding) {
          activeActionBinding = binding.previous;
        }
      }
    };
    const invokeXhrPageListener = (record: XhrListenerRecord, event: Event): unknown =>
      invokePageXhrCallback(record.xhr, event, () => {
        if (typeof record.listener === "function") {
          return Reflect.apply(record.listener, record.xhr, [event]);
        }
        return Reflect.apply(record.listener.handleEvent, record.listener, [event]);
      });
    const normaliseListenerCapture = (options?: boolean | EventListenerOptions) =>
      typeof options === "boolean" ? options : Boolean(options?.capture);
    const snapshotXhrListenerOptions = (
      options?: boolean | AddEventListenerOptions,
    ): boolean | AddEventListenerOptions | undefined => {
      if (typeof options !== "object" || !options) return options;
      return {
        capture: Boolean(options.capture),
        once: Boolean(options.once),
        passive: Boolean(options.passive),
        ...(options.signal ? { signal: options.signal } : {}),
      };
    };
    const listenerRecordKey = (type: string, capture: boolean) => `${type}:${capture ? 1 : 0}`;
    const xhrListenerRecordMap = (xhr: XMLHttpRequest, listener: XhrPageListener) => {
      let recordsByListener = xhrListenerRecordsByXhr.get(xhr);
      if (!recordsByListener) {
        recordsByListener = new WeakMap<object, Map<string, XhrListenerRecord>>();
        xhrListenerRecordsByXhr.set(xhr, recordsByListener);
      }
      let records = recordsByListener.get(listener as object);
      if (!records) {
        records = new Map<string, XhrListenerRecord>();
        recordsByListener.set(listener as object, records);
      }
      return records;
    };
    const isWrappableXhrPageListener = (
      listener: EventListenerOrEventListenerObject | null,
    ): listener is XhrPageListener =>
      typeof listener === "function" ||
      Boolean(
        listener && typeof listener === "object" && typeof listener.handleEvent === "function",
      );
    const xhrHasAsyncBlobBindingScope = (xhr: XMLHttpRequest) =>
      Boolean(activePortalActionContext()) ||
      asyncBlobBindingOpenContexts.has(xhr) ||
      asyncBlobBindingSelection?.xhr === xhr;

    const setXhrPropertyHandler = (
      xhr: XMLHttpRequest,
      patch: XhrEventPropertyPatch,
      handler: unknown,
    ) => {
      let states = xhrPropertyHandlerStatesByXhr.get(xhr);
      if (!states) {
        states = new Map<XhrEventProperty, XhrPropertyHandlerState>();
        xhrPropertyHandlerStatesByXhr.set(xhr, states);
      }
      let state = states.get(patch.property);
      if (!state) {
        state = {
          active: true,
          original: null,
          patch,
          property: patch.property,
          wrapped: null,
          xhr,
        };
        states.set(patch.property, state);
        xhrPropertyHandlerStates.add(state);
      }
      state.active = true;
      state.original =
        typeof handler === "function"
          ? (handler as (this: XMLHttpRequest, event: Event) => unknown)
          : null;
      state.wrapped = state.original
        ? function wrappedXhrPropertyHandler(this: XMLHttpRequest, event: Event) {
            return invokePageXhrCallback(xhr, event, () =>
              Reflect.apply(state!.original!, xhr, [event]),
            );
          }
        : null;
      patch.nativeDescriptor.set?.call(xhr, state.wrapped);
    };
    const descriptorInPrototypeChain = (
      target: object,
      property: PropertyKey,
    ): PropertyDescriptor | undefined => {
      let candidate: object | null = target;
      while (candidate) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, property);
        if (descriptor) return descriptor;
        candidate = Object.getPrototypeOf(candidate) as object | null;
      }
      return undefined;
    };
    const installXhrPropertyPatch = (property: XhrEventProperty) => {
      const ownDescriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, property);
      const nativeDescriptor = descriptorInPrototypeChain(XMLHttpRequest.prototype, property);
      if (
        !nativeDescriptor?.get ||
        !nativeDescriptor.set ||
        (ownDescriptor && ownDescriptor.configurable === false)
      ) {
        throw new Error("xhr-event-property-unavailable");
      }
      const patch: XhrEventPropertyPatch = {
        installedDescriptor: {},
        nativeDescriptor,
        ownDescriptor,
        property,
      };
      const installedDescriptor: PropertyDescriptor = {
        configurable: true,
        enumerable: nativeDescriptor.enumerable ?? true,
        get(this: XMLHttpRequest) {
          const state = xhrPropertyHandlerStatesByXhr.get(this)?.get(property);
          return state ? state.original : (nativeDescriptor.get?.call(this) ?? null);
        },
        set(this: XMLHttpRequest, handler: unknown) {
          if (!xhrHasAsyncBlobBindingScope(this)) {
            nativeDescriptor.set?.call(this, handler);
            return;
          }
          setXhrPropertyHandler(this, patch, handler);
        },
      };
      patch.installedDescriptor = installedDescriptor;
      Object.defineProperty(XMLHttpRequest.prototype, property, installedDescriptor);
      xhrEventPropertyPatches.set(property, patch);
    };
    const xhrEventPropertyPatchIsInstalled = (patch: XhrEventPropertyPatch) => {
      const currentDescriptor = Object.getOwnPropertyDescriptor(
        XMLHttpRequest.prototype,
        patch.property,
      );
      return propertyDescriptorMatches(currentDescriptor, patch.installedDescriptor);
    };
    const restoreXhrEventPropertyPatch = (patch: XhrEventPropertyPatch) => {
      if (!xhrEventPropertyPatchIsInstalled(patch)) return;
      if (patch.ownDescriptor) {
        Object.defineProperty(XMLHttpRequest.prototype, patch.property, patch.ownDescriptor);
      } else {
        delete (XMLHttpRequest.prototype as unknown as Record<string, unknown>)[patch.property];
      }
    };
    const adoptExistingXhrPropertyHandlers = (xhr: XMLHttpRequest) => {
      for (const patch of xhrEventPropertyPatches.values()) {
        if (xhrPropertyHandlerStatesByXhr.get(xhr)?.has(patch.property)) continue;
        const handler = patch.nativeDescriptor.get?.call(xhr);
        if (typeof handler === "function") setXhrPropertyHandler(xhr, patch, handler);
      }
    };

    const interposedXhrAddEventListener = function addEventListener(
      this: XMLHttpRequest,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (
        (type !== "load" && type !== "loadend" && type !== "readystatechange") ||
        !isWrappableXhrPageListener(listener)
      ) {
        return callOriginalXhrAddEventListener(this, type, listener!, options);
      }
      const actionScoped = xhrHasAsyncBlobBindingScope(this);
      const knownRecords = xhrListenerRecordsByXhr.get(this)?.get(listener as object);
      if (!actionScoped && !knownRecords) {
        return callOriginalXhrAddEventListener(this, type, listener, options);
      }
      const registrationOptions = actionScoped ? snapshotXhrListenerOptions(options) : options;
      const capture = normaliseListenerCapture(registrationOptions);
      const key = listenerRecordKey(type, capture);
      const existing = knownRecords?.get(key);
      if (!actionScoped && existing) {
        restoreSafely(() => restoreXhrListenerRecord(existing));
        existing.active = true;
        return callOriginalXhrAddEventListener(this, type, listener, options);
      }
      if (!actionScoped && !existing?.active) {
        return callOriginalXhrAddEventListener(this, type, listener, options);
      }
      if (existing?.active && existing.interposed) {
        return callOriginalXhrAddEventListener(this, type, existing.wrapped, options);
      }
      const records = xhrListenerRecordMap(this, listener);
      const record = {} as XhrListenerRecord;
      const wrapped: EventListener = (event) => {
        if (!record.active) return undefined;
        if (record.once) record.active = false;
        return invokeXhrPageListener(record, event);
      };
      Object.assign(record, {
        abortCleanup: null,
        active: !(typeof registrationOptions === "object" && registrationOptions.signal?.aborted),
        capture,
        interposed: true,
        listener,
        once: typeof registrationOptions === "object" && Boolean(registrationOptions.once),
        options: registrationOptions,
        type,
        wrapped,
        xhr: this,
      });
      const signal =
        typeof registrationOptions === "object" ? registrationOptions.signal : undefined;
      if (signal) {
        const markAborted = () => {
          record.active = false;
        };
        signal.addEventListener("abort", markAborted, { once: true });
        record.abortCleanup = () => signal.removeEventListener("abort", markAborted);
      }
      records.set(key, record);
      xhrListenerRecords.add(record);
      return callOriginalXhrAddEventListener(this, type, wrapped, registrationOptions);
    } as typeof XMLHttpRequest.prototype.addEventListener;
    const interposedXhrRemoveEventListener = function removeEventListener(
      this: XMLHttpRequest,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (
        (type !== "load" && type !== "loadend" && type !== "readystatechange") ||
        !isWrappableXhrPageListener(listener)
      ) {
        return callOriginalXhrRemoveEventListener(this, type, listener!, options);
      }
      const records = xhrListenerRecordsByXhr.get(this)?.get(listener as object);
      const record = records?.get(listenerRecordKey(type, normaliseListenerCapture(options)));
      if (record && !record.interposed) {
        record.active = false;
        return callOriginalXhrRemoveEventListener(this, type, listener, options);
      }
      if (!record?.active) {
        return callOriginalXhrRemoveEventListener(this, type, listener, options);
      }
      record.active = false;
      restoreSafely(() => record.abortCleanup?.());
      return callOriginalXhrRemoveEventListener(this, type, record.wrapped, options);
    } as typeof XMLHttpRequest.prototype.removeEventListener;
    const installAsyncBlobBindingXhrHandlers = (xhr: XMLHttpRequest) => {
      if (!asyncBlobBindingEnabled || asyncBlobBindingXhrHandlers.has(xhr)) return;
      asyncBlobBindingXhrHandlers.add(xhr);
      const closeOnFailure = (event: Event) => {
        if (event.isTrusted !== true) return;
        const selection = asyncBlobBindingSelection;
        const closedLease = liveClosedAsyncBlobBindingLease();
        if (!selection && closedLease?.xhr === xhr) {
          invalidateClosedAsyncBlobBindingLease(closedLease);
          return;
        }
        if (
          event.type === "loadend" &&
          xhr.readyState === 4 &&
          xhr.status >= 200 &&
          xhr.status < 300
        ) {
          if (selection?.xhr === xhr) scheduleAsyncBlobBindingClose(selection);
          return;
        }
        if (selection?.xhr === xhr) closeAsyncBlobBindingSelection(selection);
      };
      const scheduleCloseAfterTerminalSuccess = (event: Event) => {
        if (event.isTrusted !== true || xhr.readyState !== 4) return;
        const selection = asyncBlobBindingSelection;
        const closedLease = liveClosedAsyncBlobBindingLease();
        if (!selection && closedLease?.xhr === xhr) {
          invalidateClosedAsyncBlobBindingLease(closedLease);
          return;
        }
        if (selection?.xhr === xhr) scheduleAsyncBlobBindingClose(selection);
      };
      callOriginalXhrAddEventListener(xhr, "readystatechange", scheduleCloseAfterTerminalSuccess, {
        capture: true,
      });
      callOriginalXhrAddEventListener(xhr, "load", scheduleCloseAfterTerminalSuccess, {
        capture: true,
      });
      for (const eventType of ["abort", "error", "timeout", "loadend"] as const) {
        callOriginalXhrAddEventListener(xhr, eventType, closeOnFailure, { capture: true });
      }
      actionBoundResponseRestorers.push(() => {
        callOriginalXhrRemoveEventListener(
          xhr,
          "readystatechange",
          scheduleCloseAfterTerminalSuccess,
          { capture: true },
        );
        callOriginalXhrRemoveEventListener(xhr, "load", scheduleCloseAfterTerminalSuccess, {
          capture: true,
        });
        for (const eventType of ["abort", "error", "timeout", "loadend"] as const) {
          callOriginalXhrRemoveEventListener(xhr, eventType, closeOnFailure, { capture: true });
        }
      });
    };

    const interposedXhrOpen = function open(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      user?: string | null,
      pass?: string | null,
    ) {
      invalidateClosedAsyncBlobBindingLease();
      const declaredAsync = arguments.length <= 2 || async !== false;
      const portalActionContext = activePortalActionContext();
      if (!portalActionContext) {
        restoreXhrListenerRecordsFor(this);
        restoreXhrPropertyHandlerStatesFor(this);
      }
      actionBoundXhrs.delete(this);
      asyncBlobBindingOpenContexts.delete(this);
      if (asyncBlobBindingSelection?.xhr === this) {
        closeAsyncBlobBindingSelection(asyncBlobBindingSelection);
      }
      if (portalActionContext) {
        actionBoundXhrs.add(this);
        if (asyncBlobBindingEnabled && declaredAsync) {
          adoptExistingXhrPropertyHandlers(this);
          asyncBlobBindingGeneration += 1;
          asyncBlobBindingOpenContexts.set(this, {
            context: portalActionContext,
            generation: asyncBlobBindingGeneration,
          });
          installAsyncBlobBindingXhrHandlers(this);
        }
      }
      if (actionBoundXhrs.has(this) && !actionBoundXhrHandlers.has(this)) {
        actionBoundXhrHandlers.add(this);
        const observeActionBoundXhrLoad = () => {
          if (settled || !actionBoundXhrs.has(this)) return;
          const contentType = this.getResponseHeader("content-type");
          if (!contentType || !isArtifactContentType(contentType)) {
            addSafeSignal(`${config.signalPrefix}-xhr-content-type-rejected`);
            return;
          }
          if (isBlobLike(this.response)) actionBoundBlobs.add(this.response);
          addSafeSignal(`${config.signalPrefix}-xhr-artifact-response-observed`);
        };
        callOriginalXhrAddEventListener(this, "load", observeActionBoundXhrLoad, {
          capture: true,
        });
        actionBoundResponseRestorers.push(() => {
          callOriginalXhrRemoveEventListener(this, "load", observeActionBoundXhrLoad, {
            capture: true,
          });
        });
      }
      if (arguments.length <= 2) {
        const openWithoutAsync = originalXhrOpen as (
          this: XMLHttpRequest,
          method: string,
          url: string | URL,
        ) => void;
        return openWithoutAsync.call(this, method, url);
      }
      const openWithAsync = originalXhrOpen as (
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        async: boolean,
        user?: string | null,
        pass?: string | null,
      ) => void;
      return openWithAsync.call(this, method, url, async ?? true, user, pass);
    };
    const registerAsyncBlobBindingSend = (
      xhr: XMLHttpRequest,
      openContext: AsyncBlobBindingOpenContext | undefined,
    ) => {
      if (!openContext || activePortalActionContext() !== openContext.context) return;
      asyncBlobBindingQualifiedSendCount += 1;
      if (asyncBlobBindingQualifiedSendCount > 1) {
        asyncBlobBindingAmbiguous = true;
        closeAsyncBlobBindingSelection(asyncBlobBindingSelection);
        addSafeSignal(`${config.signalPrefix}-xhr-action-binding-ambiguous`);
        return;
      }
      asyncBlobBindingSelection = {
        anchorDownloadRequirement: null,
        closeScheduled: false,
        closed: false,
        context: null,
        generation: openContext.generation,
        seenLoadEvent: null,
        seenLoadEndEvent: null,
        seenReadyStateDoneEvent: null,
        loadEndAnchorDownloadRequirement: null,
        xhr,
      };
    };
    const interposedXhrSend = function send(
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      invalidateClosedAsyncBlobBindingLease();
      registerAsyncBlobBindingSend(this, asyncBlobBindingOpenContexts.get(this));
      return originalXhrSend.call(this, body);
    };
    const captureCreateObjectUrl = function createObjectURL(value: Blob | MediaSource) {
      const blobUrl = originalCreateObjectUrl.call(urlApi, value);
      const context = activeActionContext();
      if (isBlobLike(value) && context?.kind === "xhr-pdf") {
        const selection = asyncBlobBindingSelection;
        const liveExactGrant =
          context.valid &&
          !context.blobAttempted &&
          selection?.context === context &&
          selection.xhr === context.xhr &&
          selection.generation === context.generation &&
          !selection.closed &&
          !asyncBlobBindingAmbiguous;
        context.blobAttempted = true;
        const exactPdf =
          liveExactGrant &&
          value.size > 0 &&
          value.size <= config.maxBytes &&
          value.type.split(";", 1)[0]?.trim().toLowerCase() === "application/pdf";
        if (exactPdf) {
          addSafeSignal(`${config.signalPrefix}-create-object-url-observed`);
          pendingAsyncPdfBlobsByUrl.set(blobUrl, {
            anchorDownloadRequirement:
              activeActionBinding?.context === context
                ? activeActionBinding.anchorDownloadRequirement
                : null,
            blob: value,
            context,
            generation: context.generation,
          });
        } else {
          invalidatedAsyncBlobUrls.add(blobUrl);
          invalidatedAsyncBlobs.add(value);
          addSafeSignal(`${config.signalPrefix}-unbound-create-object-url-ignored`);
          invalidateXhrPdfActionContext(context);
        }
        return blobUrl;
      }
      const closedLease = liveClosedAsyncBlobBindingLease();
      if (closedLease) {
        if (
          closedLease.requiresReservedContinuation &&
          closedLease.context.continuation !== "running"
        ) {
          addSafeSignal(`${config.signalPrefix}-unbound-create-object-url-ignored`);
          invalidateClosedAsyncBlobBindingLease(closedLease);
          return blobUrl;
        }
        if (closedLease.blobAttempted) {
          addSafeSignal(`${config.signalPrefix}-unbound-create-object-url-ignored`);
          invalidateClosedAsyncBlobBindingLease(closedLease);
          return blobUrl;
        }
        closedLease.blobAttempted = true;
        closedLease.context.blobAttempted = true;
        const exactPdf =
          isBlobLike(value) &&
          value.size > 0 &&
          value.size <= config.maxBytes &&
          value.type.split(";", 1)[0]?.trim().toLowerCase() === "application/pdf";
        if (exactPdf) {
          addSafeSignal(`${config.signalPrefix}-create-object-url-observed`);
          pendingClosedAsyncPdfBlobsByUrl.set(blobUrl, { blob: value, lease: closedLease });
        } else {
          addSafeSignal(
            isBlobLike(value) && value.size > config.maxBytes
              ? `${config.signalPrefix}-create-object-url-oversized`
              : isBlobLike(value) && value.size === 0
                ? `${config.signalPrefix}-create-object-url-zero-byte`
                : `${config.signalPrefix}-unbound-create-object-url-ignored`,
          );
          invalidateClosedAsyncBlobBindingLease(closedLease);
        }
        return blobUrl;
      }
      const actionBound =
        isBlobLike(value) &&
        !invalidatedAsyncBlobs.has(value) &&
        (context?.kind === "portal-action" || actionBoundBlobs.has(value));
      if (actionBound && value.size > 0 && value.size <= config.maxBytes) {
        addSafeSignal(`${config.signalPrefix}-create-object-url-observed`);
        actionBoundBlobs.add(value);
        capturedBlobUrls.add(blobUrl);
        capturedBlobsByUrl.set(blobUrl, value);
      } else if (actionBound) {
        addSafeSignal(
          value.size > config.maxBytes
            ? `${config.signalPrefix}-create-object-url-oversized`
            : `${config.signalPrefix}-create-object-url-zero-byte`,
        );
      } else if (isBlobLike(value)) {
        addSafeSignal(`${config.signalPrefix}-unbound-create-object-url-ignored`);
        const selection = asyncBlobBindingSelection;
        if (!selection || selection.closed) {
          addSafeSignal(`${config.signalPrefix}-unbound-create-object-url-no-open-selection`);
        } else if (!selection.context) {
          addSafeSignal(
            `${config.signalPrefix}-unbound-create-object-url-selection-open-no-context`,
          );
        } else if (!selection.context.valid) {
          addSafeSignal(
            `${config.signalPrefix}-unbound-create-object-url-selection-open-invalid-context`,
          );
        } else {
          addSafeSignal(
            `${config.signalPrefix}-unbound-create-object-url-selection-open-valid-inactive-context`,
          );
        }
      }
      return blobUrl;
    };

    const captureRevokeObjectUrl = function revokeObjectURL(blobUrl: string) {
      const closedPending = pendingClosedAsyncPdfBlobsByUrl.get(blobUrl);
      if (closedPending) {
        pendingClosedAsyncPdfBlobsByUrl.delete(blobUrl);
        invalidateClosedAsyncBlobBindingLease(closedPending.lease);
      }
      const pending = pendingAsyncPdfBlobsByUrl.get(blobUrl);
      if (pending) {
        pendingAsyncPdfBlobsByUrl.delete(blobUrl);
        invalidatedAsyncBlobUrls.add(blobUrl);
        invalidatedAsyncBlobs.add(pending.blob);
      }
      capturedBlobUrls.delete(blobUrl);
      capturedBlobsByUrl.delete(blobUrl);
      return originalRevokeObjectUrl?.call(urlApi, blobUrl);
    };

    const shouldSuppressAnchor = (anchor: HTMLAnchorElement) => captureAnchorDownload(anchor);
    const dispatchSuppressedAnchorClick = (anchor: HTMLAnchorElement, event?: Event) => {
      const MouseEventConstructor = anchor.ownerDocument.defaultView?.MouseEvent;
      const clickEvent =
        event ??
        (MouseEventConstructor
          ? new MouseEventConstructor("click", {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: anchor.ownerDocument.defaultView,
            })
          : new Event("click", { bubbles: true, cancelable: true, composed: true }));
      if (!clickEvent.cancelable || clickEvent.cancelBubble) return false;
      const originalPreventDefault = clickEvent.preventDefault;
      let pagePreventedDefault = clickEvent.defaultPrevented;
      let terminalSuppressionReached = false;

      const propagationTargets: EventTarget[] = [];
      let pathNode: Node | null = anchor;
      while (pathNode) {
        propagationTargets.push(pathNode);
        const assignedSlot: HTMLSlotElement | null =
          pathNode.nodeType === 1 ? (pathNode as Element).assignedSlot : null;
        if (assignedSlot) {
          pathNode = assignedSlot;
          continue;
        }
        if (pathNode.parentNode) {
          pathNode = pathNode.parentNode;
          continue;
        }
        const shadowHost: Node | null =
          clickEvent.composed && pathNode.nodeType === 11
            ? ((pathNode as ShadowRoot).host ?? null)
            : null;
        pathNode = shadowHost;
      }
      if (propagationTargets.at(-1) === anchor.ownerDocument && anchor.ownerDocument.defaultView) {
        propagationTargets.push(anchor.ownerDocument.defaultView);
      }
      const terminalSuppressionTarget = clickEvent.bubbles
        ? (propagationTargets.at(-1) ?? anchor)
        : anchor;
      type OnclickInterposition = {
        isIntact: () => boolean;
        restore: () => void;
      };
      const installOnclickInterposition = (
        eventTarget: EventTarget,
      ): OnclickInterposition | null | undefined => {
        const target = eventTarget as EventTarget & {
          onclick: ((this: EventTarget, event: MouseEvent) => unknown) | null;
        };
        const originalOwnDescriptor = Object.getOwnPropertyDescriptor(target, "onclick");
        const nativeDescriptor = descriptorInPrototypeChain(target, "onclick");
        if (!nativeDescriptor) return undefined;
        if (
          !nativeDescriptor.get ||
          !nativeDescriptor.set ||
          (originalOwnDescriptor && originalOwnDescriptor.configurable === false)
        ) {
          return null;
        }

        let pageHandler: ((this: EventTarget, event: MouseEvent) => unknown) | null = null;
        let pageHandlerEligibleForCurrentEvent = false;
        const stableHandler = function stableOnclickHandler(this: EventTarget, event: MouseEvent) {
          if (!pageHandler || !pageHandlerEligibleForCurrentEvent) return null;
          const result = Reflect.apply(pageHandler, this, [event]);
          if (result === false) pagePreventedDefault = true;
          return result;
        };
        const installedDescriptor: PropertyDescriptor = {
          configurable: true,
          enumerable: nativeDescriptor.enumerable ?? true,
          get() {
            return pageHandler;
          },
          set(value: unknown) {
            const nextHandler =
              typeof value === "function"
                ? (value as (this: EventTarget, event: MouseEvent) => unknown)
                : null;
            if (!nextHandler) {
              pageHandler = null;
              pageHandlerEligibleForCurrentEvent = false;
              return;
            }
            if (!pageHandler) {
              pageHandlerEligibleForCurrentEvent = !(
                clickEvent.currentTarget === target && clickEvent.eventPhase !== 1
              );
            }
            pageHandler = nextHandler;
          },
        };
        try {
          const currentHandler = nativeDescriptor.get.call(target);
          pageHandler =
            typeof currentHandler === "function"
              ? (currentHandler as (this: EventTarget, event: MouseEvent) => unknown)
              : null;
          pageHandlerEligibleForCurrentEvent = Boolean(pageHandler);
          nativeDescriptor.set.call(target, stableHandler);
          Object.defineProperty(target, "onclick", installedDescriptor);
        } catch {
          restoreSafely(() => {
            if (nativeDescriptor.get?.call(target) === stableHandler) {
              nativeDescriptor.set?.call(target, pageHandler);
            }
          });
          return null;
        }

        return {
          isIntact() {
            try {
              return nativeDescriptor.get?.call(target) === stableHandler;
            } catch {
              return false;
            }
          },
          restore() {
            restoreSafely(() => {
              const currentNativeHandler = nativeDescriptor.get?.call(target);
              if (currentNativeHandler === stableHandler) {
                nativeDescriptor.set?.call(target, pageHandler);
              }
            });
            restoreSafely(() => {
              const currentOwnDescriptor = Object.getOwnPropertyDescriptor(target, "onclick");
              const packStillOwnsProperty = propertyDescriptorMatches(
                currentOwnDescriptor,
                installedDescriptor,
              );
              if (!packStillOwnsProperty) return;
              if (originalOwnDescriptor) {
                Object.defineProperty(target, "onclick", originalOwnDescriptor);
              } else {
                delete (target as unknown as Record<PropertyKey, unknown>).onclick;
              }
            });
          },
        };
      };

      const originalReturnValueOwnDescriptor = Object.getOwnPropertyDescriptor(
        clickEvent,
        "returnValue",
      );
      const nativeReturnValueDescriptor = descriptorInPrototypeChain(
        Object.getPrototypeOf(clickEvent) as object,
        "returnValue",
      );
      const originalDefaultPreventedOwnDescriptor = Object.getOwnPropertyDescriptor(
        clickEvent,
        "defaultPrevented",
      );
      const nativeDefaultPreventedDescriptor = descriptorInPrototypeChain(
        Object.getPrototypeOf(clickEvent) as object,
        "defaultPrevented",
      );
      const originalPreventDefaultOwnDescriptor = Object.getOwnPropertyDescriptor(
        clickEvent,
        "preventDefault",
      );
      const installedPreventDefault = function preventDefault(this: Event) {
        pagePreventedDefault = true;
        return originalPreventDefault.call(this);
      };
      const installedReturnValueDescriptor: PropertyDescriptor | null =
        nativeReturnValueDescriptor?.get && nativeReturnValueDescriptor.set
          ? {
              configurable: true,
              enumerable: nativeReturnValueDescriptor.enumerable ?? true,
              get() {
                return !pagePreventedDefault;
              },
              set(this: Event, value: boolean) {
                if (value === false) pagePreventedDefault = true;
                nativeReturnValueDescriptor.set?.call(this, value);
              },
            }
          : null;
      const installedDefaultPreventedDescriptor: PropertyDescriptor | null =
        nativeDefaultPreventedDescriptor?.get
          ? {
              configurable: true,
              enumerable: nativeDefaultPreventedDescriptor.enumerable ?? true,
              get() {
                return pagePreventedDefault;
              },
            }
          : null;
      const installedEventMethodDescriptors = new Map<PropertyKey, PropertyDescriptor>([
        [
          "preventDefault",
          {
            configurable: true,
            enumerable: originalPreventDefaultOwnDescriptor?.enumerable ?? false,
            value: installedPreventDefault,
            writable: true,
          },
        ],
      ]);
      if (installedReturnValueDescriptor) {
        installedEventMethodDescriptors.set("returnValue", installedReturnValueDescriptor);
      }
      if (installedDefaultPreventedDescriptor) {
        installedEventMethodDescriptors.set(
          "defaultPrevented",
          installedDefaultPreventedDescriptor,
        );
      }
      const originalEventOwnDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>([
        ["preventDefault", originalPreventDefaultOwnDescriptor],
        ["returnValue", originalReturnValueOwnDescriptor],
        ["defaultPrevented", originalDefaultPreventedOwnDescriptor],
      ]);
      const restoreInstalledEventProperties = () => {
        for (const [property, installedDescriptor] of installedEventMethodDescriptors) {
          restoreSafely(() => {
            const currentDescriptor = Object.getOwnPropertyDescriptor(clickEvent, property);
            const packStillOwnsProperty = propertyDescriptorMatches(
              currentDescriptor,
              installedDescriptor,
            );
            if (!packStillOwnsProperty) return;
            const originalOwnDescriptor = originalEventOwnDescriptors.get(property);
            if (originalOwnDescriptor) {
              Object.defineProperty(clickEvent, property, originalOwnDescriptor);
            } else {
              delete (clickEvent as unknown as Record<PropertyKey, unknown>)[property];
            }
          });
        }
      };
      if (!installedReturnValueDescriptor || !installedDefaultPreventedDescriptor) return false;
      try {
        for (const [property, descriptor] of installedEventMethodDescriptors) {
          Object.defineProperty(clickEvent, property, descriptor);
        }
      } catch {
        restoreInstalledEventProperties();
        return false;
      }

      const onclickInterpositions: OnclickInterposition[] = [];
      const onclickTargets = clickEvent.bubbles ? propagationTargets : [anchor];
      let onclickInterpositionFailed = false;
      for (const target of onclickTargets) {
        const interposition = installOnclickInterposition(target);
        if (interposition === null) {
          onclickInterpositionFailed = true;
          break;
        }
        if (interposition) onclickInterpositions.push(interposition);
      }
      if (onclickInterpositionFailed) {
        for (const interposition of onclickInterpositions.reverse()) interposition.restore();
        restoreInstalledEventProperties();
        return false;
      }

      type SuppressionListenerRegistration = {
        capture: boolean;
        listener: EventListener;
        target: EventTarget;
      };
      const suppressionListenerRegistrations: SuppressionListenerRegistration[] = [];
      const addSuppressionListener = (
        target: EventTarget,
        listener: EventListener,
        capture: boolean,
      ) => {
        target.addEventListener("click", listener, { capture, once: true });
        suppressionListenerRegistrations.push({ capture, listener, target });
      };
      const terminalSuppressionListener: EventListener = () => {
        terminalSuppressionReached = true;
      };
      try {
        addSuppressionListener(terminalSuppressionTarget, terminalSuppressionListener, false);
        originalPreventDefault.call(clickEvent);
        originalDispatchEvent.call(anchor, clickEvent);
        return (
          terminalSuppressionReached &&
          !pagePreventedDefault &&
          onclickInterpositions.every((interposition) => interposition.isIntact())
        );
      } finally {
        for (const { capture, listener, target } of suppressionListenerRegistrations.reverse()) {
          restoreSafely(() => target.removeEventListener("click", listener, { capture }));
        }
        for (const interposition of onclickInterpositions.reverse()) interposition.restore();
        restoreInstalledEventProperties();
      }
    };
    const dispatchPendingAsyncPdfAnchorClick = (
      anchor: HTMLAnchorElement,
      event?: Event,
    ): { dispatchResult: boolean } | null => {
      const openPendingSink = activePendingAsyncPdfSink(anchor);
      const closedPendingSink = openPendingSink ? null : activePendingClosedAsyncPdfSink(anchor);
      const pendingSink = openPendingSink ?? closedPendingSink;
      if (!pendingSink) return null;
      const invalidatePendingSink = () => {
        if (closedPendingSink) {
          invalidateClosedAsyncBlobBindingLease(closedPendingSink.pending.lease);
        } else if (openPendingSink) {
          invalidateXhrPdfActionContext(openPendingSink.pending.context);
        }
      };
      if (event && (!event.cancelable || event.cancelBubble)) {
        invalidatePendingSink();
        return { dispatchResult: false };
      }
      if (pendingAsyncPdfAnchorDispatches.has(anchor)) return { dispatchResult: false };
      pendingAsyncPdfAnchorDispatches.add(anchor);
      try {
        let dispatchResult: boolean;
        try {
          dispatchResult = dispatchSuppressedAnchorClick(anchor, event);
        } catch (error) {
          invalidatePendingSink();
          throw error;
        }
        let captured = false;
        if (
          dispatchResult &&
          anchor.hasAttribute("download") &&
          anchor.href === pendingSink.blobUrl
        ) {
          captured = captureAnchorDownload(anchor);
        }
        if (closedPendingSink && !captured) invalidatePendingSink();
        return { dispatchResult };
      } finally {
        pendingAsyncPdfAnchorDispatches.delete(anchor);
      }
    };
    const captureAnchorClick = function click(this: HTMLAnchorElement) {
      const pendingDispatch = dispatchPendingAsyncPdfAnchorClick(this);
      if (pendingDispatch) return undefined;
      const filenameBinding = bindInvalidatedAsyncBlobDownloadAnchor(this);
      // GSTR-3B's verified final blob anchor is the delivery path.  Do not
      // suppress it merely to attempt byte capture: if capture cannot produce
      // a transient file, suppressing this click strands the target with no
      // browser download to observe.  The short-lived filename binding makes
      // the portal-created browser download correlate to this exact action.
      if (!filenameBinding && shouldSuppressAnchor(this)) {
        dispatchSuppressedAnchorClick(this);
        return undefined;
      }
      const delegatedAt = filenameBinding ? new Date().toISOString() : null;
      let result: void;
      let nativeClickReturned = false;
      try {
        result = originalClick.call(this);
        nativeClickReturned = true;
      } finally {
        if (filenameBinding) {
          if (nativeClickReturned) {
            scheduleTargetBoundNativeFilenameRestore(this, filenameBinding);
          } else {
            restoreTargetBoundNativeFilenameIfOwned(this, filenameBinding);
          }
        }
      }
      if (filenameBinding) {
        targetBoundNativeDelegatedAt = delegatedAt;
        addSafeSignal(`${config.signalPrefix}-target-bound-native-blob-click-delegated`);
        settle(null);
      }
      return result;
    };
    const captureAnchorDispatchEvent = function dispatchEvent(
      this: HTMLAnchorElement,
      event: Event,
    ) {
      if (event.type === "click") {
        const pendingDispatch = dispatchPendingAsyncPdfAnchorClick(this, event);
        if (pendingDispatch) return pendingDispatch.dispatchResult;
      }
      const filenameBinding =
        event.type === "click" ? bindInvalidatedAsyncBlobDownloadAnchor(this) : null;
      if (event.type === "click" && !filenameBinding && shouldSuppressAnchor(this)) {
        return dispatchSuppressedAnchorClick(this, event);
      }
      const delegatedAt = filenameBinding ? new Date().toISOString() : null;
      let dispatchResult = false;
      let nativeDispatchReturned = false;
      try {
        dispatchResult = originalDispatchEvent.call(this, event);
        nativeDispatchReturned = true;
      } finally {
        if (filenameBinding) {
          if (nativeDispatchReturned && dispatchResult) {
            scheduleTargetBoundNativeFilenameRestore(this, filenameBinding);
          } else {
            restoreTargetBoundNativeFilenameIfOwned(this, filenameBinding);
          }
        }
      }
      if (filenameBinding && dispatchResult) {
        targetBoundNativeDelegatedAt = delegatedAt;
        addSafeSignal(`${config.signalPrefix}-target-bound-native-blob-click-delegated`);
        settle(null);
      }
      return dispatchResult;
    };

    function scheduleTargetBoundNativeFilenameRestore(
      anchor: HTMLAnchorElement,
      binding: TargetBoundNativeFilenameBinding,
    ): void {
      try {
        callOriginalSetTimeout(
          () => restoreTargetBoundNativeFilenameIfOwned(anchor, binding),
          targetBoundNativeFilenameHandoffMs,
        );
      } catch {
        restoreTargetBoundNativeFilenameIfOwned(anchor, binding);
      }
    }

    function activeTargetBoundNativeFilenameBinding(
      anchor: HTMLAnchorElement,
    ): TargetBoundNativeFilenameBinding | null {
      const descriptor = Object.getOwnPropertyDescriptor(
        anchor,
        targetBoundNativeFilenameBindingKey,
      );
      const candidate = descriptor && "value" in descriptor ? descriptor.value : null;
      return candidate &&
        typeof candidate === "object" &&
        Number.isSafeInteger(candidate.generation) &&
        candidate.generation > 0 &&
        candidate.generation < Number.MAX_SAFE_INTEGER &&
        typeof candidate.installedDownload === "string" &&
        typeof candidate.rootOriginalDownload === "string"
        ? (candidate as TargetBoundNativeFilenameBinding)
        : null;
    }

    function restoreTargetBoundNativeFilenameIfOwned(
      anchor: HTMLAnchorElement,
      binding: TargetBoundNativeFilenameBinding,
    ): void {
      if (activeTargetBoundNativeFilenameBinding(anchor) !== binding) return;
      restoreSafely(() => {
        if (anchor.download === binding.installedDownload) {
          anchor.download = binding.rootOriginalDownload;
        }
      });
      restoreSafely(() => {
        if (activeTargetBoundNativeFilenameBinding(anchor) === binding) {
          delete (anchor as unknown as Record<symbol, unknown>)[
            targetBoundNativeFilenameBindingKey
          ];
        }
      });
    }

    function bindInvalidatedAsyncBlobDownloadAnchor(
      anchor: HTMLAnchorElement,
    ): TargetBoundNativeFilenameBinding | null {
      if (
        config.targetBinding.returnType !== "GSTR-3B" ||
        config.targetBinding.artifactType !== "PDF" ||
        !anchor.hasAttribute("download") ||
        !anchor.href.startsWith("blob:")
      ) {
        return null;
      }
      const filename = targetBoundNativeGstr3bFilename();
      if (!filename) return null;
      const existingDescriptor = Object.getOwnPropertyDescriptor(
        anchor,
        targetBoundNativeFilenameBindingKey,
      );
      const previousBinding = activeTargetBoundNativeFilenameBinding(anchor);
      if (existingDescriptor && !previousBinding) return null;
      const currentDownload = anchor.download;
      const rootPortalDownload =
        previousBinding && currentDownload === previousBinding.installedDownload
          ? previousBinding.rootOriginalDownload
          : currentDownload;
      const requirement = targetBoundGstr3bAnchorDownloadRequirement();
      if (
        !requirement ||
        !matchesTargetBoundGstr3bAnchorDownload(rootPortalDownload, requirement)
      ) {
        return null;
      }
      const binding: TargetBoundNativeFilenameBinding = {
        generation: (previousBinding?.generation ?? 0) + 1,
        installedDownload: filename,
        rootOriginalDownload: rootPortalDownload,
      };
      const restorePreviousBindingSlot = () => {
        restoreSafely(() => {
          if (activeTargetBoundNativeFilenameBinding(anchor) !== binding) return;
          if (previousBinding) {
            Object.defineProperty(anchor, targetBoundNativeFilenameBindingKey, {
              configurable: true,
              value: previousBinding,
            });
          } else {
            delete (anchor as unknown as Record<symbol, unknown>)[
              targetBoundNativeFilenameBindingKey
            ];
          }
        });
      };
      try {
        Object.defineProperty(anchor, targetBoundNativeFilenameBindingKey, {
          configurable: true,
          value: binding,
        });
        anchor.download = filename;
      } catch (error) {
        restorePreviousBindingSlot();
        throw error;
      }
      if (anchor.download === filename) return binding;
      restorePreviousBindingSlot();
      return null;
    }

    function targetBoundGstr3bPeriodToken(): string | null {
      const financialYear = /^(20\d{2})-(\d{2})$/.exec(config.targetBinding.financialYear);
      const monthNumbers: Readonly<Record<string, number>> = {
        April: 4,
        August: 8,
        December: 12,
        February: 2,
        January: 1,
        July: 7,
        June: 6,
        March: 3,
        May: 5,
        November: 11,
        October: 10,
        September: 9,
      };
      const monthNumber = monthNumbers[config.targetBinding.period];
      if (!financialYear?.[1] || !financialYear[2] || !monthNumber) return null;
      const financialYearStart = Number(financialYear[1]);
      if (Number(financialYear[2]) !== (financialYearStart + 1) % 100) return null;
      const calendarYear = monthNumber >= 4 ? financialYearStart : financialYearStart + 1;
      return `${String(monthNumber).padStart(2, "0")}${calendarYear}`;
    }

    function targetBoundGstr3bAnchorDownloadRequirement(): Gstr3bAnchorDownloadRequirement | null {
      if (
        config.targetBinding.returnType !== "GSTR-3B" ||
        config.targetBinding.artifactType !== "PDF"
      ) {
        return null;
      }
      const periodToken = targetBoundGstr3bPeriodToken();
      return periodToken ? { kind: "gstr3b-pdf-period", periodToken } : null;
    }

    function matchesTargetBoundGstr3bAnchorDownload(
      download: string,
      requirement: Gstr3bAnchorDownloadRequirement,
    ): boolean {
      const prefix = "GSTR3B_";
      const opaqueSegmentLength = 15;
      const periodSuffix = `_${requirement.periodToken}`;
      const pdfSuffix = `${periodSuffix}.pdf`;
      const suffix = download.endsWith(pdfSuffix)
        ? pdfSuffix
        : download.endsWith(periodSuffix)
          ? periodSuffix
          : null;
      if (!suffix || download.length !== prefix.length + opaqueSegmentLength + suffix.length) {
        return false;
      }
      if (!download.startsWith(prefix)) return false;
      for (let index = prefix.length; index < prefix.length + opaqueSegmentLength; index += 1) {
        const characterCode = download.charCodeAt(index);
        const isAsciiDigit = characterCode >= 48 && characterCode <= 57;
        const isAsciiUppercase = characterCode >= 65 && characterCode <= 90;
        if (!isAsciiDigit && !isAsciiUppercase) return false;
      }
      return true;
    }

    function targetBoundNativeGstr3bFilename(): string | null {
      const nonce = config.targetBoundNativeFilenameNonce;
      if (
        typeof nonce !== "string" ||
        !(/^[0-9a-f]{32}$/.test(nonce) || /^action[0-9a-z]{9,16}$/.test(nonce))
      ) {
        return null;
      }
      const periodToken = targetBoundGstr3bPeriodToken();
      if (!periodToken) return null;
      return `GSTR3B_${periodToken}_pack-${nonce}.pdf`;
    }

    let hookInstallationComplete = false;
    try {
      window.setTimeout = captureSetTimeout;
      installedSetTimeoutOwnDescriptor = Object.getOwnPropertyDescriptor(window, "setTimeout");

      window.open = captureWindowOpen;
      installedWindowOpenOwnDescriptor = Object.getOwnPropertyDescriptor(window, "open");

      if (pdfMake && capturePdfMakeCreatePdf) {
        pdfMake.createPdf = capturePdfMakeCreatePdf;
        installedPdfMakeCreatePdfOwnDescriptor = Object.getOwnPropertyDescriptor(
          pdfMake,
          "createPdf",
        );
      }

      saveAsTarget.saveAs = captureSaveAs;
      installedSaveAsOwnDescriptor = Object.getOwnPropertyDescriptor(saveAsTarget, "saveAs");

      window.fetch = captureFetch;
      installedFetchOwnDescriptor = Object.getOwnPropertyDescriptor(window, "fetch");

      if (asyncBlobBindingEnabled) {
        try {
          installXhrPropertyPatch("onreadystatechange");
          installXhrPropertyPatch("onload");
          installXhrPropertyPatch("onloadend");
        } catch {
          asyncBlobBindingEnabled = false;
          for (const patch of xhrEventPropertyPatches.values()) {
            restoreSafely(() => restoreXhrEventPropertyPatch(patch));
          }
          xhrEventPropertyPatches.clear();
        }
      }
      if (asyncBlobBindingEnabled) {
        try {
          Object.defineProperty(XMLHttpRequest.prototype, "addEventListener", {
            configurable: true,
            enumerable: originalXhrAddEventListenerOwnDescriptor?.enumerable ?? false,
            value: interposedXhrAddEventListener,
            writable: true,
          });
          installedXhrAddEventListenerOwnDescriptor = Object.getOwnPropertyDescriptor(
            XMLHttpRequest.prototype,
            "addEventListener",
          );
          Object.defineProperty(XMLHttpRequest.prototype, "removeEventListener", {
            configurable: true,
            enumerable: originalXhrRemoveEventListenerOwnDescriptor?.enumerable ?? false,
            value: interposedXhrRemoveEventListener,
            writable: true,
          });
          installedXhrRemoveEventListenerOwnDescriptor = Object.getOwnPropertyDescriptor(
            XMLHttpRequest.prototype,
            "removeEventListener",
          );
        } catch {
          asyncBlobBindingEnabled = false;
          restoreSafely(() => {
            restoreXhrPrototypeMethod(
              "addEventListener",
              originalXhrAddEventListenerOwnDescriptor,
              installedXhrAddEventListenerOwnDescriptor,
            );
          });
          restoreSafely(() => {
            restoreXhrPrototypeMethod(
              "removeEventListener",
              originalXhrRemoveEventListenerOwnDescriptor,
              installedXhrRemoveEventListenerOwnDescriptor,
            );
          });
          for (const patch of xhrEventPropertyPatches.values()) {
            restoreSafely(() => restoreXhrEventPropertyPatch(patch));
          }
          xhrEventPropertyPatches.clear();
        }
      }

      XMLHttpRequest.prototype.open = interposedXhrOpen;
      installedXhrOpenOwnDescriptor = Object.getOwnPropertyDescriptor(
        XMLHttpRequest.prototype,
        "open",
      );
      XMLHttpRequest.prototype.send = interposedXhrSend;
      installedXhrSendOwnDescriptor = Object.getOwnPropertyDescriptor(
        XMLHttpRequest.prototype,
        "send",
      );

      urlApi.createObjectURL = captureCreateObjectUrl;
      installedCreateObjectUrlOwnDescriptor = Object.getOwnPropertyDescriptor(
        urlApi,
        "createObjectURL",
      );
      if (webkitUrlApi) {
        webkitUrlApi.createObjectURL = captureCreateObjectUrl;
        installedWebkitCreateObjectUrlOwnDescriptor = Object.getOwnPropertyDescriptor(
          webkitUrlApi,
          "createObjectURL",
        );
      }
      if (typeof originalRevokeObjectUrl === "function") {
        urlApi.revokeObjectURL = captureRevokeObjectUrl;
        installedRevokeObjectUrlOwnDescriptor = Object.getOwnPropertyDescriptor(
          urlApi,
          "revokeObjectURL",
        );
      }
      if (webkitUrlApi && typeof originalWebkitRevokeObjectUrl === "function") {
        webkitUrlApi.revokeObjectURL = captureRevokeObjectUrl;
        installedWebkitRevokeObjectUrlOwnDescriptor = Object.getOwnPropertyDescriptor(
          webkitUrlApi,
          "revokeObjectURL",
        );
      }

      HTMLAnchorElement.prototype.click = captureAnchorClick;
      installedClickOwnDescriptor = Object.getOwnPropertyDescriptor(
        HTMLAnchorElement.prototype,
        "click",
      );
      HTMLAnchorElement.prototype.dispatchEvent = captureAnchorDispatchEvent;
      installedDispatchEventOwnDescriptor = Object.getOwnPropertyDescriptor(
        HTMLAnchorElement.prototype,
        "dispatchEvent",
      );
      hookInstallationComplete = true;

      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[${config.controlAttribute}="${cssEscape(config.controlId)}"]`,
        ),
      );
      if (controls.length === 0) {
        addSafeSignal(`${config.signalPrefix}-capture-control-not-found`);
        settle(null);
        return;
      }
      if (controls.length !== 1) {
        addSafeSignal(`${config.signalPrefix}-capture-control-ambiguous`);
        settle(null);
        return;
      }
      const control = controls[0];
      if (!control || !isCaptureControlActionable(control)) {
        addSafeSignal(`${config.signalPrefix}-capture-control-not-actionable`);
        settle(null);
        return;
      }
      const targetFailure = captureTargetFailure(control);
      if (targetFailure) {
        addSafeSignal(`${config.signalPrefix}-${targetFailure}`);
        settle(null);
        return;
      }
      const actionBinding = activateActionContext({ kind: "portal-action" });
      control.click();
      releaseActionContextAfterMicrotasks(actionBinding);
      callOriginalSetTimeout(() => {
        addSafeSignal(`${config.signalPrefix}-main-world-capture-timeout`);
        settle(null);
      }, config.timeoutMs ?? 60_000);
    } catch {
      addSafeSignal(
        `${config.signalPrefix}-${
          hookInstallationComplete ? "capture-control-click-threw" : "capture-hook-install-failed"
        }`,
      );
      settle(null);
      return;
    }
  });
}
