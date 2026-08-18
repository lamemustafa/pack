export type FlatJsonLeafValueKind = "number" | "text";

export interface FlatJsonLeaf {
  path: string;
  valueKind: FlatJsonLeafValueKind;
  value: string;
}

const MAX_JSON_DEPTH = 512;
const MAX_PLAIN_NUMBER_BYTES = 5 * 1024 * 1024;

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
 * but never expanded. JSON numbers are expanded to exact plain decimal text
 * without passing through JavaScript's Number type.
 */
export function flattenJsonTextScalarLeaves(
  input: string,
  maxOutputBytes = Number.POSITIVE_INFINITY,
): FlatJsonLeaf[] {
  return new FlatJsonParser(input, maxOutputBytes).parse();
}

export function jsonNumberTokenToPlainDecimal(
  input: string,
  maxOutputBytes = MAX_PLAIN_NUMBER_BYTES,
): string {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(input);
  if (!match) throw new SyntaxError("Invalid JSON number token.");
  const sign = match[1] ?? "";
  const integerDigits = match[2] ?? "";
  const fractionalDigits = match[3] ?? "";
  const exponentText = match[4] ?? "0";
  if (exponentText.replace(/^[+-]/, "").length > 7) throw new JsonFlatTableLimitError();
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent)) throw new JsonFlatTableLimitError();

  const digits = `${integerDigits}${fractionalDigits}`;
  const decimalIndex = integerDigits.length + exponent;
  const estimatedBytes =
    sign.length +
    (decimalIndex <= 0
      ? 2 + -decimalIndex + digits.length
      : decimalIndex >= digits.length
        ? decimalIndex
        : digits.length + 1);
  const effectiveLimit = Math.min(maxOutputBytes, MAX_PLAIN_NUMBER_BYTES);
  if (estimatedBytes > effectiveLimit) throw new JsonFlatTableLimitError();

  let integerPart: string;
  let fractionalPart: string;
  if (decimalIndex <= 0) {
    integerPart = "0";
    fractionalPart = `${"0".repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    integerPart = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
    fractionalPart = "";
  } else {
    integerPart = digits.slice(0, decimalIndex);
    fractionalPart = digits.slice(decimalIndex);
  }
  integerPart = integerPart.replace(/^0+(?=\d)/, "");
  const plain = `${sign}${integerPart}${fractionalPart ? `.${fractionalPart}` : ""}`;
  if (plain.length > effectiveLimit) throw new JsonFlatTableLimitError();
  return plain;
}

class FlatJsonParser {
  private readonly leaves: FlatJsonLeaf[] = [];
  private readonly encoder = new TextEncoder();
  private activePathBytes = 0;
  private index = 0;
  private outputBytes = 0;

  constructor(
    private readonly input: string,
    private readonly maxOutputBytes: number,
  ) {}

  parse(): FlatJsonLeaf[] {
    this.parseValue("", true, 0);
    this.skipWhitespace();
    if (this.index !== this.input.length) this.fail();
    return this.leaves;
  }

  private parseValue(path: string, emit: boolean, depth: number): void {
    if (depth > MAX_JSON_DEPTH) this.fail();
    this.skipWhitespace();
    const character = this.input[this.index];
    if (character === '"') {
      const value = this.parseString(emit);
      if (emit) this.addLeaf(path, "text", value);
      return;
    }
    if (character === "{") return this.parseObject(path, emit, depth + 1);
    if (character === "[") return this.parseArray(path, emit, depth + 1);
    if (character === "t") return this.parseLiteral("true", path, emit);
    if (character === "f") return this.parseLiteral("false", path, emit);
    if (character === "n") return this.parseLiteral("null", path, emit);
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
    if (emit) this.addLeaf(path, "number", String(elementCount));
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

  private parseLiteral(literal: string, path: string, emit: boolean): void {
    if (!this.input.startsWith(literal, this.index)) this.fail();
    this.index += literal.length;
    if (emit) this.addLeaf(path, "text", literal);
  }

  private parseNumber(path: string, emit: boolean): void {
    const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    numberToken.lastIndex = this.index;
    const match = numberToken.exec(this.input);
    if (!match) this.fail();
    this.index = numberToken.lastIndex;
    if (emit) {
      this.addLeaf(
        path,
        "number",
        jsonNumberTokenToPlainDecimal(match[0], this.maxOutputBytes - this.outputBytes),
      );
    }
  }

  private addLeaf(path: string, valueKind: FlatJsonLeafValueKind, value: string): void {
    const key = path || "/";
    const valueBytes = this.encoder.encode(value).byteLength;
    this.outputBytes += this.encoder.encode(key).byteLength + valueBytes + 4;
    if (this.outputBytes > this.maxOutputBytes) this.limit();
    this.leaves.push({ path: key, valueKind, value });
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
