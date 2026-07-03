import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

try {
  const outputDir = path.join(process.cwd(), ".output");
  const explicitZip = process.argv[2];
  const zipPath = explicitZip ? path.resolve(explicitZip) : await findSingleChromeZip(outputDir);
  const extractionDir = path.join(outputDir, "chrome-mv3-zip-check");

  await rm(extractionDir, { force: true, recursive: true });
  await mkdir(extractionDir, { recursive: true });
  await run("unzip", ["-q", zipPath, "-d", extractionDir]);
  await run("node", ["scripts/verify-extension-package.mjs", extractionDir]);
  await run("shasum", ["-a", "256", zipPath]);
  await run("node", ["scripts/verify-extension-browser.mjs", extractionDir]);

  console.log(`Pack exact ZIP verification passed: ${path.relative(process.cwd(), zipPath)}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Pack exact ZIP verification failed: ${sanitizeOutput(message)}`);
  process.exit(1);
}

async function findSingleChromeZip(dir) {
  const entries = await readdir(dir);
  const zipFiles = entries
    .filter((entry) => entry.endsWith(".zip") && entry.includes("chrome"))
    .map((entry) => path.join(dir, entry));
  if (zipFiles.length !== 1) {
    throw new Error(
      `Expected exactly one Chrome ZIP in ${path.relative(process.cwd(), dir)}, found ${zipFiles.length}.`,
    );
  }
  return zipFiles[0];
}

async function run(command, args) {
  const result = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  result.stdout.on("data", (chunk) => {
    process.stdout.write(sanitizeOutput(String(chunk)));
  });
  result.stderr.on("data", (chunk) => {
    process.stderr.write(sanitizeOutput(String(chunk)));
  });
  const exitCode = await new Promise((resolve, reject) => {
    result.once("error", reject);
    result.once("exit", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(
      `${command} ${args.map((arg) => symbolic(arg)).join(" ")} failed with ${exitCode}.`,
    );
  }
}

function sanitizeOutput(value) {
  return symbolic(value).replaceAll(os.homedir(), "<HOME>");
}

function symbolic(value) {
  return value.replaceAll(process.cwd(), "<PACK_ROOT>");
}
