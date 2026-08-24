import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const UNREFERENCED_SOURCE_MODULE_ALLOWLIST: readonly {
  path: string;
  reason: string;
}[] = [];

const temporaryProjects: string[] = [];

function canonicalPath(path: string): string {
  const absolutePath = resolve(path);
  return ts.sys.useCaseSensitiveFileNames ? absolutePath : absolutePath.toLowerCase();
}

function projectPath(projectRoot: string, filePath: string): string {
  return relative(projectRoot, filePath).split(sep).join("/");
}

async function sourceFilesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFilesIn(entryPath);
      return SOURCE_EXTENSIONS.has(extname(entry.name)) && !entry.name.endsWith(".d.ts")
        ? [entryPath]
        : [];
    }),
  );
  return nested.flat();
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
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

async function assertNoUnreferencedSourceModules(projectRoot = process.cwd()): Promise<void> {
  const sourceDirectory = join(projectRoot, "src");
  const sourceFiles = await sourceFilesIn(sourceDirectory);
  const filesByPath = new Map(sourceFiles.map((filePath) => [canonicalPath(filePath), filePath]));
  const importersByPath = new Map(
    sourceFiles.map((filePath) => [canonicalPath(filePath), new Set<string>()]),
  );
  const compilerOptions = compilerOptionsFor(projectRoot);

  for (const sourcePath of sourceFiles) {
    const sourceText = await readFile(sourcePath, "utf8");
    const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true);
    for (const specifier of moduleSpecifiers(sourceFile)) {
      const resolvedModule = ts.resolveModuleName(
        specifier,
        sourcePath,
        compilerOptions,
        ts.sys,
      ).resolvedModule;
      if (!resolvedModule) continue;

      const targetPath = canonicalPath(resolvedModule.resolvedFileName);
      if (filesByPath.has(targetPath)) importersByPath.get(targetPath)?.add(sourcePath);
    }
  }

  const rootPaths = new Set(
    sourceFiles
      .filter((filePath) => projectPath(projectRoot, filePath).startsWith("src/entrypoints/"))
      .map(canonicalPath),
  );
  const manifestPolicyPath = join(sourceDirectory, "extension", "manifest-policy.ts");
  if (filesByPath.has(canonicalPath(manifestPolicyPath)))
    rootPaths.add(canonicalPath(manifestPolicyPath));

  const allowlistedPaths = new Set<string>();
  for (const entry of UNREFERENCED_SOURCE_MODULE_ALLOWLIST) {
    if (!entry.reason.trim()) throw new Error(`Missing allowlist reason for ${entry.path}`);
    allowlistedPaths.add(canonicalPath(join(projectRoot, entry.path)));
  }

  const unreferenced = sourceFiles
    .filter((filePath) => {
      const canonicalFilePath = canonicalPath(filePath);
      return (
        !rootPaths.has(canonicalFilePath) &&
        !allowlistedPaths.has(canonicalFilePath) &&
        importersByPath.get(canonicalFilePath)?.size === 0
      );
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
    const projectRoot = await mkdtemp(join(tmpdir(), "pack-unreferenced-module-"));
    temporaryProjects.push(projectRoot);
    await writeProjectFile(
      projectRoot,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    );
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
});
