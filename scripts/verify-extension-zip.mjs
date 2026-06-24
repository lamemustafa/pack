import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const outputDir = path.join(process.cwd(), ".output");
const explicitZip = process.argv[2];
const zipPath = explicitZip ? path.resolve(explicitZip) : await findSingleChromeZip(outputDir);
const extractionDir = path.join(outputDir, "chrome-mv3-zip-check");

await rm(extractionDir, { force: true, recursive: true });
await mkdir(extractionDir, { recursive: true });
await run("unzip", ["-q", zipPath, "-d", extractionDir]);
await run("node", ["scripts/verify-extension-package.mjs", extractionDir]);
await run("shasum", ["-a", "256", zipPath]);

console.log(`Pack exact ZIP verification passed: ${path.relative(process.cwd(), zipPath)}`);

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
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve, reject) => {
    result.once("error", reject);
    result.once("exit", resolve);
  });
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${exitCode}.`);
}
