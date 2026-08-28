import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { parseDurableFiledReturnsSignals } from "../../src/connectors/gst/filed-returns-durable-signals";

// Static array literals supplement the runtime family/round-trip tests. Dynamic
// builders remain covered at their emitted boundary, not guessed by this scan.
function literalSignals(expression: ts.Expression): string[] {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) =>
      ts.isSpreadElement(element) ? literalSignals(element.expression) : literalSignals(element),
    );
  }
  if (ts.isConditionalExpression(expression)) {
    return [...literalSignals(expression.whenTrue), ...literalSignals(expression.whenFalse)];
  }
  if (ts.isParenthesizedExpression(expression)) return literalSignals(expression.expression);
  return [];
}

it("registers literal signals emitted in filed-return flow result arrays", () => {
  const rejected: { file: string; signal: string }[] = [];
  let checked = 0;
  for (const directory of ["src/background", "src/connectors/gst"]) {
    for (const file of readdirSync(directory)) {
      if (!file.startsWith("filed-returns-") || !file.endsWith(".ts")) continue;
      const source = ts.createSourceFile(
        file,
        readFileSync(join(directory, file), "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === "safeSignals") {
          for (const signal of new Set(literalSignals(node.initializer))) {
            checked += 1;
            if (!parseDurableFiledReturnsSignals([signal])) rejected.push({ file, signal });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  expect(checked).toBeGreaterThan(100);
  expect(rejected, "an emitted literal must not erase its whole durable signal array").toEqual([]);
});
