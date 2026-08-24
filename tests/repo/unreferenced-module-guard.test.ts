import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
type UnreferencedSourceModuleAllowlistEntry = {
  path: string;
  reason: string;
};

type ProjectCompilerOptions = {
  options: ts.CompilerOptions;
  pathsBasePath: string;
};

const UNREFERENCED_SOURCE_MODULE_ALLOWLIST: readonly UnreferencedSourceModuleAllowlistEntry[] = [
  {
    path: "src/entrypoints/popup/run-evidence-panel.tsx",
    reason:
      "Unreached from all extension roots; tracked for dedicated product/cleanup review in #218.",
  },
  {
    path: "src/styles/popup-target-summary.css",
    reason: "Unreached stylesheet; tracked for dedicated cleanup review in #219.",
  },
];

const temporaryProjects: string[] = [];

function canonicalPath(path: string): string {
  const absolutePath = resolve(path);
  return ts.sys.useCaseSensitiveFileNames ? absolutePath : absolutePath.toLowerCase();
}

function projectPath(projectRoot: string, filePath: string): string {
  return relative(projectRoot, filePath).split(sep).join("/");
}

async function filesIn(directory: string, include: (name: string) => boolean): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) return filesIn(entryPath, include);
      return include(entry.name) ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

async function sourceFilesIn(directory: string): Promise<string[]> {
  return filesIn(directory, (name) => SOURCE_EXTENSIONS.has(extname(name)));
}

function typescriptModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const addModuleSpecifier = (node: ts.Expression | ts.TypeNode | undefined) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addModuleSpecifier(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addModuleSpecifier(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      addModuleSpecifier(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addModuleSpecifier(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

function moduleSpecifiers(filePath: string, sourceText: string): string[] {
  if (extname(filePath) === ".css") return [];
  return typescriptModuleSpecifiers(
    ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true),
  );
}

function compilerOptionsFor(projectRoot: string): ProjectCompilerOptions {
  const tsconfigPath = join(projectRoot, "tsconfig.json");
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    projectRoot,
    undefined,
    tsconfigPath,
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
        .join("\n"),
    );
  }
  const optionsWithPathsBasePath = parsed.options as ts.CompilerOptions & {
    pathsBasePath?: string;
  };
  return {
    options: parsed.options,
    pathsBasePath: optionsWithPathsBasePath.pathsBasePath ?? projectRoot,
  };
}

function stylesheetSourcePathForSpecifier(
  specifierPath: string,
  importerPath: string,
  compilerOptions: ProjectCompilerOptions,
  filesByPath: ReadonlyMap<string, string>,
): string | undefined {
  if (extname(specifierPath) !== ".css") return undefined;
  if (specifierPath.startsWith(".")) {
    const candidatePath = canonicalPath(resolve(dirname(importerPath), specifierPath));
    return filesByPath.has(candidatePath) ? candidatePath : undefined;
  }

  const matchingPathPatterns = Object.entries(compilerOptions.options.paths ?? {})
    .map(([pattern, substitutions]) => {
      const [prefix = "", suffix = ""] = pattern.split("*");
      return { prefix, suffix, substitutions };
    })
    .filter(
      ({ prefix, suffix }) => specifierPath.startsWith(prefix) && specifierPath.endsWith(suffix),
    )
    .sort((left, right) => right.prefix.length - left.prefix.length);

  for (const { prefix, suffix, substitutions } of matchingPathPatterns) {
    const wildcard = specifierPath.slice(prefix.length, specifierPath.length - suffix.length);
    for (const substitution of substitutions) {
      const candidatePath = canonicalPath(
        resolve(compilerOptions.pathsBasePath, substitution.replaceAll("*", wildcard)),
      );
      if (filesByPath.has(candidatePath)) return candidatePath;
    }
  }

  return undefined;
}

function sourcePathForSpecifier(
  specifier: string,
  importerPath: string,
  compilerOptions: ProjectCompilerOptions,
  filesByPath: ReadonlyMap<string, string>,
): string | undefined {
  const specifierPath = specifier.split(/[?#]/, 1)[0] ?? specifier;
  const resolvedModule = ts.resolveModuleName(
    specifierPath,
    importerPath,
    compilerOptions.options,
    ts.sys,
  ).resolvedModule;
  if (resolvedModule) {
    const resolvedPath = canonicalPath(resolvedModule.resolvedFileName);
    if (filesByPath.has(resolvedPath)) return resolvedPath;
  }
  return stylesheetSourcePathForSpecifier(
    specifierPath,
    importerPath,
    compilerOptions,
    filesByPath,
  );
}

function isSourceSpecifier(specifier: string, compilerOptions: ProjectCompilerOptions): boolean {
  const specifierPath = specifier.split(/[?#]/, 1)[0] ?? specifier;
  if (specifierPath.startsWith(".")) return true;
  return Object.keys(compilerOptions.options.paths ?? {}).some((pattern) => {
    const [prefix, suffix = ""] = pattern.split("*");
    return specifierPath.startsWith(prefix ?? "") && specifierPath.endsWith(suffix);
  });
}

function unresolvedSourceSpecifierError(
  projectRoot: string,
  importerPath: string,
  specifier: string,
): Error {
  return new Error(
    `Could not resolve source specifier ${JSON.stringify(specifier)} from ${projectPath(projectRoot, importerPath)}`,
  );
}

function isWxtEntrypoint(sourceDirectory: string, filePath: string): boolean {
  const path = projectPath(sourceDirectory, filePath);
  return /^entrypoints\/(?:background|content|[^/]+\.content)\.(?:ts|tsx)$/.test(path);
}

function htmlAttributeValue(attributes: string, name: string): string | undefined {
  const match = attributes.match(
    new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))", "i"),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function htmlEntrypointSpecifiers(html: string): string[] {
  const specifiers: string[] = [];
  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const [, tagName, attributes] = match;
    if (!tagName || !attributes) continue;
    const normalizedTagName = tagName.toLowerCase();
    const isModuleScript =
      normalizedTagName === "script" &&
      htmlAttributeValue(attributes, "type")?.trim().toLowerCase() === "module";
    const isStylesheet =
      normalizedTagName === "link" &&
      htmlAttributeValue(attributes, "rel")
        ?.trim()
        .split(/\s+/)
        .some((token) => token.toLowerCase() === "stylesheet");
    const reference = htmlAttributeValue(
      attributes,
      normalizedTagName === "script" ? "src" : "href",
    );
    if ((isModuleScript || isStylesheet) && reference) specifiers.push(reference);
  }
  return specifiers;
}

function sourcePathForHtmlReference(
  reference: string,
  projectRoot: string,
  htmlPath: string,
  compilerOptions: ProjectCompilerOptions,
  filesByPath: ReadonlyMap<string, string>,
): { path: string | undefined; sourceSpecifier: string | undefined } {
  if (reference.startsWith("/")) {
    const sourcePath = canonicalPath(resolve(projectRoot, `.${reference.split(/[?#]/, 1)[0]}`));
    return {
      path: filesByPath.has(sourcePath) ? sourcePath : undefined,
      sourceSpecifier: undefined,
    };
  }
  if (reference.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(reference)) {
    return { path: undefined, sourceSpecifier: undefined };
  }
  const sourceSpecifier = reference.startsWith(".") ? reference : `./${reference}`;
  return {
    path: sourcePathForSpecifier(sourceSpecifier, htmlPath, compilerOptions, filesByPath),
    sourceSpecifier,
  };
}

async function optionalWxtConfigText(wxtConfigPath: string): Promise<string | undefined> {
  try {
    return await readFile(wxtConfigPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read WXT config ${wxtConfigPath}: ${detail}`);
  }
}

function wxtSourceDirectory(projectRoot: string, configText: string | undefined): string {
  if (!configText) return projectRoot;
  const configSource = ts.createSourceFile(
    join(projectRoot, "wxt.config.ts"),
    configText,
    ts.ScriptTarget.Latest,
    true,
  );
  let srcDirInitializer: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineConfig"
    ) {
      const configObject = node.arguments.find(ts.isObjectLiteralExpression);
      const srcDirProperty = configObject?.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) &&
          (ts.isStringLiteral(property.name)
            ? property.name.text
            : property.name.getText(configSource)) === "srcDir",
      );
      srcDirInitializer = srcDirProperty?.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(configSource);
  if (!srcDirInitializer) return projectRoot;
  if (!ts.isStringLiteralLike(srcDirInitializer)) {
    throw new Error("Could not determine static WXT srcDir from wxt.config.ts");
  }
  return resolve(projectRoot, srcDirInitializer.text);
}

function assertScannableWxtSourceDirectory(projectRoot: string, sourceDirectory: string): void {
  if (canonicalPath(sourceDirectory) === canonicalPath(projectRoot)) {
    throw new Error(
      "WXT config wxt.config.ts must set a static srcDir outside the project root; refusing to scan an unbounded extension source tree",
    );
  }
}

async function rootPathsFor(
  projectRoot: string,
  sourceDirectory: string,
  sourceFiles: readonly string[],
  compilerOptions: ProjectCompilerOptions,
  filesByPath: ReadonlyMap<string, string>,
  wxtConfigText: string | undefined,
): Promise<Set<string>> {
  const rootPaths = new Set(
    sourceFiles.filter((filePath) => isWxtEntrypoint(sourceDirectory, filePath)).map(canonicalPath),
  );
  const entrypointDirectory = join(sourceDirectory, "entrypoints");
  const htmlEntrypoints = await filesIn(entrypointDirectory, (name) => name === "index.html");
  for (const htmlPath of htmlEntrypoints) {
    const html = await readFile(htmlPath, "utf8");
    for (const specifier of htmlEntrypointSpecifiers(html)) {
      const htmlReference = sourcePathForHtmlReference(
        specifier,
        projectRoot,
        htmlPath,
        compilerOptions,
        filesByPath,
      );
      if (htmlReference.path) rootPaths.add(htmlReference.path);
      else if (
        htmlReference.sourceSpecifier &&
        isSourceSpecifier(htmlReference.sourceSpecifier, compilerOptions)
      ) {
        throw unresolvedSourceSpecifierError(projectRoot, htmlPath, htmlReference.sourceSpecifier);
      }
    }
  }

  const wxtConfigPath = join(projectRoot, "wxt.config.ts");
  if (wxtConfigText) {
    for (const specifier of moduleSpecifiers(wxtConfigPath, wxtConfigText)) {
      const rootPath = sourcePathForSpecifier(
        specifier,
        wxtConfigPath,
        compilerOptions,
        filesByPath,
      );
      if (rootPath) rootPaths.add(rootPath);
      else if (isSourceSpecifier(specifier, compilerOptions)) {
        throw unresolvedSourceSpecifierError(projectRoot, wxtConfigPath, specifier);
      }
    }
  }

  return rootPaths;
}

async function assertNoUnreferencedSourceModules(
  projectRoot = process.cwd(),
  allowlist: readonly UnreferencedSourceModuleAllowlistEntry[] = projectRoot === process.cwd()
    ? UNREFERENCED_SOURCE_MODULE_ALLOWLIST
    : [],
): Promise<void> {
  const wxtConfigText = await optionalWxtConfigText(join(projectRoot, "wxt.config.ts"));
  const sourceDirectory = wxtSourceDirectory(projectRoot, wxtConfigText);
  assertScannableWxtSourceDirectory(projectRoot, sourceDirectory);
  const sourceFiles = await sourceFilesIn(sourceDirectory);
  const reportableSourceFiles = sourceFiles.filter((filePath) => !filePath.endsWith(".d.ts"));
  const filesByPath = new Map(sourceFiles.map((filePath) => [canonicalPath(filePath), filePath]));
  const dependenciesByPath = new Map(
    sourceFiles.map((filePath) => [canonicalPath(filePath), new Set<string>()]),
  );
  const compilerOptions = compilerOptionsFor(projectRoot);
  const unsupportedCssImports: string[] = [];

  for (const sourcePath of sourceFiles) {
    const sourceText = await readFile(sourcePath, "utf8");
    if (extname(sourcePath) === ".css" && /@import\b/i.test(sourceText)) {
      unsupportedCssImports.push(projectPath(projectRoot, sourcePath));
    }
    for (const specifier of moduleSpecifiers(sourcePath, sourceText)) {
      const targetPath = sourcePathForSpecifier(
        specifier,
        sourcePath,
        compilerOptions,
        filesByPath,
      );
      if (targetPath) dependenciesByPath.get(canonicalPath(sourcePath))?.add(targetPath);
      else if (isSourceSpecifier(specifier, compilerOptions)) {
        throw unresolvedSourceSpecifierError(projectRoot, sourcePath, specifier);
      }
    }
  }

  if (unsupportedCssImports.length > 0) {
    throw new Error(
      `Unsupported CSS @import edges:\n${unsupportedCssImports
        .sort()
        .map((path) => `- ${path}`)
        .join("\n")}`,
    );
  }

  const rootPaths = await rootPathsFor(
    projectRoot,
    sourceDirectory,
    sourceFiles,
    compilerOptions,
    filesByPath,
    wxtConfigText,
  );
  const reachedPaths = new Set(rootPaths);
  const pendingPaths = [...rootPaths];
  for (const currentPath of pendingPaths) {
    for (const dependencyPath of dependenciesByPath.get(currentPath) ?? []) {
      if (!reachedPaths.has(dependencyPath)) {
        reachedPaths.add(dependencyPath);
        pendingPaths.push(dependencyPath);
      }
    }
  }

  const allowlistedPaths = new Set<string>();
  const staleAllowlistEntries: string[] = [];
  for (const entry of allowlist) {
    if (!entry.reason.trim()) throw new Error(`Missing allowlist reason for ${entry.path}`);
    const allowlistedPath = canonicalPath(join(projectRoot, entry.path));
    if (!filesByPath.has(allowlistedPath)) {
      staleAllowlistEntries.push(`- ${entry.path}: file no longer exists (${entry.reason})`);
    } else if (reachedPaths.has(allowlistedPath)) {
      staleAllowlistEntries.push(`- ${entry.path}: module is now reachable (${entry.reason})`);
    } else {
      allowlistedPaths.add(allowlistedPath);
    }
  }

  if (staleAllowlistEntries.length > 0) {
    throw new Error(
      `Stale unreferenced module allowlist entries:\n${staleAllowlistEntries.join("\n")}`,
    );
  }

  const unreferenced = reportableSourceFiles
    .filter((filePath) => {
      const canonicalFilePath = canonicalPath(filePath);
      return !allowlistedPaths.has(canonicalFilePath) && !reachedPaths.has(canonicalFilePath);
    })
    .map((filePath) => projectPath(projectRoot, filePath))
    .sort();

  if (unreferenced.length > 0) {
    throw new Error(
      `Unreferenced source modules:\n${unreferenced.map((path) => `- ${path}`).join("\n")}`,
    );
  }
}

async function writeProjectFile(
  projectRoot: string,
  path: string,
  contents: string,
): Promise<void> {
  const filePath = join(projectRoot, path);
  await mkdir(resolve(filePath, ".."), { recursive: true });
  await writeFile(filePath, contents);
}

async function createTemporaryProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "pack-unreferenced-module-"));
  temporaryProjects.push(projectRoot);
  await writeProjectFile(
    projectRoot,
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
  );
  await writeProjectFile(
    projectRoot,
    "wxt.config.ts",
    'import { defineConfig } from "wxt";\nexport default defineConfig({ srcDir: "src" });\n',
  );
  return projectRoot;
}

afterEach(async () => {
  await Promise.all(
    temporaryProjects.splice(0).map((projectRoot) => rm(projectRoot, { recursive: true })),
  );
});

describe("unreferenced source module guard", () => {
  it("finds no unreferenced modules in Pack's source graph", async () => {
    await expect(assertNoUnreferencedSourceModules()).resolves.toBeUndefined();
  });

  it("fails when a module is imported only by its own test", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/background.ts",
      'import "@/core/import-forms";\n',
    );
    await writeProjectFile(projectRoot, "src/core/live.ts", "export const live = true;\n");
    await writeProjectFile(
      projectRoot,
      "src/core/re-export.ts",
      'export { live } from "@/core/live";\n',
    );
    await writeProjectFile(projectRoot, "src/core/dynamic.ts", "export const dynamic = true;\n");
    await writeProjectFile(
      projectRoot,
      "src/core/import-forms.ts",
      'import type { Value } from "@/core/type-only";\nexport { live } from "@/core/re-export";\nvoid import("@/core/dynamic");\nexport type { Value };\n',
    );
    await writeProjectFile(projectRoot, "src/core/type-only.ts", "export type Value = string;\n");
    await writeProjectFile(projectRoot, "src/core/test-only.ts", "export const testOnly = true;\n");
    await writeProjectFile(
      projectRoot,
      "tests/core/test-only.test.ts",
      'import { testOnly } from "../../src/core/test-only";\nvoid testOnly;\n',
    );

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      /^Unreferenced source modules:\n- src\/core\/test-only\.ts$/,
    );
  });

  it("fails when an entrypoints helper is imported only by its own test", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/popup/test-only-helper.ts",
      "export const testOnlyHelper = true;\n",
    );
    await writeProjectFile(
      projectRoot,
      "tests/popup/test-only-helper.test.ts",
      'import { testOnlyHelper } from "../../src/entrypoints/popup/test-only-helper";\nvoid testOnlyHelper;\n',
    );

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      /^Unreferenced source modules:\n- src\/entrypoints\/popup\/test-only-helper\.ts$/,
    );
  });

  it("fails when a disconnected source cycle is unreachable from every root", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(projectRoot, "src/core/cycle-a.ts", 'import "./cycle-b";\n');
    await writeProjectFile(projectRoot, "src/core/cycle-b.ts", 'import "./cycle-a";\n');

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      /^Unreferenced source modules:\n- src\/core\/cycle-a\.ts\n- src\/core\/cycle-b\.ts$/,
    );
  });

  it("fails when an HTML entrypoint stops referencing its nested main module", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/options/index.html",
      '<script type="module" src="./main.ts"></script>\n',
    );
    await writeProjectFile(projectRoot, "src/entrypoints/options/main.ts", "export {};\n");
    await writeProjectFile(projectRoot, "src/entrypoints/options/index.html", "<body></body>\n");
    await expect(
      readFile(join(projectRoot, "src/entrypoints/options/index.html"), "utf8"),
    ).resolves.not.toContain("main.ts");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      /^Unreferenced source modules:\n- src\/entrypoints\/options\/main\.ts$/,
    );
  });

  it("rejects CSS @import even when it appears only in a comment", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/background.ts",
      'import "../styles/live.css";\n',
    );
    await writeProjectFile(projectRoot, "src/styles/live.css", '/* @import "./dead.css"; */\n');
    await writeProjectFile(projectRoot, "src/styles/dead.css", ".dead {}\n");
    await expect(readFile(join(projectRoot, "src/styles/live.css"), "utf8")).resolves.toContain(
      '/* @import "./dead.css"; */',
    );

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      /^Unsupported CSS @import edges:\n- src\/styles\/live\.css$/,
    );
  });

  it("fails when an allowlisted module no longer exists", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    const allowlistedPath = "src/core/allowlisted.ts";
    await writeProjectFile(projectRoot, allowlistedPath, "export {};\n");
    await rm(join(projectRoot, allowlistedPath));
    await expect(readFile(join(projectRoot, allowlistedPath), "utf8")).rejects.toThrow();

    await expect(
      assertNoUnreferencedSourceModules(projectRoot, [
        { path: allowlistedPath, reason: "Dedicated cleanup follow-up." },
      ]),
    ).rejects.toThrow(/src\/core\/allowlisted\.ts.*Dedicated cleanup follow-up\./s);
  });

  it("fails when an allowlisted module becomes reachable", async () => {
    const projectRoot = await createTemporaryProject();
    const allowlistedPath = "src/core/allowlisted.ts";
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/background.ts",
      'import "../core/allowlisted";\n',
    );
    await writeProjectFile(projectRoot, allowlistedPath, "export {};\n");

    await expect(
      assertNoUnreferencedSourceModules(projectRoot, [
        { path: allowlistedPath, reason: "Dedicated cleanup follow-up." },
      ]),
    ).rejects.toThrow(/src\/core\/allowlisted\.ts.*Dedicated cleanup follow-up\./s);
  });

  it("follows a stylesheet imported through a configured alias", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/background.ts",
      'import "@/styles/live.css?inline";\n',
    );
    await writeProjectFile(projectRoot, "src/styles/live.css", ".live {}\n");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).resolves.toBeUndefined();
  });

  it("uses the longest matching alias only for stylesheet imports", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(
      projectRoot,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["src/styles/live.css"],
            "@/styles/*": ["src/generated/styles/*"],
          },
        },
      }),
    );
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/background.ts",
      'import "../styles/live.css";\nimport "@/styles/aliased.css";\n',
    );
    await writeProjectFile(projectRoot, "src/styles/live.css", ".live {}\n");
    await writeProjectFile(projectRoot, "src/generated/styles/aliased.css", ".aliased {}\n");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).resolves.toBeUndefined();
  });

  it("accepts type imports resolved to declaration files without reporting declarations", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/background.ts",
      'import type { Value } from "../core/types";\nexport type { Value };\n',
    );
    await writeProjectFile(projectRoot, "src/core/types.d.ts", "export type Value = string;\n");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).resolves.toBeUndefined();
  });

  it("treats a named WXT content script as a root", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/gst.content.ts", "export {};\n");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).resolves.toBeUndefined();
  });

  it("treats every source module imported by the WXT config as a root", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(projectRoot, "src/extension/build-constants.ts", "export {};\n");
    await writeProjectFile(
      projectRoot,
      "wxt.config.ts",
      'import { defineConfig } from "wxt";\nimport "./src/extension/build-constants";\nexport default defineConfig({ srcDir: "src" });\n',
    );

    await expect(assertNoUnreferencedSourceModules(projectRoot)).resolves.toBeUndefined();
  });

  it("does not treat a script href as a module root", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/options/index.html",
      '<script type="module" href="./main.ts"></script>\n',
    );
    await writeProjectFile(projectRoot, "src/entrypoints/options/main.ts", "export {};\n");
    await expect(
      readFile(join(projectRoot, "src/entrypoints/options/index.html"), "utf8"),
    ).resolves.toContain('href="./main.ts"');

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      /^Unreferenced source modules:\n- src\/entrypoints\/options\/main\.ts$/,
    );
  });

  it("does not treat data-src as a module root", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/options/index.html",
      '<script type="module" data-src="./dead.ts"></script>\n',
    );
    await writeProjectFile(projectRoot, "src/entrypoints/options/dead.ts", "export {};\n");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      /^Unreferenced source modules:\n- src\/entrypoints\/options\/dead\.ts$/,
    );
  });

  it("does not treat a stylesheet link src as a stylesheet root", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/options/index.html",
      '<link rel="stylesheet" src="./options.css">\n',
    );
    await writeProjectFile(projectRoot, "src/entrypoints/options/options.css", ".options {}\n");
    await expect(
      readFile(join(projectRoot, "src/entrypoints/options/index.html"), "utf8"),
    ).resolves.toContain('src="./options.css"');

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      /^Unreferenced source modules:\n- src\/entrypoints\/options\/options\.css$/,
    );
  });

  it("reports a WXT config read error before calculating roots", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(projectRoot, "src/extension/manifest-policy.ts", "export {};\n");
    const wxtConfigPath = join(projectRoot, "wxt.config.ts");
    await rm(wxtConfigPath);
    await mkdir(wxtConfigPath);
    await expect(mkdir(wxtConfigPath)).rejects.toThrow();

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      new RegExp(
        `^Could not read WXT config ${wxtConfigPath.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}:`,
      ),
    );
  });

  it("reports an unresolved WXT config source specifier before calculating roots", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(projectRoot, "src/extension/manifest-policy.ts", "export {};\n");
    await writeProjectFile(
      projectRoot,
      "wxt.config.ts",
      'import { defineConfig } from "wxt";\nimport "./src/extension/missing-manifest-policy";\nexport default defineConfig({ srcDir: "src" });\n',
    );
    await expect(readFile(join(projectRoot, "wxt.config.ts"), "utf8")).resolves.toContain(
      '"./src/extension/missing-manifest-policy"',
    );

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      'Could not resolve source specifier "./src/extension/missing-manifest-policy" from wxt.config.ts',
    );
  });

  it.each(["main.ts", "./main.ts"])("treats HTML %s as document-relative", async (reference) => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/options/index.html",
      `<script type="module" src="${reference}"></script>\n`,
    );
    await writeProjectFile(projectRoot, "src/entrypoints/options/main.ts", "export {};\n");
    await expect(
      readFile(join(projectRoot, "src/entrypoints/options/index.html"), "utf8"),
    ).resolves.toContain(`src="${reference}"`);

    await expect(assertNoUnreferencedSourceModules(projectRoot)).resolves.toBeUndefined();
  });

  it("finds valid unquoted, case-insensitive HTML references and multi-token rel values", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/options/index.html",
      "<SCRIPT TYPE = 'module' SRC = main.ts></SCRIPT>\n<LINK REL='preload stylesheet' HREF=options.css>\n",
    );
    await writeProjectFile(projectRoot, "src/entrypoints/options/main.ts", "export {};\n");
    await writeProjectFile(projectRoot, "src/entrypoints/options/options.css", ".options {}\n");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).resolves.toBeUndefined();
  });

  it("resolves root-absolute URLs inside source and ignores package-root assets", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(projectRoot, "src/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/options/index.html",
      '<link rel="stylesheet" href="/src/styles/root-absolute.css">\n<link rel="icon" href="/brand/pack-favicon.svg">\n',
    );
    await writeProjectFile(projectRoot, "src/styles/root-absolute.css", ".root-absolute {}\n");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).resolves.toBeUndefined();
  });

  it("follows the static WXT srcDir instead of a hard-coded source directory", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(
      projectRoot,
      "wxt.config.ts",
      'import { defineConfig } from "wxt";\nexport default defineConfig({ srcDir: "extension" });\n',
    );
    await writeProjectFile(
      projectRoot,
      "extension/entrypoints/background.ts",
      'import "../core/live";\n',
    );
    await writeProjectFile(projectRoot, "extension/core/live.ts", "export {};\n");
    await writeProjectFile(projectRoot, "src/stale.ts", "export {};\n");
    await expect(readFile(join(projectRoot, "wxt.config.ts"), "utf8")).resolves.toContain(
      'srcDir: "extension"',
    );

    await expect(assertNoUnreferencedSourceModules(projectRoot)).resolves.toBeUndefined();
  });

  it("refuses WXT's project-root default when srcDir is absent", async () => {
    const projectRoot = await createTemporaryProject();
    const wxtConfigPath = join(projectRoot, "wxt.config.ts");
    await writeProjectFile(
      projectRoot,
      "wxt.config.ts",
      'import { defineConfig } from "wxt";\nexport default defineConfig({ modules: [] });\n',
    );
    await expect(readFile(wxtConfigPath, "utf8")).resolves.not.toContain("srcDir");
    await writeProjectFile(projectRoot, "tests/unrelated.ts", "export {};\n");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      "WXT config wxt.config.ts must set a static srcDir outside the project root",
    );
  });

  it("reads a quoted static WXT srcDir", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(
      projectRoot,
      "wxt.config.ts",
      'import { defineConfig } from "wxt";\nexport default defineConfig({ "srcDir": "extension" });\n',
    );
    await writeProjectFile(projectRoot, "extension/entrypoints/background.ts", "export {};\n");
    await writeProjectFile(projectRoot, "src/stale.ts", "export {};\n");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).resolves.toBeUndefined();
  });

  it("resolves index imports with and without a trailing slash", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/background.ts",
      'import "../core/directory";\nimport "../core/trailing/";\n',
    );
    await writeProjectFile(projectRoot, "src/core/directory/index.ts", "export {};\n");
    await writeProjectFile(projectRoot, "src/core/trailing/index.ts", "export {};\n");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).resolves.toBeUndefined();
  });

  it("rejects CSS @import regardless of keyword case or import syntax", async () => {
    const projectRoot = await createTemporaryProject();
    await writeProjectFile(
      projectRoot,
      "src/entrypoints/background.ts",
      'import "../styles/live.css";\n',
    );
    await writeProjectFile(
      projectRoot,
      "src/styles/live.css",
      '@IMPORT url("./dead.css") screen;\n',
    );
    await writeProjectFile(projectRoot, "src/styles/dead.css", ".dead {}\n");

    await expect(assertNoUnreferencedSourceModules(projectRoot)).rejects.toThrow(
      /^Unsupported CSS @import edges:\n- src\/styles\/live\.css$/,
    );
  });
});
