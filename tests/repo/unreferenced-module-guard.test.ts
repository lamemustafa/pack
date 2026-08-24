import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
const UNREFERENCED_SOURCE_MODULE_ALLOWLIST: readonly {
  path: string;
  reason: string;
}[] = [
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
  return filesIn(
    directory,
    (name) => SOURCE_EXTENSIONS.has(extname(name)) && !name.endsWith(".d.ts"),
  );
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

function cssImportSpecifiers(sourceText: string): string[] {
  return Array.from(
    sourceText.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s)]+))/g),
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  ).filter(Boolean);
}

function moduleSpecifiers(filePath: string, sourceText: string): string[] {
  if (extname(filePath) === ".css") return cssImportSpecifiers(sourceText);
  return typescriptModuleSpecifiers(
    ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true),
  );
}

function compilerOptionsFor(projectRoot: string): ts.CompilerOptions {
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
  return parsed.options;
}

function sourcePathForSpecifier(
  specifier: string,
  importerPath: string,
  compilerOptions: ts.CompilerOptions,
  filesByPath: ReadonlyMap<string, string>,
): string | undefined {
  const resolvedModule = ts.resolveModuleName(
    specifier,
    importerPath,
    compilerOptions,
    ts.sys,
  ).resolvedModule;
  if (resolvedModule) {
    const resolvedPath = canonicalPath(resolvedModule.resolvedFileName);
    if (filesByPath.has(resolvedPath)) return resolvedPath;
  }

  const relativeSpecifier = specifier.split(/[?#]/, 1)[0];
  if (!relativeSpecifier?.startsWith(".")) return undefined;
  const candidatePath = canonicalPath(resolve(dirname(importerPath), relativeSpecifier));
  return filesByPath.has(candidatePath) ? candidatePath : undefined;
}

function isWxtEntrypoint(projectRoot: string, filePath: string): boolean {
  const path = projectPath(projectRoot, filePath);
  return (
    /^src\/entrypoints\/(?:background|content)\.(?:ts|tsx)$/.test(path) ||
    /^src\/entrypoints\/[^/]+\/main\.(?:ts|tsx)$/.test(path)
  );
}

function htmlEntrypointSpecifiers(html: string): string[] {
  const specifiers: string[] = [];
  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const [, tagName, attributes] = match;
    if (!tagName || !attributes) continue;
    const isModuleScript = tagName === "script" && /\btype\s*=\s*["']module["']/i.test(attributes);
    const isStylesheet = tagName === "link" && /\brel\s*=\s*["']stylesheet["']/i.test(attributes);
    const reference = attributes.match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i)?.[1];
    if ((isModuleScript || isStylesheet) && reference) specifiers.push(reference);
  }
  return specifiers;
}

async function rootPathsFor(
  projectRoot: string,
  sourceDirectory: string,
  sourceFiles: readonly string[],
  compilerOptions: ts.CompilerOptions,
  filesByPath: ReadonlyMap<string, string>,
): Promise<Set<string>> {
  const rootPaths = new Set(
    sourceFiles.filter((filePath) => isWxtEntrypoint(projectRoot, filePath)).map(canonicalPath),
  );
  const entrypointDirectory = join(sourceDirectory, "entrypoints");
  const htmlEntrypoints = await filesIn(entrypointDirectory, (name) => name === "index.html");
  for (const htmlPath of htmlEntrypoints) {
    const html = await readFile(htmlPath, "utf8");
    for (const specifier of htmlEntrypointSpecifiers(html)) {
      const rootPath = sourcePathForSpecifier(specifier, htmlPath, compilerOptions, filesByPath);
      if (rootPath) rootPaths.add(rootPath);
    }
  }

  const manifestPolicyPath = join(sourceDirectory, "extension", "manifest-policy.ts");
  const canonicalManifestPolicyPath = canonicalPath(manifestPolicyPath);
  if (filesByPath.has(canonicalManifestPolicyPath)) {
    const wxtConfigPath = join(projectRoot, "wxt.config.ts");
    const configText = await readFile(wxtConfigPath, "utf8");
    const importsManifestPolicy = moduleSpecifiers(wxtConfigPath, configText).some(
      (specifier) =>
        sourcePathForSpecifier(specifier, wxtConfigPath, compilerOptions, filesByPath) ===
        canonicalManifestPolicyPath,
    );
    if (importsManifestPolicy) rootPaths.add(canonicalManifestPolicyPath);
  }

  return rootPaths;
}

async function assertNoUnreferencedSourceModules(projectRoot = process.cwd()): Promise<void> {
  const sourceDirectory = join(projectRoot, "src");
  const sourceFiles = await sourceFilesIn(sourceDirectory);
  const filesByPath = new Map(sourceFiles.map((filePath) => [canonicalPath(filePath), filePath]));
  const dependenciesByPath = new Map(
    sourceFiles.map((filePath) => [canonicalPath(filePath), new Set<string>()]),
  );
  const compilerOptions = compilerOptionsFor(projectRoot);

  for (const sourcePath of sourceFiles) {
    const sourceText = await readFile(sourcePath, "utf8");
    for (const specifier of moduleSpecifiers(sourcePath, sourceText)) {
      const targetPath = sourcePathForSpecifier(
        specifier,
        sourcePath,
        compilerOptions,
        filesByPath,
      );
      if (targetPath) dependenciesByPath.get(canonicalPath(sourcePath))?.add(targetPath);
    }
  }

  const rootPaths = await rootPathsFor(
    projectRoot,
    sourceDirectory,
    sourceFiles,
    compilerOptions,
    filesByPath,
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
  for (const entry of UNREFERENCED_SOURCE_MODULE_ALLOWLIST) {
    if (!entry.reason.trim()) throw new Error(`Missing allowlist reason for ${entry.path}`);
    allowlistedPaths.add(canonicalPath(join(projectRoot, entry.path)));
  }

  const unreferenced = sourceFiles
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
});
