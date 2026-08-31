import { afterEach, describe, expect, it } from "vitest";
import config from "../../wxt.config";

/**
 * `--mode alpha` selects which surfaces compile in. It is not a development
 * mode, but Vite derives `isProduction` from NODE_ENV and only defaults that
 * to production when the mode is literally "production" -- so alpha builds
 * shipped the React development JSX transform and inlined absolute source
 * paths, including the builder's home directory, into the bundle. Alpha is
 * the build live testing runs against, so it has to be a production build
 * that merely exposes more surface.
 */

const original = process.env.NODE_ENV;

afterEach(() => {
  if (original === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original;
});

function resolveVite(mode: string) {
  const hook = config.vite;
  expect(typeof hook, "wxt.config must keep a vite hook to carry this").toBe("function");
  delete process.env.NODE_ENV;
  const returned = (hook as (env: { mode: string; command: string }) => unknown)({
    mode,
    command: "build",
  });
  return { nodeEnv: process.env.NODE_ENV, returned };
}

describe("alpha builds are production builds", () => {
  it("puts the alpha build in production so it carries no development transform", () => {
    expect(resolveVite("alpha").nodeEnv).toBe("production");
  });

  it("leaves the packaged production build in production too", () => {
    expect(resolveVite("production").nodeEnv).toBe("production");
  });

  it("does not force production onto a development server", () => {
    // `wxt dev` needs the development transform; forcing production here would
    // trade one broken build for another.
    expect(resolveVite("development").nodeEnv).toBeUndefined();
  });

  it("never rewrites the mode itself", () => {
    // The alpha gate folds on `import.meta.env.MODE === "alpha"`. Returning a
    // different mode from this hook would silently delete every gated surface
    // while leaving the build green.
    const { returned } = resolveVite("alpha");
    expect(returned).not.toHaveProperty("mode");
  });
});
