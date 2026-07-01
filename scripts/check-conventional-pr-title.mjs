const title = process.env.PR_TITLE?.trim() ?? process.argv.slice(2).join(" ").trim();

if (!title) {
  throw new Error("Missing PR title. Set PR_TITLE or pass the title as arguments.");
}

const allowedTypes = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "test",
];
const pattern = new RegExp(`^(${allowedTypes.join("|")})(\\([a-z0-9][a-z0-9-]*\\))?!?: .{8,}$`);

if (!pattern.test(title)) {
  throw new Error(
    [
      "PR title must use Conventional Commits so Release Please can version Pack releases.",
      `Received: ${title}`,
      "Example: feat(release): automate Pack GitHub and Chrome Web Store releases",
    ].join("\n"),
  );
}

console.log(`Conventional PR title ok: ${title}`);
