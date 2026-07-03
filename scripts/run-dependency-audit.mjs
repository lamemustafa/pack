#!/usr/bin/env node
import { spawn } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";

const DEFAULT_TIMEOUT_MS = 120_000;
const timeoutMs = parseTimeout(process.env.PACK_AUDIT_TIMEOUT_MS);
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const args = ["audit", "--audit-level", "high"];

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
}, timeoutMs);

child.stdout.on("data", (chunk) => process.stdout.write(chunk));
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
clearTimeout(timer);

if (timedOut) {
  console.error(
    `Pack dependency audit timed out after ${timeoutMs}ms. Run from an approved network-capable shell or CI and keep the audit result with release evidence.`,
  );
  process.exit(124);
}

process.exit(exitCode ?? 1);

function parseTimeout(value) {
  if (!value) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1_000) {
    throw new Error("PACK_AUDIT_TIMEOUT_MS must be a number of milliseconds >= 1000.");
  }
  return Math.floor(parsed);
}
