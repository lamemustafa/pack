// Enough to name a thrown failure, and nothing that could carry portal text.
//
// An error's message is not safe to render: it can quote a page, a URL, or a field value. Its
// class name and the innermost stack symbol can name where a failure happened without repeating
// anything the portal said -- but only if each is established to be this bundle's, rather than
// merely made to look harmless.
//
// Stripping punctuation was the earlier approach and it was worse than no filter: a frame pointing
// at a portal URL came back with its slashes deleted, so the value *looked* like a symbol
// precisely because the characters that would have exposed it were gone. A filter that launders
// its input is not a guard.
//
// This exists because a discarded error cost three separate round trips to locate, each needing a
// build and a live authenticated run.

// A frame names a place in this bundle only when the file it points at is this bundle's. The
// symbol is what is kept; the URL is what proves the symbol is ours, and it is never kept. An
// anonymous frame has no symbol to take, and a frame from anywhere else does not match at all.
const BUNDLE_FRAME = /^\s*at\s+(?:async\s+)?([A-Za-z_$][\w$.]{0,59})\s+\(chrome-extension:\/\//u;

// Every error class in this bundle ends in `Error`, as do the platform's own; `DOMException` is
// the one exception the platform makes. Letters and that suffix cannot spell a GSTIN, an ARN, or
// a URL, and a name that fails the shape degrades to `Error` rather than being laundered into one.
const BUNDLE_ERROR_NAME = /^[A-Za-z]{1,40}Error$/u;

function safeErrorName(name: string): string {
  if (name === "DOMException") return name;
  return BUNDLE_ERROR_NAME.test(name) ? name : "Error";
}

export function backgroundFailureFingerprint(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  const name = safeErrorName(error.name || "Error");
  const symbol =
    typeof error.stack === "string"
      ? (error.stack
          .split("\n")
          .slice(1)
          .map((line) => BUNDLE_FRAME.exec(line)?.[1])
          .find(Boolean) ?? "")
      : "";
  return symbol ? `${name} at ${symbol}` : name;
}
