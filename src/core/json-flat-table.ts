import type { CsvCellValue } from "./csv";

export type FlatJsonRow = Record<string, CsvCellValue>;

const MAX_JSON_DEPTH = 512;

export class JsonFlatTableLimitError extends Error {
  constructor() {
    super("Flattened JSON exceeded its local output limit.");
    this.name = "JsonFlatTableLimitError";
  }
}

/**
 * Parses and flattens JSON in one pass so arrays and unused containers are not
 * materialized. Object keys use RFC 6901 JSON Pointer paths. Arrays stay at
 * their own path and become their element count; their contents are validated
 * but never expanded. Number tokens become apostrophe-prefixed text so their
 * exact portal spelling survives spreadsheet import without JS rounding.
 */
export function flattenJsonTextScalarLeaves(
  input: string,
  maxOutputBytes = Number.POSITIVE_INFINITY,
): FlatJsonRow {
  return new FlatJsonParser(input, maxOutputBytes).parse();
}

class FlatJsonParser {
  private readonly row: FlatJsonRow = {};
  private readonly encoder = new TextEncoder();
  private activePathBytes = 0;
  private index = 0;
  private outputBytes = 0;

  constructor(
    private readonly input: string,
    private readonly maxOutputBytes: number,
  ) {}

  parse(): FlatJsonRow {
    this.parseValue("", true, 0);
    this.skipWhitespace();
    if (this.index !== this.input.length) this.fail();
    return this.row;
  }

  private parseValue(path: string, emit: boolean, depth: number): void {
    if (depth > MAX_JSON_DEPTH) this.fail();
    this.skipWhitespace();
    const character = this.input[this.index];
    if (character === '"') {
      const value = this.parseString(emit);
      if (emit) this.addCell(path, value);
      return;
    }
    if (character === "{") return this.parseObject(path, emit, depth + 1);
    if (character === "[") return this.parseArray(path, emit, depth + 1);
    if (character === "t") return this.parseLiteral("true", true, path, emit);
    if (character === "f") return this.parseLiteral("false", false, path, emit);
    if (character === "n") return this.parseLiteral("null", null, path, emit);
    this.parseNumber(path, emit);
  }

  private parseObject(path: string, emit: boolean, depth: number): void {
    const keys = new Set<string>();
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("}")) return;
    while (true) {
      this.skipWhitespace();
      if (this.input[this.index] !== '"') this.fail();
      const key = this.parseString(emit);
      if (emit && keys.has(key)) this.fail();
      if (emit) keys.add(key);
      this.skipWhitespace();
      if (!this.consume(":")) this.fail();
      if (emit) {
        const parentBytes = this.encoder.encode(path).byteLength;
        const keyBytes = this.encoder.encode(key).byteLength;
        if (this.activePathBytes + parentBytes + 1 + keyBytes * 2 > this.maxOutputBytes) {
          this.limit();
        }
        const nextPath = `${path}/${escapeJsonPointerToken(key)}`;
        const nextPathBytes = this.encoder.encode(nextPath).byteLength;
        this.activePathBytes += nextPathBytes;
        try {
          this.parseValue(nextPath, true, depth);
        } finally {
          this.activePathBytes -= nextPathBytes;
        }
      } else {
        this.parseValue("", false, depth);
      }
      this.skipWhitespace();
      if (this.consume("}")) return;
      if (!this.consume(",")) this.fail();
    }
  }

  private parseArray(path: string, emit: boolean, depth: number): void {
    let elementCount = 0;
    this.index += 1;
    this.skipWhitespace();
    if (!this.consume("]")) {
      while (true) {
        this.parseValue("", false, depth);
        elementCount += 1;
        this.skipWhitespace();
        if (this.consume("]")) break;
        if (!this.consume(",")) this.fail();
      }
    }
    if (emit) this.addCell(path, elementCount);
  }

  private parseString(decode: boolean): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.input.length) {
      const character = this.input[this.index++];
      if (character === "\\") {
        const escape = this.input[this.index++];
        if (escape === "u") {
          const codePoint = this.input.slice(this.index, this.index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(codePoint)) this.fail();
          this.index += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) {
          this.fail();
        }
        continue;
      }
      if ((character?.charCodeAt(0) ?? 0) < 0x20) this.fail();
      if (character === '"') {
        if (!decode) return "";
        if (this.index - start > this.maxOutputBytes) this.limit();
        const parsed = JSON.parse(this.input.slice(start, this.index)) as unknown;
        if (typeof parsed !== "string") this.fail();
        return parsed;
      }
    }
    return this.fail();
  }

  private parseLiteral(literal: string, value: boolean | null, path: string, emit: boolean): void {
    if (!this.input.startsWith(literal, this.index)) this.fail();
    this.index += literal.length;
    if (emit) this.addCell(path, value);
  }

  private parseNumber(path: string, emit: boolean): void {
    const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    numberToken.lastIndex = this.index;
    const match = numberToken.exec(this.input);
    if (!match) this.fail();
    this.index = numberToken.lastIndex;
    if (emit) this.addCell(path, `'${match[0]}`);
  }

  private addCell(path: string, value: CsvCellValue): void {
    const key = path || "/";
    const valueBytes = this.encoder.encode(value === null ? "null" : String(value)).byteLength;
    this.outputBytes += this.encoder.encode(key).byteLength + valueBytes + 4;
    if (this.outputBytes > this.maxOutputBytes) this.limit();
    this.row[key] = value;
  }

  private skipWhitespace(): void {
    while (/^[\t\n\r ]$/.test(this.input[this.index] ?? "")) this.index += 1;
  }

  private consume(expected: string): boolean {
    if (this.input[this.index] !== expected) return false;
    this.index += 1;
    return true;
  }

  private fail(): never {
    throw new SyntaxError("Invalid JSON input.");
  }

  private limit(): never {
    throw new JsonFlatTableLimitError();
  }
}

function escapeJsonPointerToken(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}
