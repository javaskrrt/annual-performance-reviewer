#!/usr/bin/env node
import prompts from "prompts";
import ora from "ora";
import OpenAI from "openai";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { getUserOpenAIKey } from "./openai-key";

const execFileAsync = promisify(execFile);

type Commit = {
  repoName: string;
  repoPath: string;
  hash: string;
  authorName: string;
  authorEmail: string;
  dateISO: string;
  subject: string;
  body: string;
};

async function main() {
  const root = process.cwd();
  const cliOpenAIKey = getArgValue("--openai-key");

  // 1) Scan for git repos
  const repos = await findGitRepos(root);
  if (repos.length === 0) {
    console.log(
      "❌ No git repositories found here. Please run this in a directory containing git projects."
    );
    process.exit(1);
  }

  console.log(`✅ Found ${repos.length} git repo(s):`);
  repos.forEach((r) => console.log(`  - ${r}`));
  console.log("");

  // 2) Gather emails
  const emails = await collectEmails(repos);
  if (emails.length === 0) {
    console.log("❌ No git author emails found locally or in commit history.");
    process.exit(1);
  }

  // 3) Multi-select emails using prompts
  const emailPrompt = await prompts({
    type: "multiselect",
    name: "selected",
    message: "Select the git email(s) to filter commits by:",
    choices: emails.map((e) => ({ title: e, value: e })),
    hint: "- Space to select, enter to confirm",
    min: 1
  });

  if (!emailPrompt.selected?.length) {
    console.log("No emails selected. Exiting.");
    process.exit(1);
  }

  const selectedEmails: string[] = emailPrompt.selected;
  console.log(`\nFiltering by: ${selectedEmails.join(", ")}\n`);

  // 4) Confirm continue
  const confirmPrompt = await prompts({
    type: "confirm",
    name: "ok",
    message: "Ready to synthesize your performance review?",
    initial: true
  });

  if (!confirmPrompt.ok) {
    console.log("👍 Exiting.");
    process.exit(0);
  }

  // 5) Process commits + call OpenAI
  const spinner = ora("Processing commits...").start();

  try {
    const allCommits = await collectCommits(repos);
    const filtered = allCommits.filter((c) =>
      selectedEmails
        .map((e) => e.toLowerCase())
        .includes(c.authorEmail.toLowerCase())
    );

    if (filtered.length === 0) {
      spinner.fail("No matching commits found for the selected email(s).");
      process.exit(1);
    }

    const consolidatedText = toConsolidatedText(filtered);
    const outPath = join(root, "javaskrrt_commits.txt");
    await writeFile(outPath, consolidatedText, "utf8");

    spinner.text = "Calling OpenAI with your API key...";

    const userKey = await getUserOpenAIKey(cliOpenAIKey);
    const openai = new OpenAI({ apiKey: userKey });

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are an expert engineering manager helping a senior software engineer write an annual self-assessment. Be concise, specific, and evidence-based. Do not invent facts. Tone: professional with confident self-advocacy."
        },
        {
          role: "user",
          content: `
Using only the evidence in these commits, answer:

1) What are some things I do well?
2) How could I improve?
3) What are my goals for the upcoming year, and how can I achieve them?

COMMITS:
${consolidatedText}
`
        }
      ]
    });

    spinner.succeed("Done!");

    console.log("\n📣 Performance Review Output:\n");
    console.log(response.output_text);
    console.log("\n👋 Exiting.\n");
  } catch (err) {
    spinner.fail("Failed.");
    console.error((err as Error).message);
    process.exit(1);
  }
}

/* -----------------------------------------------
   Repo scanning
------------------------------------------------- */

async function findGitRepos(root: string): Promise<string[]> {
  const entries = await readdir(root);
  const repos: string[] = [];

  for (const entry of entries) {
    const full = join(root, entry);
    try {
      const s = await stat(full);
      if (!s.isDirectory()) continue;

      const gitDir = join(full, ".git");
      const gitStat = await stat(gitDir).catch(() => null);
      if (gitStat && gitStat.isDirectory()) repos.push(full);
    } catch {}
  }

  return repos;
}

/* -----------------------------------------------
   Email aggregation
------------------------------------------------- */

async function collectEmails(repos: string[]): Promise<string[]> {
  const set = new Set<string>();

  const configEmails = await getGitConfigEmails();
  configEmails.forEach((e) => set.add(e));

  for (const repoPath of repos) {
    try {
      const out = await git(repoPath, ["log", "--all", "--format=%ae"]);
      out
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((x) => set.add(x));
    } catch {}
  }

  return Array.from(set).sort();
}

async function getGitConfigEmails(): Promise<string[]> {
  const emails: string[] = [];

  try {
    const out = await git(process.cwd(), [
      "config",
      "--global",
      "--get-all",
      "user.email"
    ]);
    out
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((e) => emails.push(e));
  } catch {}

  try {
    const out = await git(process.cwd(), ["config", "--get-all", "user.email"]);
    out
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((e) => emails.push(e));
  } catch {}

  return Array.from(new Set(emails));
}

/* -----------------------------------------------
   Git helpers
------------------------------------------------- */

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoPath });
  return stdout.trim();
}

/* -----------------------------------------------
   Commit collection + formatting
------------------------------------------------- */

async function collectCommits(repos: string[]): Promise<Commit[]> {
  const all: Commit[] = [];
  const format = ["%H", "%an", "%ae", "%aI", "%s", "%b"].join("%n");

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
        const [hash, authorName, authorEmail, dateISO, subject, ...bodyLines] =
          lines;

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
    } catch {
      // skip broken repo
    }
  }

  return all;
}

function toConsolidatedText(commits: Commit[]): string {
  const header = [
    "JAVASKRRT PERFORMANCE REVIEW INPUT",
    `Total commits: ${commits.length}`,
    "",
    "Commits:"
  ].join("\n");

  const body = commits
    .map((c) => {
      const line = `- [${c.repoName}] ${c.dateISO} ${c.hash.slice(0, 7)} ${
        c.subject
      }`;
      const details = c.body ? indent(c.body, 2) : "";
      return details ? `${line}\n${details}` : line;
    })
    .join("\n");

  return `${header}\n${body}\n`;
}

function indent(text: string, spaces: number) {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

/* -----------------------------------------------
   Arg parser
------------------------------------------------- */

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("--")) return undefined;
  return next;
}

main();
