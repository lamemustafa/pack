import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(process.cwd(), "src");
const STYLES_ROOT = join(SOURCE_ROOT, "styles");
const GLOBAL_STYLESHEET = join(STYLES_ROOT, "global.css");
const CSS_NAMED_COLORS =
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor";
const CSS_SYSTEM_COLORS =
  "AccentColor AccentColorText ActiveText ButtonBorder ButtonFace ButtonText Canvas CanvasText Field FieldText GrayText Highlight HighlightText LinkText Mark MarkText SelectedItem SelectedItemText VisitedText";
const COLOR_LITERAL = new RegExp(
  `#[\\da-f]{3,8}\\b|\\b(?:color|color-mix|device-cmyk|hsl|hsla|hwb|lab|lch|light-dark|oklab|oklch|rgb|rgba)\\([^)]*\\)|(?<![-\\w])(?:${[CSS_NAMED_COLORS, CSS_SYSTEM_COLORS].join(" ").replaceAll(" ", "|")})(?![-\\w])`,
  "gi",
);
const ROOT_BLOCK = /:root\s*\{[\s\S]*?\}/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_STRING = /(["'])(?:\\.|(?!\1)[^\\])*\1/g;
const DECLARATION_VALUE = /(?:^|[;{])\s*(?:--[\w-]+|[\w-]+)\s*:\s*([^;{}]+)/g;
const CSS_URL = /url\([^)]*\)/gi;

async function stylesheetPaths(directory = SOURCE_ROOT): Promise<string[]> {
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
  return [...source.replace(CSS_COMMENT, "").matchAll(DECLARATION_VALUE)].flatMap((declaration) =>
    [
      ...(declaration[1] ?? "")
        .replace(CSS_STRING, "")
        .replace(CSS_URL, "")
        .matchAll(COLOR_LITERAL),
    ].map((match) => match[0]),
  );
}

async function literalViolations(directory = SOURCE_ROOT): Promise<readonly string[]> {
  const paths = await stylesheetPaths(directory);
  return (
    await Promise.all(
      paths.map(async (path) => {
        const literals = colorLiteralsOutsideCanonicalRoot(path, await readFile(path, "utf8"));
        return literals.length === 0 ? [] : [`${path}: ${literals.join(", ")}`];
      }),
    )
  ).flat();
}

describe("design token color literals", () => {
  it("allows literal token definitions only inside global.css's :root", async () => {
    expect(await literalViolations()).toEqual([]);
  });

  it("does not introduce an overlay elevation token", async () => {
    await expect(readFile(GLOBAL_STYLESHEET, "utf8")).resolves.not.toContain(
      "--pack-overlay-shadow",
    );
    await expect(readFile(join(STYLES_ROOT, "popup.css"), "utf8")).resolves.not.toContain(
      "var(--pack-overlay-shadow)",
    );
  });

  it.each([
    ["#ff0000"],
    ["rgb(255 0 0)"],
    ["hsl(0 100% 50%)"],
    ["oklch(62% 0.24 29)"],
    ["color(display-p3 1 0 0)"],
    ["rebeccapurple"],
    ["firebrick"],
    ["CanvasText"],
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

  it("ignores named-colour words outside declaration values", () => {
    expect(
      colorLiteralsOutsideCanonicalRoot(
        join(STYLES_ROOT, "panel.css"),
        '.red { display: block; } [data-state="orange"] { content: "white"; } /* firebrick */',
      ),
    ).toEqual([]);
  });

  it("ignores hexadecimal URL fragments in declaration values", () => {
    expect(
      colorLiteralsOutsideCanonicalRoot(
        join(STYLES_ROOT, "panel.css"),
        ".row { filter: url(#abcde); }",
      ),
    ).toEqual([]);
  });

  it("rejects a literal discovered from the stylesheet filesystem", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pack-style-literal-"));
    try {
      const entrypointStyles = join(directory, "entrypoints", "options");
      const componentStylesheet = join(entrypointStyles, "options.css");
      await mkdir(entrypointStyles, { recursive: true });
      await writeFile(componentStylesheet, ".row { color: firebrick; }");

      await expect(literalViolations(directory)).resolves.toEqual([
        `${componentStylesheet}: firebrick`,
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
