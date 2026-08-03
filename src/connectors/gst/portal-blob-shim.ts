export type PortalBlobShimInput = {
  controlSelector: string;
  expectedControlText?: string;
  expectedMime: string;
  expectedPeriodTexts?: readonly string[];
  expectedTarget?: { financialYear: string; period: string; returnType: string };
  maxPortalBlobBytes?: number;
  timeoutMs?: number;
};
export const MAX_PORTAL_BLOB_BYTES = 25 * 1024 * 1024;
export type PortalBlobShimResult =
  | { ok: true; base64: string; blobUrl: string; safeSignals: string[] }
  | {
      ok: false;
      reason:
        | "control-artifact-mismatch"
        | "control-not-actionable"
        | "control-not-found"
        | "generation-timeout"
        | "page-period-mismatch"
        | "too-large"
        | "unexpected-content";
      safeSignals: string[];
    };
export function capturePortalPdfBlob(input: PortalBlobShimInput): Promise<PortalBlobShimResult> {
  // chrome.scripting serializes only this function, so every value it needs
  // must be in its args or defined inside this body.
  const maxPortalBlobBytes = input.maxPortalBlobBytes ?? 25 * 1024 * 1024;
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
      if (!blob || !blobUrl) return;
      const capturedBlobUrl = blobUrl;
      if (blob.size > maxPortalBlobBytes)
        return finish({ ok: false, reason: "too-large", safeSignals: [] });
      void blob.arrayBuffer().then(
        (buffer) =>
          finish({
            ok: true,
            base64: toBase64(new Uint8Array(buffer)),
            blobUrl: capturedBlobUrl,
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
    const controls = document.querySelectorAll<HTMLElement>(input.controlSelector);
    const control = controls.length === 1 ? controls[0] : null;
    if (!control) return finish({ ok: false, reason: "control-not-found", safeSignals: [] });
    const gstr2bControlRejection = (candidate: HTMLElement) => {
      const notActionable = {
        reason: "control-not-actionable" as const,
        safeSignal: "gstr2b-capture-control-not-actionable",
      };
      const artifactMismatch = {
        reason: "control-artifact-mismatch" as const,
        safeSignal: "gstr2b-capture-control-artifact-mismatch",
      };
      if (!candidate.isConnected) return notActionable;
      let current: HTMLElement | null = candidate;
      while (current) {
        if (
          current.matches(":disabled") ||
          current.hidden ||
          current.classList.contains("disabled") ||
          current.hasAttribute("inert") ||
          current.getAttribute("aria-hidden")?.trim().toLowerCase() === "true" ||
          current.getAttribute("aria-disabled")?.trim().toLowerCase() === "true"
        ) {
          return notActionable;
        }
        const style = current.ownerDocument.defaultView?.getComputedStyle(current);
        if (
          !style ||
          style.display === "none" ||
          style.visibility !== "visible" ||
          Number(style.opacity) === 0 ||
          style.pointerEvents === "none"
        ) {
          return notActionable;
        }
        current = current.parentElement;
      }
      const rect = candidate.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return notActionable;
      const comparable = (value: string) =>
        value
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
      return !input.expectedControlText ||
        comparable(candidate.innerText || "") !== comparable(input.expectedControlText)
        ? artifactMismatch
        : null;
    };
    const hasExpectedTarget = (
      candidate: HTMLElement,
      expected: NonNullable<PortalBlobShimInput["expectedTarget"]>,
    ): boolean => {
      if (expected.returnType === "GSTR-2B") {
        const comparable = (value: string) =>
          value
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
        const label = (prefix: string, pattern: RegExp) => {
          const snapshot = document.evaluate(
            `//div/span[not(*) and starts-with(normalize-space(), '${prefix}')]`,
            document,
            null,
            7,
            null,
          );
          const matches = Array.from({ length: snapshot.snapshotLength }, (_, index) =>
            snapshot.snapshotItem(index),
          ).filter((element): element is HTMLElement => {
            if (!element || element.nodeType !== 1) return false;
            const labelElement = element as HTMLElement;
            let current: HTMLElement | null = labelElement;
            while (current) {
              const style = current.ownerDocument.defaultView?.getComputedStyle(current);
              if (
                !style ||
                style.display === "none" ||
                style.visibility !== "visible" ||
                Number(style.opacity) === 0
              )
                return false;
              current = current.parentElement;
            }
            return (
              labelElement.isConnected &&
              labelElement.children.length === 0 &&
              !labelElement.closest("[inert], [aria-hidden='true'], [aria-disabled='true']") &&
              labelElement.getBoundingClientRect().width > 0 &&
              labelElement.getBoundingClientRect().height > 0 &&
              pattern.test(labelElement.innerText || "")
            );
          });
          const value = matches[0]?.innerText.match(pattern)?.[1]?.trim() ?? null;
          return matches.length === 1 && value ? value : null;
        };
        const labelledYear = label(
          "Financial Year",
          /^Financial Year\s*[-:]\s*([0-9]{4}\s*-\s*[0-9]{2})$/i,
        );
        const labelledPeriod = label("Return Period", /^Return Period\s*[-:]\s*([a-z]+)$/i);
        return Boolean(
          location.origin === "https://gstr2b.gst.gov.in" &&
          /^\/gstr2b\/auth\/gstr2b\/summary\/?$/i.test(location.pathname) &&
          labelledYear &&
          labelledPeriod &&
          comparable(labelledYear) === comparable(expected.financialYear) &&
          Boolean(
            input.expectedPeriodTexts?.length &&
            input.expectedPeriodTexts.some(
              (period) => comparable(labelledPeriod) === comparable(period),
            ),
          ),
        );
      }
      let current: HTMLElement | null = candidate;
      const escape = (value: string) =>
        [...value]
          .map((character) =>
            "\\.^$*+?()[]{}|".includes(character) ? `\\${character}` : character,
          )
          .join("");
      while (current && current !== candidate.ownerDocument.body) {
        const text = (current.textContent ?? "").replace(/\s+/g, " ").trim();
        if (
          /\b(?:(?:return|tax)\s*period|month)\b/i.test(text) &&
          /\b(?:financial\s*year|fy)\b/i.test(text) &&
          new RegExp(`\\b${escape(expected.returnType).replace("-", "[\\s-]?")}\\b`, "i").test(
            text,
          ) &&
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
    };
    if (input.expectedTarget?.returnType === "GSTR-2B") {
      const rejection = gstr2bControlRejection(control);
      if (rejection) {
        return finish({ ok: false, reason: rejection.reason, safeSignals: [rejection.safeSignal] });
      }
    }
    if (input.expectedTarget && !hasExpectedTarget(control, input.expectedTarget)) {
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
