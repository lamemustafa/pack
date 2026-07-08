import { readFile } from "node:fs/promises";
import os from "node:os";
import {
  sanitizeVerificationResult,
  verifyFiledReturnZipBytes,
} from "./lib/filed-return-zip-verifier.mjs";

try {
  const zipPath = process.argv[2];
  if (!zipPath) {
    throw new Error("Usage: node scripts/verify-filed-return-zip.mjs <zip-path>");
  }

  const bytes = new Uint8Array(await readFile(zipPath));
  const result = sanitizeVerificationResult(verifyFiledReturnZipBytes(bytes));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Filed-return ZIP verification failed: ${sanitizeOutput(message)}`);
  process.exit(1);
}

function sanitizeOutput(value) {
  return value.replaceAll(process.cwd(), "<PACK_ROOT>").replaceAll(os.homedir(), "<HOME>");
}
