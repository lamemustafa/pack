#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const evidencePath = process.argv[2] ?? process.env.PACK_LIVE_EVIDENCE_PATH;
if (!evidencePath) {
  console.error("Pack live evidence validation failed: pass an evidence JSON path.");
  process.exit(1);
}

const vitestBin = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vitest.cmd" : "vitest",
);
if (!existsSync(vitestBin)) {
  console.error("Pack live evidence validation failed: run pnpm install first.");
  process.exit(1);
}

const child = spawn(vitestBin, ["run", "tests/core/live-run-evidence-file.test.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PACK_LIVE_EVIDENCE_PATH: path.resolve(evidencePath),
    PACK_VALIDATE_EVIDENCE_REQUIRED: "true",
  },
  stdio: "inherit",
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});

process.exit(exitCode ?? 1);
