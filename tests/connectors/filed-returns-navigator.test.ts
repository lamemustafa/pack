import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  findFiledGstr3bDownloadCandidateIndex,
  scoreFiledGstr3bDownloadCandidate,
  triggerFiledReturnDownload,
  triggerFiledGstr3bFiledPdfDownload,
} from "../../src/connectors/gst/filed-returns-download";
import {
  collectSafeNavigationDiagnostics,
  findDialogDismissalCandidateIndex,
  findFiledReturnsNavigationCandidateIndex,
  findReturnDashboardCandidateIndex,
  scoreDialogDismissalCandidate,
  scoreFiledReturnsNavigationCandidate,
  scoreFiledReturnsSummaryModalDismissalCandidate,
} from "../../src/connectors/gst/filed-returns-navigation-candidates";
import {
  dismissSafePostLoginDialogs,
  dismissKnownFiledReturnsSummaryModal,
} from "../../src/connectors/gst/filed-returns-dialogs";
import {
  navigateToFiledReturnsPage,
  navigateToReturnDashboardPage,
} from "../../src/connectors/gst/filed-returns-navigator";

describe("filed returns navigation matcher", () => {
  it("prefers the explicit View Filed Returns portal candidate", () => {
    const index = findFiledReturnsNavigationCandidateIndex([
      { text: "File Returns", href: "https://return.gst.gov.in/returns/auth/dashboard" },
      { text: "View Filed Returns" },
      { text: "Login" },
    ]);

    expect(index).toBe(1);
  });

  it("recognises the portal e-filed returns partial page URL without exposing raw HTML", () => {
    const score = scoreFiledReturnsNavigationCandidate({
      text: "",
      href: "https://return.gst.gov.in/pages/returns/efiledreturns.html",
    });

    expect(score.score).toBeGreaterThanOrEqual(80);
    expect(score.safeSignals).toEqual(
      expect.arrayContaining(["href-efiledreturns", "href-pages-returns"]),
    );
  });

  it("does not navigate to account links even when they are nearby", () => {
    const index = findFiledReturnsNavigationCandidateIndex([
      { text: "Login" },
      { text: "Register" },
      { text: "Returns" },
    ]);

    expect(index).toBe(-1);
  });

  it("prefers safe GST post-login dialog dismissal actions over affirmative actions", () => {
    const index = findDialogDismissalCandidateIndex([
      { text: "YES-CLICK HERE" },
      { text: "NO-REMIND ME LATER" },
      { text: "FILE AMENDMENT" },
    ]);

    expect(index).toBe(1);
    expect(scoreDialogDismissalCandidate({ text: "YES-CLICK HERE" }).score).toBeLessThan(0);
  });

  it("dismisses the GST Aadhaar E-KYC prompt even when it is not marked as a modal", async () => {
    const documentRef = createDocument(`
      <main>
        <button>RETURN DASHBOARD</button>
        <section>
          <h2>Would you like to Authenticate Aadhaar or Upload E-KYC Documents of Partner/Promoter and Primary Authorized Signatory?</h2>
          <a>YES, NAVIGATE TO MY PROFILE</a>
          <a>REMIND ME LATER</a>
          <p>NOTE : For future reference you can access this link again through Dashboard>My Profile>Aadhaar Authentication Status</p>
        </section>
        <button>CONTINUE TO DASHBOARD</button>
      </main>
    `);
    const [profileLink, remindLink] = Array.from(documentRef.querySelectorAll("a"));
    let profileClicked = 0;
    let remindClicked = 0;
    profileLink?.addEventListener("click", () => {
      profileClicked += 1;
    });
    remindLink?.addEventListener("click", () => {
      remindClicked += 1;
    });

    const signals = await dismissSafePostLoginDialogs(documentRef);

    expect(signals).toEqual(expect.arrayContaining(["safe-dialog-dismissed"]));
    expect(signals).toEqual(expect.arrayContaining(["dialog-remind-later"]));
    expect(remindClicked).toBe(1);
    expect(profileClicked).toBe(0);
  });

  it("does not dismiss unrelated visible post-login modals", async () => {
    const documentRef = createDocument(`
      <div class="modal show" style="display:block">
        <h2>Unrelated portal operation</h2>
        <button>Cancel</button>
      </div>
    `);
    let cancelClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      cancelClicked += 1;
    });

    const signals = await dismissSafePostLoginDialogs(documentRef);

    expect(signals).toEqual([]);
    expect(cancelClicked).toBe(0);
  });

  it("does not call authenticated GST snapshot probes during navigation", async () => {
    const documentRef = createDocument(
      `
      <main>
        <a>View Filed Returns</a>
      </main>
    `,
      "https://services.gst.gov.in/services/auth/fowelcome",
    );
    const fetchCalls: string[] = [];
    Object.defineProperty(documentRef.defaultView, "fetch", {
      configurable: true,
      value: async (url: string) => {
        fetchCalls.push(url);
        return { headers: new Headers(), ok: true, status: 200 };
      },
    });

    const result = await navigateToFiledReturnsPage(documentRef);

    expect(result.state).toBe("clicked");
    expect(fetchCalls).toEqual([]);
  });

  it("clicks a filed-returns menu item without the fixed menu delay when reveal is synchronous", async () => {
    const documentRef = createDocument(
      `
      <main>
        <button data-services>Services</button>
        <nav data-menu hidden></nav>
      </main>
    `,
      "https://services.gst.gov.in/services/auth/fowelcome",
    );
    const menu = documentRef.querySelector("[data-menu]");
    documentRef.querySelector("[data-services]")?.addEventListener("mouseover", () => {
      menu?.removeAttribute("hidden");
      const link = documentRef.createElement("a");
      link.href = "https://return.gst.gov.in/returns/auth/efiledReturns";
      link.textContent = "View Filed Returns";
      menu?.append(link);
    });
    const restoreSetTimeout = rejectFixedNavigationDelay();

    try {
      const result = await navigateToFiledReturnsPage(documentRef);

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining(["filed-returns-candidate-clicked", "after-services-menu"]),
      );
    } finally {
      restoreSetTimeout();
    }
  });

  it("clicks a return-dashboard menu item without the fixed menu delay when reveal is synchronous", async () => {
    const documentRef = createDocument(
      `
      <main>
        <button data-services>Services</button>
        <nav data-menu hidden></nav>
      </main>
    `,
      "https://services.gst.gov.in/services/auth/fowelcome",
    );
    const menu = documentRef.querySelector("[data-menu]");
    documentRef.querySelector("[data-services]")?.addEventListener("click", () => {
      menu?.removeAttribute("hidden");
      const link = documentRef.createElement("a");
      link.href = "https://return.gst.gov.in/returns/auth/dashboard";
      link.textContent = "Returns Dashboard";
      menu?.append(link);
    });
    const restoreSetTimeout = rejectFixedNavigationDelay();

    try {
      const result = await navigateToReturnDashboardPage(documentRef, "gst-gstr2b-private-v0");

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "return-dashboard-candidate-clicked",
          "return-dashboard-after-services-menu",
        ]),
      );
    } finally {
      restoreSetTimeout();
    }
  });

  it("finds the return dashboard entry before broader return actions", () => {
    const index = findReturnDashboardCandidateIndex([
      { text: "File Returns" },
      { text: "RETURN DASHBOARD" },
      { text: "Create Challan" },
    ]);

    expect(index).toBe(1);
  });

  it("keeps navigation diagnostics allow-listed and identifier-safe", () => {
    const diagnostics = collectSafeNavigationDiagnostics([
      { text: "Services" },
      { text: "27ABCDE1234F1Z5" },
      { text: "Return Dashboard" },
      { text: "Private Legal Name Pvt Ltd" },
      { text: "View Filed Returns" },
    ]);

    expect(diagnostics).toEqual(["Services", "Return Dashboard", "View Filed Returns"]);
  });

  it("dismisses only the known filed GSTR-3B summary modal", async () => {
    const documentRef = createDocument(`
      <div class="modal show" style="display:block">
        <div>System generated summary for GSTR-3B</div>
        <button aria-label="Close">x</button>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </div>
    `);
    const [closeButton, downloadButton] = Array.from(documentRef.querySelectorAll("button"));
    let closeClicked = 0;
    let downloadClicked = 0;
    closeButton?.addEventListener("click", () => {
      closeClicked += 1;
      closeButton.closest(".modal")?.remove();
    });
    downloadButton?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const signals = await dismissKnownFiledReturnsSummaryModal(documentRef);

    expect(signals).toEqual(
      expect.arrayContaining(["detail-summary-modal-dismissed", "summary-dialog-close"]),
    );
    expect(closeClicked).toBe(1);
    expect(downloadClicked).toBe(0);
  });

  it("dismisses known summary modals with icon-only close buttons", async () => {
    const documentRef = createDocument(`
      <div class="modal show" style="display:block">
        <div>System generated summary for GSTR-3B</div>
        <button class="close" type="button"><span aria-hidden="true">×</span></button>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </div>
    `);
    const [closeButton, downloadButton] = Array.from(documentRef.querySelectorAll("button"));
    let closeClicked = 0;
    let downloadClicked = 0;
    closeButton?.addEventListener("click", () => {
      closeClicked += 1;
      closeButton.closest(".modal")?.remove();
    });
    downloadButton?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const signals = await dismissKnownFiledReturnsSummaryModal(documentRef);

    expect(signals).toEqual(
      expect.arrayContaining(["detail-summary-modal-dismissed", "summary-dialog-close-class"]),
    );
    expect(closeClicked).toBe(1);
    expect(downloadClicked).toBe(0);
  });

  it("waits briefly for the portal to render its summary Close control", async () => {
    const documentRef = createDocument(`
      <div class="modal show" style="display:block">
        <div>System generated summary for GSTR-3B</div>
        <div data-actions></div>
      </div>
    `);
    globalThis.setTimeout(() => {
      const closeButton = documentRef.createElement("button");
      closeButton.setAttribute("aria-label", "Close");
      closeButton.textContent = "x";
      closeButton.addEventListener("click", () => closeButton.closest(".modal")?.remove());
      documentRef.querySelector("[data-actions]")?.append(closeButton);
    }, 30);

    const signals = await dismissKnownFiledReturnsSummaryModal(documentRef);

    expect(signals).toEqual(
      expect.arrayContaining([
        "detail-summary-modal-dismissed",
        "detail-summary-modal-close-clicked",
        "summary-dialog-close",
      ]),
    );
    expect(documentRef.querySelector(".modal")).toBeNull();
  });

  it("accepts a summary overlay that the portal dismisses naturally while Pack waits", async () => {
    const documentRef = createDocument(`
      <div class="modal show" style="display:block">
        <div>System generated summary for GSTR-3B</div>
      </div>
    `);
    globalThis.setTimeout(() => documentRef.querySelector(".modal")?.remove(), 30);

    const signals = await dismissKnownFiledReturnsSummaryModal(documentRef);

    expect(signals).toEqual(["detail-summary-modal-dismissed"]);
  });

  it("does not report dismissal when the portal replaces the summary overlay after Close", async () => {
    const documentRef = createDocument(`
      <div class="modal show" style="display:block">
        <div>System generated summary for GSTR-3B</div>
        <button aria-label="Close">x</button>
      </div>
    `);
    documentRef.querySelector("button")?.addEventListener("click", () => {
      documentRef.querySelector(".modal")?.remove();
      const replacement = documentRef.createElement("div");
      replacement.className = "modal show";
      replacement.style.display = "block";
      replacement.textContent = "System generated summary for GSTR-3B";
      documentRef.body.append(replacement);
    });

    const signals = await dismissKnownFiledReturnsSummaryModal(documentRef);

    expect(signals).toEqual(
      expect.arrayContaining([
        "detail-summary-modal-close-blocked",
        "detail-summary-modal-close-clicked",
      ]),
    );
    expect(documentRef.querySelector(".modal")).not.toBeNull();
  });

  it("never hides, removes, or restyles a summary modal or backdrop when portal close stalls", async () => {
    const documentRef = createDocument(`
      <div class="modal show" style="display:block">
        <div>System generated summary for GSTR-3B</div>
        <button aria-label="Close">x</button>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </div>
      <div class="modal-backdrop show"></div>
    `);
    documentRef.body.classList.add("modal-open");
    const modal = documentRef.querySelector<HTMLElement>(".modal");
    const backdrop = documentRef.querySelector<HTMLElement>(".modal-backdrop");
    const initialModalClass = modal?.className;
    const initialModalStyle = modal?.getAttribute("style");
    const initialBackdropClass = backdrop?.className;
    let closeClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      closeClicked += 1;
    });

    const signals = await dismissKnownFiledReturnsSummaryModal(documentRef);

    expect(signals).toEqual(
      expect.arrayContaining([
        "detail-summary-modal-close-blocked",
        "detail-summary-modal-close-clicked",
        "summary-dialog-close",
      ]),
    );
    expect(closeClicked).toBe(1);
    expect(modal?.isConnected).toBe(true);
    expect(modal?.className).toBe(initialModalClass);
    expect(modal?.getAttribute("style")).toBe(initialModalStyle);
    expect(modal?.hasAttribute("aria-hidden")).toBe(false);
    expect(documentRef.body.classList.contains("modal-open")).toBe(true);
    expect(backdrop?.isConnected).toBe(true);
    expect(backdrop?.className).toBe(initialBackdropClass);
  });

  it("does not dismiss unrelated modals", async () => {
    const documentRef = createDocument(`
      <div class="modal show" style="display:block">
        <div>File amendment reminder</div>
        <button aria-label="Close">x</button>
      </div>
    `);
    const closeButton = documentRef.querySelector("button");
    let closeClicked = 0;
    closeButton?.addEventListener("click", () => {
      closeClicked += 1;
    });

    const signals = await dismissKnownFiledReturnsSummaryModal(documentRef);

    expect(signals).toEqual([]);
    expect(closeClicked).toBe(0);
  });

  it("does not use non-dismissive actions when a known summary overlay has no Close control", async () => {
    const documentRef = createDocument(`
      <div class="modal show" style="display:block">
        <div>System generated summary for GSTR-3B</div>
        <button>Proceed</button>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </div>
    `);
    let clicked = 0;
    for (const button of Array.from(documentRef.querySelectorAll("button"))) {
      button.addEventListener("click", () => {
        clicked += 1;
      });
    }

    const signals = await dismissKnownFiledReturnsSummaryModal(documentRef);

    expect(signals).toEqual(["detail-summary-modal-close-control-not-found"]);
    expect(clicked).toBe(0);
  });

  it("scores only dismissive summary modal actions", () => {
    expect(
      scoreFiledReturnsSummaryModalDismissalCandidate({ text: "DOWNLOAD FILED GSTR-3B" }).score,
    ).toBeLessThan(0);
    expect(scoreFiledReturnsSummaryModalDismissalCandidate({ text: "Proceed" }).score).toBeLessThan(
      0,
    );
    expect(
      scoreFiledReturnsSummaryModalDismissalCandidate({ text: "x", ariaLabel: "Close" }).score,
    ).toBeGreaterThanOrEqual(80);
    expect(
      scoreFiledReturnsSummaryModalDismissalCandidate({ text: "", className: "close" }).score,
    ).toBeGreaterThanOrEqual(80);
  });

  it("targets only the explicit filed GSTR-3B PDF download control", () => {
    const index = findFiledGstr3bDownloadCandidateIndex([
      { text: "SYSTEM GENERATED GSTR-3B", title: "Click here to download GSTR-3B system PDF" },
      {
        text: "DOWNLOAD FILED GSTR-3B",
        title: "Please click here to download the Summary page of GSTR-3B for your review",
      },
      { text: "SAVE GSTR3B" },
    ]);

    expect(index).toBe(1);
  });

  it("rejects system-generated and filing action controls for filed PDF download", () => {
    expect(
      scoreFiledGstr3bDownloadCandidate({ text: "SYSTEM GENERATED GSTR-3B" }).score,
    ).toBeLessThan(0);
    expect(scoreFiledGstr3bDownloadCandidate({ text: "SAVE GSTR3B" }).score).toBeLessThan(0);
    expect(scoreFiledGstr3bDownloadCandidate({ text: "SUBMIT" }).score).toBeLessThan(0);
  });

  it("arms only the selected filed GSTR-3B PDF download control for capture", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
        <a title="Click here to download GSTR-3B system generated PDF">SYSTEM GENERATED GSTR-3B</a>
      </main>
    `);
    const [filedButton, systemLink] = Array.from(documentRef.querySelectorAll("button, a"));
    let filedClicked = 0;
    let systemClicked = 0;
    filedButton?.addEventListener("click", () => {
      filedClicked += 1;
    });
    systemLink?.addEventListener("click", () => {
      systemClicked += 1;
    });

    const result = await triggerFiledReturnDownload(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B",
    });

    expect(result.downloadTrigger.state).toBe("clicked");
    expect(result.downloadTrigger.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr3b-download-clicked",
        "text-download-filed-gstr3b",
        "filed-gstr3b-portal-blob-download-captured",
      ]),
    );
    expect("mainWorldCaptureRequest" in result).toBe(true);
    expect(filedButton?.hasAttribute("data-pack-gstr2b-capture-action")).toBe(true);
    expect(systemLink?.hasAttribute("data-pack-gstr2b-capture-action")).toBe(false);
    expect(filedClicked).toBe(0);
    expect(systemClicked).toBe(0);
  });

  it("does not click the GST home due-date PDF download", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>Goods and Services Tax</h1>
        <section>
          <h2>Upcoming Due Dates</h2>
          <button>DOWNLOAD PDF</button>
          <p>GSTR-3B (May, 2026)</p>
        </section>
      </main>
    `);
    let dueDateDownloadClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      dueDateDownloadClicked += 1;
    });

    const result = await triggerFiledGstr3bFiledPdfDownload(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B",
    });

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["not-filed-gstr3b-detail-page"]));
    expect(dueDateDownloadClicked).toBe(0);
  });
});

function createDocument(
  body: string,
  url = "https://return.gst.gov.in/returns/auth/gstr3b",
): Document {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    pretendToBeVisual: true,
  });
  (dom as unknown as { reconfigure(options: { url: string }): void }).reconfigure({ url });
  const windowRef = dom.window as unknown as Window & typeof globalThis;
  windowRef.HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      bottom: 10,
      height: 10,
      left: 0,
      right: 10,
      top: 0,
      width: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return dom.window.document;
}

function rejectFixedNavigationDelay(): () => void {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (timeout === 350) {
      throw new Error("Navigation should not wait for the fixed menu reveal delay.");
    }
    return originalSetTimeout(handler, timeout, ...args);
  }) as typeof globalThis.setTimeout;
  return () => {
    globalThis.setTimeout = originalSetTimeout;
  };
}
