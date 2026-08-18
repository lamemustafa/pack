import { execFileSync } from "node:child_process";
export const DEFAULT_GH_RETRY_ATTEMPTS = 6;
export const DEFAULT_GH_RETRY_BACKOFF_MS = 10_000;
const MAX_GH_RETRY_BACKOFF_MS = 60_000;
const TRANSIENT_GH_FAILURE_PATTERN =
  /\b(?:HTTP\s+(?:429|500|502|503|504)|(?:secondary\s+)?rate limit(?:ed|ing)?|ETIMEDOUT|timeout|timed out|context deadline exceeded|deadline exceeded|ECONNRESET|connection reset|ENOTFOUND|EAI_AGAIN|getaddrinfo|could not resolve host|no such host|temporary failure in name resolution)\b/iu;

export function runGhText(commandArgs, options = {}) {
  const {
    attempts = DEFAULT_GH_RETRY_ATTEMPTS,
    backoffMs = DEFAULT_GH_RETRY_BACKOFF_MS,
    operation = "operation",
  } = options;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return execFileSync("gh", commandArgs, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      const detail =
        String(error?.stderr ?? "").trim() ||
        (error instanceof Error ? error.message : String(error));
      const evidence = [error?.code, error?.signal, detail].filter(Boolean).join("\n");
      if (!TRANSIENT_GH_FAILURE_PATTERN.test(evidence)) {
        throw new Error(`GitHub CLI failed without a retryable error: ${detail}`);
      }
      if (attempt >= attempts) {
        throw new Error(`GitHub CLI ${operation} failed after ${attempts} attempts: ${detail}`);
      }
      const delay = Math.min(backoffMs * 2 ** Math.min(attempt - 1, 20), MAX_GH_RETRY_BACKOFF_MS);
      console.warn(
        `GitHub CLI transient failure on attempt ${attempt}/${attempts}: ${detail}. Retrying in ${delay}ms.`,
      );
      if (delay > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    }
  }
  throw new Error(`GitHub CLI ${operation} ended without a result.`);
}
