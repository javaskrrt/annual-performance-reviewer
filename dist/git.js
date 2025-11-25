import { spawn } from "child_process";
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
export async function git(repoPath, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn("git", args, {
            cwd: repoPath,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data) => {
            stdout += data.toString();
        });
        proc.stderr.on("data", (data) => {
            stderr += data.toString();
        });
        proc.on("close", (exitCode) => {
            if (exitCode !== 0) {
                reject(new Error(`git ${args.join(" ")} failed in ${repoPath}:\n${stderr || stdout}`));
            }
            else {
                resolve(stdout.trim());
            }
        });
        proc.on("error", (err) => {
            reject(err);
        });
    });
}
/** Check if a folder is a git repo. */
export async function isGitRepo(path) {
    try {
        await git(path, ["rev-parse", "--is-inside-work-tree"]);
        return true;
    }
    catch {
        return false;
    }
}
/** Get unique author emails from repo history. */
export async function getAuthorEmails(repoPath) {
    const out = await git(repoPath, ["log", "--all", "--format=%ae"]);
    const emails = out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    return Array.from(new Set(emails)).sort();
}
/** Get commits from repo, optionally filtering by author emails. */
export async function getCommits(repoPath) {
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
        const [hash, authorName, authorEmail, dateISO, subject, ...bodyLines] = lines;
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
