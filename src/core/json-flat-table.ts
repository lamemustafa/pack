export type FlatJsonLeafValueKind = "number" | "text";
export type FlatJsonArrayCountReason =
  | "array-count-not-selected"
  | "array-count-over-ceiling"
  | "array-count-no-common-discriminator"
  | "array-count-duplicate-discriminator";

export interface FlatJsonLeaf {
  arrayCountReason?: FlatJsonArrayCountReason;
  path: string;
  valueKind: FlatJsonLeafValueKind;
  value: string;
}

export interface FlatJsonArrayExpansionOptions {
  discriminatorKeys: readonly string[];
  eligiblePaths: readonly string[];
  maxElements: number;
}

const MAX_JSON_DEPTH = 512;
const MAX_PLAIN_NUMBER_BYTES = 5 * 1024 * 1024;

export class JsonFlatTableLimitError extends Error {
  constructor() {
    super("Flattened JSON exceeded its local output limit.");
    this.name = "JsonFlatTableLimitError";
  }
}

export class JsonFlatTablePathNotFoundError extends Error {
  constructor() {
    super("Expected JSON object path was not found.");
    this.name = "JsonFlatTablePathNotFoundError";
  }
}

/**
 * Parses and flattens JSON in one pass so arrays and unused containers are not
 * materialized. Object keys use RFC 6901 JSON Pointer paths. Configured small
 * arrays may expand by a shared unique discriminator; every other array stays
 * at its own path as a count with a reason. JSON numbers are expanded to exact
 * plain decimal text without passing through JavaScript's Number type.
 */
export function flattenJsonTextScalarLeaves(
  input: string,
  maxOutputBytes = Number.POSITIVE_INFINITY,
  arrayExpansion?: FlatJsonArrayExpansionOptions,
): FlatJsonLeaf[] {
  return new FlatJsonParser(input, maxOutputBytes, arrayExpansion).parse();
}

