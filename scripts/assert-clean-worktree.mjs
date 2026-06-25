import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"]);

if (stdout.trim().length > 0) {
  process.stdout.write(stdout);
  process.stderr.write("Release requires a clean worktree.\n");
  process.exit(1);
}

console.log("Pack release worktree is clean.");
