import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: state.session[key] })),
        remove: vi.fn(async (key: string) => {
          delete state.session[key];
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(state.session, values);
        }),
      },
    },
  },
}));

import {
  parseCanonicalFiledReturnsObservation,
  persistCanonicalFiledReturnsObservation,
  readCanonicalFiledReturnsObservation,
} from "../../src/background/filed-returns-observation-state";
import { observeFiledReturnsPageText } from "../../src/connectors/gst/filed-returns-observer";

const KEY = "observation";

describe("canonical filed-return observation state", () => {
  beforeEach(() => {
    state.session = {};
    vi.clearAllMocks();
  });

  it("reconstructs messages and actions instead of persisting supplied prose", async () => {
    const observation = await persistCanonicalFiledReturnsObservation(KEY, {
      connectorId: "gst",
      pageKind: "gst-filed-returns",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "login-required",
      safeSignals: ["login"],
      safeMessage: "Synthetic Taxpayer Co. confidential note.",
      userAction: {
        type: "LOGIN",
        message: "Synthetic account-specific instruction.",
        canResume: false,
      },
    });

    expect(observation).toMatchObject({
      state: "login-required",
      safeSignals: ["login"],
      userAction: { type: "LOGIN", canResume: true },
    });
    expect(JSON.stringify(state.session[KEY])).not.toContain("Synthetic Taxpayer Co.");
    expect(JSON.stringify(state.session[KEY])).not.toContain("account-specific");
  });

  it("keeps producer and persisted signals deduplicated", () => {
    const produced = observeFiledReturnsPageText("GSTR-1", {
      pathname: "/returns/auth/gstr1",
    });

    expect(produced.safeSignals.filter((signal) => signal === "gstr-1")).toHaveLength(1);
    const parsed = parseCanonicalFiledReturnsObservation({
      ...produced,
      safeSignals: [...produced.safeSignals, "gstr-1"],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.safeSignals.filter((signal) => signal === "gstr-1")).toHaveLength(1);
  });

  it.each([
    {
      label: "unknown signal",
      observation: readyObservation({ safeSignals: ["synthetic-taxpayer-signal"] }),
    },
    {
      label: "extra field",
      observation: { ...readyObservation(), taxpayerLabel: "Synthetic Taxpayer Co." },
    },
    {
      label: "mismatched scope",
      observation: readyObservation({ scopeId: "gst-gstr2b-private-v0" }),
    },
  ])("removes stale state for an invalid $label", async ({ observation }) => {
    state.session[KEY] = readyObservation();

    await expect(persistCanonicalFiledReturnsObservation(KEY, observation)).resolves.toBeNull();
    expect(state.session[KEY]).toBeUndefined();
  });

  it("removes an invalid legacy observation while reading", async () => {
    state.session[KEY] = { ...readyObservation(), portalHtml: "Synthetic Taxpayer Co." };

    await expect(readCanonicalFiledReturnsObservation(KEY)).resolves.toBeNull();
    expect(state.session[KEY]).toBeUndefined();
  });
});

function readyObservation(overrides: Record<string, unknown> = {}) {
  return {
    connectorId: "gst",
    pageKind: "gst-filed-returns",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "ready",
    safeSignals: [
      "gstr-3b-detail-route",
      "filed-returns-heading",
      "gstr-3b",
      "download-filed-gstr-3b",
      "filed-return-download-ready",
      "filed-gstr3b-download-ready",
    ],
    safeMessage: "Synthetic supplied portal prose.",
    ...overrides,
  };
}