export function flattenJsonTextObjectAtPath(
  input: string,
  objectPath: readonly string[],
  maxOutputBytes = Number.POSITIVE_INFINITY,
  arrayExpansion?: FlatJsonArrayExpansionOptions,
): FlatJsonLeaf[] {
  if (objectPath.length === 0) throw new JsonFlatTablePathNotFoundError();
  return new FlatJsonParser(input, maxOutputBytes, arrayExpansion, objectPath).parse();
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

export function flatJsonLeavesApproximateBytes(leaves: readonly FlatJsonLeaf[]): number {
  const encoder = new TextEncoder();
  return leaves.reduce(
    (total, leaf) =>
      total +
      encoder.encode(leaf.path).byteLength +
      encoder.encode(leaf.value).byteLength +
      (leaf.arrayCountReason ? encoder.encode(leaf.arrayCountReason).byteLength : 0) +
      4,
    0,
  );
}

class FlatJsonParser {
  private readonly leaves: FlatJsonLeaf[] = [];
  private readonly encoder = new TextEncoder();
  private readonly eligibleArrayPaths: ReadonlySet<string>;
  private activePathBytes = 0;
  private index = 0;
  private outputBytes = 0;

  constructor(
    private readonly input: string,
    private readonly maxOutputBytes: number,
    private readonly arrayExpansion?: FlatJsonArrayExpansionOptions,
    private readonly objectPath: readonly string[] = [],
  ) {
    this.eligibleArrayPaths = new Set(arrayExpansion?.eligiblePaths ?? []);
  }

  parse(): FlatJsonLeaf[] {
    const found =
      this.objectPath.length === 0
        ? (this.parseValue("", true, 0), true)
        : this.parseObjectPath(0, 0);
    this.skipWhitespace();
    if (this.index !== this.input.length) this.fail();
    if (!found) throw new JsonFlatTablePathNotFoundError();
    return this.leaves;
  }

  private parseObjectPath(segmentIndex: number, depth: number): boolean {
    if (depth > MAX_JSON_DEPTH) this.fail();
    this.skipWhitespace();
    if (this.input[this.index] !== "{") {
      this.parseValue("", false, depth);
      return false;
    }
    const keys = new Set<string>();
    let found = false;
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("}")) return false;
    while (true) {
      this.skipWhitespace();
      if (this.input[this.index] !== '"') this.fail();
      const key = this.parseString(true);
      if (keys.has(key)) this.fail();
      keys.add(key);
      this.skipWhitespace();
      if (!this.consume(":")) this.fail();
      if (key !== this.objectPath[segmentIndex]) {
        this.parseValue("", false, depth + 1);
      } else if (segmentIndex < this.objectPath.length - 1) {
        found = this.parseObjectPath(segmentIndex + 1, depth + 1) || found;
      } else {
        this.skipWhitespace();
        if (this.input[this.index] === "{") {
          this.parseObject("", true, depth + 1);
          found = true;
        } else {
          this.parseValue("", false, depth + 1);
        }
      }
      this.skipWhitespace();
      if (this.consume("}")) return found;
      if (!this.consume(",")) this.fail();
    }
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
    const elementSpans: Array<readonly [number, number]> = [];
    const eligible = emit && this.eligibleArrayPaths.has(path);
    this.index += 1;
    this.skipWhitespace();
    if (!this.consume("]")) {
      while (true) {
        const elementStart = this.index;
        this.parseValue("", false, depth);
        elementCount += 1;
        if (eligible && elementCount <= (this.arrayExpansion?.maxElements ?? 0)) {
          elementSpans.push([elementStart, this.index]);
        }
        this.skipWhitespace();
        if (this.consume("]")) break;
        if (!this.consume(",")) this.fail();
        this.skipWhitespace();
      }
    }
    if (!emit) return;
    if (!eligible) {
      this.addArrayCount(path, elementCount, "array-count-not-selected");
      return;
    }
    if (elementCount > (this.arrayExpansion?.maxElements ?? 0)) {
      this.addArrayCount(path, elementCount, "array-count-over-ceiling");
      return;
    }
    if (elementCount === 0) {
      this.addArrayCount(path, elementCount, "array-count-no-common-discriminator");
      return;
    }
    const elements: FlatJsonLeaf[][] = [];
    let retainedElementBytes = 0;
    for (const [start, end] of elementSpans) {
      const leaves = new FlatJsonParser(
        this.input.slice(start, end),
        this.remainingBytes() - retainedElementBytes,
      ).parse();
      retainedElementBytes += flatJsonLeavesApproximateBytes(leaves);
      if (retainedElementBytes > this.remainingBytes()) this.limit();
      elements.push(leaves);
    }
    const discriminator = this.selectArrayDiscriminator(elements);
    if (!discriminator) {
      const hasDuplicateCandidate = this.hasCommonDuplicateDiscriminator(elements);
      this.addArrayCount(
        path,
        elementCount,
        hasDuplicateCandidate
          ? "array-count-duplicate-discriminator"
          : "array-count-no-common-discriminator",
      );
      return;
    }
    elements.forEach((leaves, index) => {
      const discriminatorValue = discriminator.values[index]!;
      const discriminatorBytes = this.encoder.encode(discriminatorValue).byteLength;
      if (discriminatorBytes * 2 + this.encoder.encode(path).byteLength > this.remainingBytes()) {
        this.limit();
      }
      const elementPath = `${path}/${escapeJsonPointerToken(discriminatorValue)}`;
      for (const leaf of leaves) {
        if (leaf.path === discriminator.pointer) continue;
        this.addLeaf(
          `${elementPath}${leaf.path}`,
          leaf.valueKind,
          leaf.value,
          leaf.arrayCountReason,
        );
      }
    });
  }

  private selectArrayDiscriminator(
    elements: readonly (readonly FlatJsonLeaf[])[],
  ): { pointer: string; values: string[] } | null {
    for (const key of this.arrayExpansion?.discriminatorKeys ?? []) {
      const pointer = `/${escapeJsonPointerToken(key)}`;
      const values = elements.map((leaves) => discriminatorValue(leaves, pointer));
      if (values.some((value) => value === null)) continue;
      const presentValues = values as string[];
      if (new Set(presentValues).size === presentValues.length) {
        return { pointer, values: presentValues };
      }
    }
    return null;
  }

  private hasCommonDuplicateDiscriminator(elements: readonly (readonly FlatJsonLeaf[])[]): boolean {
    return (this.arrayExpansion?.discriminatorKeys ?? []).some((key) => {
      const pointer = `/${escapeJsonPointerToken(key)}`;
      const values = elements.map((leaves) => discriminatorValue(leaves, pointer));
      return (
        values.every((value) => value !== null) &&
        new Set(values as string[]).size !== values.length
      );
    });
  }

  private addArrayCount(path: string, count: number, reason: FlatJsonArrayCountReason): void {
    this.addLeaf(path, "number", String(count), reason);
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

  private addLeaf(
    path: string,
    valueKind: FlatJsonLeafValueKind,
    value: string,
    arrayCountReason?: FlatJsonArrayCountReason,
  ): void {
    const key = path;
    const valueBytes = this.encoder.encode(value).byteLength;
    const reasonBytes = arrayCountReason ? this.encoder.encode(arrayCountReason).byteLength : 0;
    this.outputBytes += this.encoder.encode(key).byteLength + valueBytes + reasonBytes + 4;
    if (this.outputBytes > this.maxOutputBytes) this.limit();
    this.leaves.push({
      ...(arrayCountReason ? { arrayCountReason } : {}),
      path: key,
      valueKind,
      value,
    });
  }

  private remainingBytes(): number {
    return this.maxOutputBytes - this.outputBytes;
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

function discriminatorValue(leaves: readonly FlatJsonLeaf[], pointer: string): string | null {
  const leaf = leaves.find((candidate) => candidate.path === pointer);
  if (!leaf || leaf.arrayCountReason || leaf.value.length === 0) return null;
  if (leaf.valueKind === "text" && ["true", "false", "null"].includes(leaf.value)) return null;
  return leaf.value;
}
