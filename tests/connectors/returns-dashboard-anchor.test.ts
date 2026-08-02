import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { clickReturnsDashboardAnchor } from "../../src/connectors/gst/returns-dashboard-anchor";

describe("Returns Dashboard portal anchor", () => {
  it("clicks the one exact resolved dashboard anchor without matching its text", () => {
    const documentRef = page(`
      <a href="https://return.gst.gov.in/returns/auth/dashboard">Unrelated wording</a>
      <a href="/returns/auth/other">Returns Dashboard</a>
      <a href="https://services.gst.gov.in/services/auth/dashboard">Dashboard</a>
      <button>Return Dashboard</button>
    `);
    const dashboard = documentRef.querySelector<HTMLAnchorElement>(
      "a[href*='returns/auth/dashboard']",
    )!;
    const click = vi.spyOn(dashboard, "click");

    expect(clickReturnsDashboardAnchor(documentRef)).toBe("clicked");
    expect(click).toHaveBeenCalledOnce();
  });

  it("fails closed when the exact anchor is absent or ambiguous", () => {
    expect(clickReturnsDashboardAnchor(page("<button>Return Dashboard</button>"))).toBe(
      "not-found",
    );
    expect(
      clickReturnsDashboardAnchor(
        page(
          '<a href="https://return.gst.gov.in/returns/auth/dashboard"></a><a href="https://return.gst.gov.in/returns/auth/dashboard"></a>',
        ),
      ),
    ).toBe("ambiguous");
  });

  it("clicks the sole visible exact anchor while leaving a hidden duplicate alone", () => {
    const documentRef = page(`
      <a href="https://return.gst.gov.in/returns/auth/dashboard" style="display: none">Hidden</a>
      <a href="https://return.gst.gov.in/returns/auth/dashboard">Visible</a>
    `);
    const [hidden, visible] = Array.from(documentRef.querySelectorAll<HTMLAnchorElement>("a"));
    const hiddenClick = vi.spyOn(hidden!, "click");
    const visibleClick = vi.spyOn(visible!, "click");

    expect(clickReturnsDashboardAnchor(documentRef)).toBe("clicked");
    expect(visibleClick).toHaveBeenCalledOnce();
    expect(hiddenClick).not.toHaveBeenCalled();
  });

  it("fails closed when duplicate exact anchors are all hidden", () => {
    expect(
      clickReturnsDashboardAnchor(
        page(`
          <a href="https://return.gst.gov.in/returns/auth/dashboard" hidden>Hidden</a>
          <a href="https://return.gst.gov.in/returns/auth/dashboard" style="display: none">Also hidden</a>
        `),
      ),
    ).toBe("not-found");
  });

  it("fails closed when visibility cannot be determined", () => {
    const documentRef = page(
      '<a href="https://return.gst.gov.in/returns/auth/dashboard">Indeterminate</a>',
    );
    Object.defineProperty(documentRef, "defaultView", { value: null });

    expect(clickReturnsDashboardAnchor(documentRef)).toBe("not-found");
  });

  it("excludes collapsed and transparent duplicates before choosing the visible anchor", () => {
    const documentRef = page(`
      <a href="https://return.gst.gov.in/returns/auth/dashboard" style="visibility: collapse">Collapsed</a>
      <a href="https://return.gst.gov.in/returns/auth/dashboard" style="opacity: 0">Transparent</a>
      <a href="https://return.gst.gov.in/returns/auth/dashboard">Visible</a>
    `);
    const anchors = Array.from(documentRef.querySelectorAll<HTMLAnchorElement>("a"));
    const visibleClick = vi.spyOn(anchors[2]!, "click");

    expect(clickReturnsDashboardAnchor(documentRef)).toBe("clicked");
    expect(visibleClick).toHaveBeenCalledOnce();
  });

  it("excludes portal-disabled duplicates before choosing the visible anchor", () => {
    const documentRef = page(`
      <a href="https://return.gst.gov.in/returns/auth/dashboard" style="pointer-events: none">Disabled</a>
      <div inert><a href="https://return.gst.gov.in/returns/auth/dashboard">Inert</a></div>
      <a href="https://return.gst.gov.in/returns/auth/dashboard">Visible</a>
    `);
    const anchors = Array.from(documentRef.querySelectorAll<HTMLAnchorElement>("a"));
    const visibleClick = vi.spyOn(anchors[2]!, "click");

    expect(clickReturnsDashboardAnchor(documentRef)).toBe("clicked");
    expect(visibleClick).toHaveBeenCalledOnce();
  });
});

function page(body: string): Document {
  const documentRef = new JSDOM(`<body>${body}</body>`, {
    url: "https://services.gst.gov.in/services/auth/fowelcome",
  }).window.document;
  for (const element of documentRef.querySelectorAll<HTMLElement>("a")) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 24,
    } as DOMRect);
  }
  return documentRef;
}
