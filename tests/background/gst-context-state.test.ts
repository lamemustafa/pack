import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      session: {
        remove: vi.fn(async (key: string) => {
          delete storage.session[key];
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(storage.session, values);
        }),
      },
    },
  },
}));

import {
  parseCanonicalGstPortalContext,
  persistCanonicalGstPortalContext,
} from "../../src/background/gst-context-state";

const KEY = "context";
const TAB_URL = "https://services.gst.gov.in/services/auth/dashboard";

describe("canonical GST portal context state", () => {
  beforeEach(() => {
    storage.session = {};
    vi.clearAllMocks();
  });

  it("derives the exact tab origin and reconstructs action prose", async () => {
    const context = await persistCanonicalGstPortalContext(
      KEY,
      {
        connectorId: "gst",
        supported: false,
        origin: "https://services.gst.gov.in",
        pageKind: "gst-portal",
        safeTitle: "Synthetic Taxpayer Co. dashboard",
        requiredAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message: "Synthetic account-specific instruction.",
          canResume: false,
        },
      },
      TAB_URL,
    );

    expect(context).toEqual({
      connectorId: "gst",
      supported: false,
      origin: "https://services.gst.gov.in",
      pageKind: "gst-portal",
      requiredAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: "Open a supported GST Portal return page, then retry.",
        canResume: true,
      },
    });
    expect(JSON.stringify(storage.session[KEY])).not.toContain("Synthetic Taxpayer Co.");
    expect(JSON.stringify(storage.session[KEY])).not.toContain("account-specific");
  });

  it.each([
    {
      label: "mismatched origin",
      context: baseContext({ origin: "https://return.gst.gov.in" }),
    },
    {
      label: "inconsistent page state",
      context: baseContext({ pageKind: "unsupported", supported: true }),
    },
    {
      label: "unsupported sender origin",
      context: baseContext(),
      tabUrl: "https://example.com/returns",
    },
    {
      label: "unknown action",
      context: baseContext({
        requiredAction: {
          type: "SYNTHETIC_ACTION",
          message: "Synthetic instruction.",
          canResume: true,
        },
      }),
    },
  ])("removes stale state for $label", async ({ context, tabUrl = TAB_URL }) => {
    storage.session[KEY] = baseContext();

    await expect(persistCanonicalGstPortalContext(KEY, context, tabUrl)).resolves.toBeNull();
    expect(storage.session[KEY]).toBeUndefined();
  });

  it("does not retain a caller-supplied title in an otherwise valid context", () => {
    expect(
      parseCanonicalGstPortalContext(
        baseContext({ safeTitle: "Synthetic Taxpayer Co. dashboard" }),
        TAB_URL,
      ),
    ).not.toHaveProperty("safeTitle");
  });
});

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    connectorId: "gst",
    supported: true,
    origin: "https://services.gst.gov.in",
    pageKind: "gst-portal",
    ...overrides,
  };
}
