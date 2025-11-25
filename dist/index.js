#!/usr/bin/env node
import prompts from "prompts";
import ora from "ora";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
const execFileAsync = promisify(execFile);
const ENDPOINT = "https://api.javaskrrt.com/apps/generate-performance-review";
async function main() {
    const root = process.cwd();
    // 1) Scan PWD for git repos (immediate subdirs)
    const repos = await findGitRepos(root);
    if (repos.length === 0) {
        console.log("❌ No git repositories found here. Please run this in a directory containing git projects.");
        process.exit(1);
    }
    console.log(`✅ Found ${repos.length} git repo(s):`);
    repos.forEach((r) => console.log(`  - ${r}`));
    console.log("");
    // 2) Find git emails on local machine (global + across repos)
    const emails = await collectEmails(repos);
    if (emails.length === 0) {
        console.log("❌ No git author emails found locally or in repo history. Nothing to filter by.");
        process.exit(1);
    }
    // Multi-select with arrows/space/enter
    const { selectedEmails } = await prompts({
        type: "multiselect",
        name: "selectedEmails",
        message: "Select the git email(s) to filter commits by:",
        choices: emails.map((e) => ({ title: e, value: e })),
        hint: "- Space to select, Enter to confirm",
        min: 1
    });
    console.log(`\nFiltering by: ${selectedEmails.join(", ")}\n`);
    // 3) Confirm ready to synthesize
    const { confirmContinue } = await prompts({
        type: "confirm",
        name: "confirmContinue",
        message: "Ready to synthesize your performance review from these commits?"
    });
    if (!confirmContinue) {
        console.log("👍 Okay, exiting.");
        process.exit(0);
    }
    // 4) Loader + processing
    const spinner = ora("Processing commits and generating review...").start();
    try {
        const allCommits = await collectCommits(repos);
        const filtered = allCommits.filter((c) => selectedEmails
            .map((e) => e.toLowerCase())
            .includes(c.authorEmail.toLowerCase()));
        if (filtered.length === 0) {
            spinner.fail("No matching commits found for the selected email(s).");
            process.exit(1);
        }
        const consolidatedText = toConsolidatedText(filtered);
        const outPath = join(root, "javaskrrt_commits.txt");
        await writeFile(outPath, consolidatedText, "utf8");
        // Send to hardcoded endpoint
        const res = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: consolidatedText
        });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`Server responded ${res.status}: ${t}`);
        }
        const responseText = await res.text();
        spinner.succeed("Done!");
        console.log("\n📣 Server response:\n");
        console.log(responseText);
        console.log("\n👋 Exiting.\n");
    }
    catch (err) {
        spinner.fail("Failed.");
        console.error(err.message);
        process.exit(1);
    }
}
/** Find immediate subdirectories that are git repos (contain .git). */
async function findGitRepos(root) {
    const entries = await readdir(root);
    const repos = [];
    for (const entry of entries) {
        const full = join(root, entry);
        try {
            const s = await stat(full);
            if (!s.isDirectory())
                continue;
            const gitDir = join(full, ".git");
            const gitStat = await stat(gitDir).catch(() => null);
            if (gitStat && gitStat.isDirectory()) {
                repos.push(full);
            }
        }
        catch {
            // ignore unreadable entries
        }
    }
    return repos;
}
/** Collect emails from global git config + repo history unioned. */
async function collectEmails(repos) {
    const set = new Set();
    // Global/local config emails
    const configEmails = await getGitConfigEmails();
    configEmails.forEach((e) => set.add(e));
    // Repo history emails
    for (const repoPath of repos) {
        try {
            const out = await git(repoPath, ["log", "--all", "--format=%ae"]);
            out
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
                .forEach((e) => set.add(e));
        }
        catch {
            // skip repo if log fails
        }
    }
    return Array.from(set).sort();
}
/** Get emails from git config (global + local). */
async function getGitConfigEmails() {
    const emails = [];
    // Try global
    try {
        const out = await git(process.cwd(), [
            "config",
            "--global",
            "--get-all",
            "user.email"
        ]);
        out
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((e) => emails.push(e));
    }
    catch { }
    // Try local (current dir)
    try {
        const out = await git(process.cwd(), ["config", "--get-all", "user.email"]);
        out
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((e) => emails.push(e));
    }
    catch { }
    return Array.from(new Set(emails));
}
/** Run git command in repoPath. */
async function git(repoPath, args) {
    const { stdout } = await execFileAsync("git", args, {
        cwd: repoPath
    });
    return stdout.trim();
}
/** Collect commits from all repos. */
async function collectCommits(repos) {
    const all = [];
    const format = [
        "%H", // hash
        "%an", // author name
        "%ae", // author email
        "%aI", // date ISO
        "%s", // subject
        "%b" // body
    ].join("%n");
    const sep = "\n---JAVASKRRT_COMMIT_SEPARATOR---\n";
    for (const repoPath of repos) {
        const repoName = basename(repoPath);
        try {
            const out = await git(repoPath, [
                "log",
                "--all",
                `--pretty=format:${format}${sep}`
            ]);
            const blocks = out
                .split(sep)
                .map((b) => b.trim())
                .filter(Boolean);
            for (const block of blocks) {
                const lines = block.split("\n");
                const [hash, authorName, authorEmail, dateISO, subject, ...bodyLines] = lines;
                all.push({
                    repoName,
                    repoPath,
                    hash: hash ?? "",
                    authorName: authorName ?? "",
                    authorEmail: authorEmail ?? "",
                    dateISO: dateISO ?? "",
                    subject: subject ?? "",
                    body: bodyLines.join("\n").trim()
                });
            }
        }
        catch {
            // soft skip a broken repo
        }
    }
    return all;
}
/** Convert commits to a single big text prompt. */
function toConsolidatedText(commits) {
    const header = [
        "JAVASKRRT PERFORMANCE REVIEW INPUT",
        `Total commits: ${commits.length}`,
        "",
        "Commits:"
    ].join("\n");
    const body = commits
        .map((c) => {
        const line = `- [${c.repoName}] ${c.dateISO} ${c.hash.slice(0, 7)} ${c.subject}`;
        const details = c.body ? indent(c.body, 2) : "";
        return details ? `${line}\n${details}` : line;
    })
        .join("\n");
    return `${header}\n${body}\n`;
}
function indent(text, spaces) {
    const pad = " ".repeat(spaces);
    return text
        .split("\n")
        .map((l) => pad + l)
        .join("\n");
}
main();
