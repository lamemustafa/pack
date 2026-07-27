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
});

function page(body: string): Document {
  return new JSDOM(`<body>${body}</body>`, {
    url: "https://services.gst.gov.in/services/auth/fowelcome",
  }).window.document;
}
