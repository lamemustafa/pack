export type PortalBlobShimInput = {
  controlSelector: string;
  expectedMime: string;
  expectedTarget?: { financialYear: string; period: string; returnType: string };
  timeoutMs?: number;
};
export type PortalBlobShimResult =
  | { ok: true; base64: string; safeSignals: string[] }
  | {
      ok: false;
      reason:
        "control-not-found" | "generation-timeout" | "page-period-mismatch" | "unexpected-content";
      safeSignals: string[];
    };
export function capturePortalPdfBlob(input: PortalBlobShimInput): Promise<PortalBlobShimResult> {
  const anchor = HTMLAnchorElement.prototype;
  const originalDispatch = anchor.dispatchEvent;
  const originalClick = anchor.click;
  const originalCreate = URL.createObjectURL;
  let blobUrl: string | null = null;
  let blob: Blob | null = null;
  let settled = false;
  const toBase64 = (bytes: Uint8Array) => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const restore = () => {
    anchor.dispatchEvent = originalDispatch;
    anchor.click = originalClick;
    URL.createObjectURL = originalCreate;
  };
  return new Promise<PortalBlobShimResult>((resolve) => {
    const finish = (result: PortalBlobShimResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const signal = (method: "dispatchEvent" | "click") => {
      if (!blob) return;
      void blob.arrayBuffer().then(
        (buffer) =>
          finish({
            ok: true,
            base64: toBase64(new Uint8Array(buffer)),
            safeSignals: [`portal-blob-shim-suppressed-via-${method}`],
          }),
        () => finish({ ok: false, reason: "unexpected-content", safeSignals: [] }),
      );
    };
    URL.createObjectURL = ((value: Blob | MediaSource) => {
      const url = originalCreate.call(URL, value);
      if (!blob && value instanceof Blob && value.type === input.expectedMime) {
        blob = value;
        blobUrl = url;
      }
      return url;
    }) as typeof URL.createObjectURL;
    anchor.dispatchEvent = function (event: Event) {
      if (blobUrl && this.href === blobUrl && event.type === "click") {
        signal("dispatchEvent");
        return false;
      }
      return originalDispatch.call(this, event);
    };
    anchor.click = function () {
      if (blobUrl && this.href === blobUrl) {
        signal("click");
        return;
      }
      originalClick.call(this);
    };
    const control = document.querySelector<HTMLElement>(input.controlSelector);
    if (!control) return finish({ ok: false, reason: "control-not-found", safeSignals: [] });
    if (input.expectedTarget && !controlHasVisibleTarget(control, input.expectedTarget)) {
      return finish({
        ok: false,
        reason: "page-period-mismatch",
        safeSignals: ["page-target-unverified"],
      });
    }
    globalThis.setTimeout(
      () => finish({ ok: false, reason: "generation-timeout", safeSignals: [] }),
      input.timeoutMs ?? 20_000,
    );
    try {
      control.click();
    } catch {
      finish({ ok: false, reason: "unexpected-content", safeSignals: [] });
    }
  }).finally(restore);
}

function controlHasVisibleTarget(
  control: HTMLElement,
  expected: NonNullable<PortalBlobShimInput["expectedTarget"]>,
): boolean {
  let current: HTMLElement | null = control;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
  while (current && current !== control.ownerDocument.body) {
    const text = (current.textContent ?? "").replace(/\s+/g, " ").trim();
    if (
      /\b(?:(?:return|tax)\s*period|month)\b/i.test(text) &&
      /\b(?:financial\s*year|fy)\b/i.test(text) &&
      new RegExp(`\\b${escape(expected.returnType).replace("-", "[\\s-]?")}\\b`, "i").test(text) &&
      new RegExp(
        `\\b(?:(?:return|tax)\\s*period|month)\\b\\s*(?:[-:]\\s*)?${escape(expected.period)}\\b`,
        "i",
      ).test(text) &&
      new RegExp(
        `\\b(?:financial\\s*year|fy)\\b\\s*(?:[-:]\\s*)?${escape(expected.financialYear)}`,
        "i",
      ).test(text)
    )
      return true;
    current = current.parentElement;
  }
  return false;
}
