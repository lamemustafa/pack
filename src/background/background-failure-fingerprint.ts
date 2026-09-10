// Enough to name a thrown failure, and nothing that could carry portal text.
//
// An error's message is not safe to render: it can quote a page, a URL, or a field value. Its
// class name and the innermost stack symbol come from this bundle's own code, so they identify
// where a failure happened without repeating anything the portal said. Both are filtered to a
// strict symbol charset, so a thrown non-Error — or an error with a doctored name — cannot smuggle
// text through either.
//
// This exists because a discarded error cost three separate round trips to locate, each needing a
// build and a live authenticated run. The panel gets the fingerprint; the console gets the error.
const SYMBOL_CHARSET = /[^A-Za-z0-9_.:$-]/gu;

function safeSymbol(value: string): string {
  return value.replace(SYMBOL_CHARSET, "").slice(0, 60);
}

export function backgroundFailureFingerprint(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  const name = safeSymbol(error.name || "Error");
  const frame =
    typeof error.stack === "string"
      ? (error.stack
          .split("\n")
          .slice(1)
          .map((line) => /at\s+([^\s(]+)/u.exec(line)?.[1])
          .find((symbol) => symbol && !symbol.startsWith("chrome-extension")) ?? "")
      : "";
  const symbol = safeSymbol(frame);
  return symbol ? `${name} at ${symbol}` : name;
}
