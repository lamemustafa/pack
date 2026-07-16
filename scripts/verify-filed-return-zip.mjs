import { readFile } from "node:fs/promises";
import os from "node:os";
import {
  sanitizeVerificationResult,
  verifyFiledReturnZipBytes,
} from "./lib/filed-return-zip-verifier.mjs";

const SUPPORTED_RETURN_TYPES = new Set(["GSTR-1", "GSTR-2B", "GSTR-3B"]);

try {
  const { returnType, zipPath } = parseArgs(process.argv.slice(2));
  if (!zipPath) {
    throw new Error(
      "Usage: node scripts/verify-filed-return-zip.mjs [--return-type GSTR-2B] <zip-path>",
    );
  }

  const bytes = new Uint8Array(await readFile(zipPath));
  const result = sanitizeVerificationResult(
    verifyFiledReturnZipBytes(bytes, {
      returnType: returnType ?? inferReturnTypeFromPath(zipPath),
    }),
  );
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

function parseArgs(args) {
  let returnType = null;
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--return-type") {
      returnType = args[index + 1] ?? null;
      if (!returnType || !SUPPORTED_RETURN_TYPES.has(returnType)) {
        throw new Error("--return-type must be one of GSTR-1, GSTR-2B, or GSTR-3B.");
      }
      index += 1;
      continue;
    }
    positional.push(arg);
  }
  return { returnType, zipPath: positional[0] ?? null };
}

function inferReturnTypeFromPath(zipPath) {
  return /gstr[-_\s]?2b/i.test(zipPath) ? "GSTR-2B" : "UNKNOWN";
}
