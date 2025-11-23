import { Commit } from "./types";

const GIT_PRETTY_FORMAT = [
  "%H", // hash
  "%an", // author name
  "%ae", // author email
  "%aI", // author date strict ISO 8601
  "%s", // subject
  "%b" // body
].join("%n");

const COMMIT_SEPARATOR = "\n---JAVASKRRT_COMMIT_SEPARATOR---\n";

/** Run a git command in a directory. */
export async function git(repoPath: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe"
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${repoPath}:\n${stderr || stdout}`
    );
  }
  return stdout.trim();
}

/** Check if a folder is a git repo. */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await git(path, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/** Get unique author emails from repo history. */
export async function getAuthorEmails(repoPath: string): Promise<string[]> {
  const out = await git(repoPath, ["log", "--all", "--format=%ae"]);
  const emails = out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return Array.from(new Set(emails)).sort();
}

/** Get commits from repo, optionally filtering by author emails. */
export async function getCommits(
  repoPath: string
): Promise<Omit<Commit, "repoName" | "repoPath">[]> {
  const out = await git(repoPath, [
    "log",
    "--all",
    `--pretty=format:${GIT_PRETTY_FORMAT}${COMMIT_SEPARATOR}`
  ]);

  const rawCommits = out
    .split(COMMIT_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);

  return rawCommits.map((block) => {
    const lines = block.split("\n");

    const [hash, authorName, authorEmail, dateISO, subject, ...bodyLines] =
      lines;
    return {
      hash,
      authorName: authorName ?? "",
      authorEmail: authorEmail ?? "",
      dateISO: dateISO ?? "",
      subject: subject ?? "",
      body: bodyLines.join("\n").trim()
    };
  });
}
