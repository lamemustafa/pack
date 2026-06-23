import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  findFiledGstr3bDownloadCandidateIndex,
  scoreFiledGstr3bDownloadCandidate,
  triggerFiledGstr3bFiledPdfDownload,
} from "../../src/connectors/gst/filed-returns-download";
import {
  collectSafeNavigationDiagnostics,
  dismissSafePostLoginDialogs,
  dismissKnownFiledReturnsSummaryModal,
  findDialogDismissalCandidateIndex,
  findFiledReturnsNavigationCandidateIndex,
  findReturnDashboardCandidateIndex,
  scoreFiledReturnsSummaryModalDismissalCandidate,
  scoreDialogDismissalCandidate,
  scoreFiledReturnsNavigationCandidate,
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

  it("triggers only the selected filed GSTR-3B PDF download control", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
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

    const result = await triggerFiledGstr3bFiledPdfDownload(documentRef);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr3b-download-clicked", "text-download-filed-gstr3b"]),
    );
    expect(filedClicked).toBe(1);
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

    const result = await triggerFiledGstr3bFiledPdfDownload(documentRef);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["not-filed-gstr3b-detail-page"]));
    expect(dueDateDownloadClicked).toBe(0);
  });
});

function createDocument(body: string): Document {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    pretendToBeVisual: true,
  }).window.document;
}
