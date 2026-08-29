import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_ROOT = join(process.cwd(), "src/styles");
const GLOBAL_STYLESHEET = join(STYLES_ROOT, "global.css");
const COLOR_LITERAL =
  /#[\da-f]{3,8}\b|\b(?:color|color-mix|device-cmyk|hsl|hsla|hwb|lab|lch|light-dark|oklab|oklch|rgb|rgba)\([^)]*\)|(?<![-\w])(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blue|brown|chartreuse|coral|cornflowerblue|crimson|cyan|darkblue|darkcyan|darkgray|darkgreen|darkgrey|darkorange|darkred|deeppink|deepskyblue|dodgerblue|fuchsia|gold|goldenrod|gray|green|grey|hotpink|indigo|ivory|khaki|lavender|lime|magenta|maroon|navy|olive|orange|orchid|pink|plum|purple|rebeccapurple|red|salmon|silver|skyblue|tan|teal|tomato|transparent|turquoise|violet|white|yellow)(?![-\w])/gi;
const ROOT_BLOCK = /:root\s*\{[\s\S]*?\}/g;

async function stylesheetPaths(directory = STYLES_ROOT): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return stylesheetPaths(path);
      return entry.name.endsWith(".css") ? [path] : [];
    }),
  );
  return nested.flat();
}

function colorLiteralsOutsideCanonicalRoot(path: string, css: string): readonly string[] {
  const source = path === GLOBAL_STYLESHEET ? css.replace(ROOT_BLOCK, "") : css;
  return [...source.matchAll(COLOR_LITERAL)].map((match) => match[0]);
}

describe("design token color literals", () => {
  it("allows literal token definitions only inside global.css's :root", async () => {
    const violations = await Promise.all(
      (await stylesheetPaths()).map(async (path) => {
        const literals = colorLiteralsOutsideCanonicalRoot(path, await readFile(path, "utf8"));
        return literals.length === 0 ? [] : [`${path}: ${literals.join(", ")}`];
      }),
    );

    expect(violations.flat()).toEqual([]);
  });

  it.each([
    ["#ff0000"],
    ["rgb(255 0 0)"],
    ["hsl(0 100% 50%)"],
    ["oklch(62% 0.24 29)"],
    ["color(display-p3 1 0 0)"],
    ["rebeccapurple"],
    ["transparent"],
  ])("detects the non-token color literal %s", (literal) => {
    expect(
      colorLiteralsOutsideCanonicalRoot(
        join(STYLES_ROOT, "panel.css"),
        `.row { color: ${literal}; }`,
      ),
    ).toEqual([literal]);
  });

  it("does not exempt a component :root block", () => {
    expect(
      colorLiteralsOutsideCanonicalRoot(
        join(STYLES_ROOT, "panel.css"),
        ":root { --local: #ff0000; }",
      ),
    ).toEqual(["#ff0000"]);
  });
});
