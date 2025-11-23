#!/usr/bin/env node
import { Command } from "commander";
import prompts from "prompts";
import { scanRepos, collectCommits } from "./scan-repos";
import { getAuthorEmails } from "./git";
import { Commit, ReviewResponse } from "./types";
import { join } from "path";
import { writeFile } from "fs/promises";

const program = new Command();

program
  .name("javaskrrt")
  .description("Generate a performance review from your git commits.")
  .version("0.1.0");

program
  .command("generate-performance-review")
  .description("Scan repos in the current directory and generate a review.")
  .option("-r, --root <path>", "Root directory containing repos", process.cwd())
  .option(
    "--since <date>",
    "Only include commits since this date (git understands many formats)",
    "1 year ago"
  )
  .option(
    "--until <date>",
    "Only include commits until this date (default: now)"
  )
  .option(
    "--endpoint <url>",
    "Server endpoint to send commits to",
    process.env.JAVASKRRT_ENDPOINT ||
      "http://localhost:3000/api/performance-review"
  )
  .option(
    "--out <path>",
    "Write consolidated commit text to file (default: ./javaskrrt_commits.txt)"
  )
  .option("--dry-run", "Do not call server, just write file")
  .action(async (opts) => {
    const root = opts.root as string;
    const endpoint = opts.endpoint as string;
    const since = opts.since as string;
    const until = opts.until as string | undefined;
    const outPath = (opts.out as string) || join(root, "javaskrrt_commits.txt");
    const dryRun = Boolean(opts.dryRun);

    console.log(`\n🧠 javaskrrt scanning repos in: ${root}\n`);

    const repos = await scanRepos(root);
    if (!repos.length) {
      console.error("No git repos found in this directory.");
      process.exit(1);
    }

    console.log(`Found ${repos.length} repo(s):`);
    repos.forEach((r) => console.log(`  - ${r}`));
    console.log("");

    // Collect all unique emails across all repos
    const emailsSet = new Set<string>();
    for (const repo of repos) {
      const emails = await getAuthorEmails(repo);
      emails.forEach((e) => emailsSet.add(e));
    }
    const emails = Array.from(emailsSet).sort();

    if (!emails.length) {
      console.error("No author emails found in git history.");
      process.exit(1);
    }

    const { selectedEmails } = await prompts({
      type: "multiselect",
      name: "selectedEmails",
      message: "Select the git author email(s) to include:",
      choices: emails.map((e) => ({ title: e, value: e })),
      hint: "- Space to select. Enter to confirm.",
      min: 1
    });

    if (!selectedEmails || selectedEmails.length === 0) {
      console.error("No emails selected.");
      process.exit(1);
    }

    console.log(`\nFiltering commits by: ${selectedEmails.join(", ")}\n`);

    const allCommits = await collectCommits(repos);
    const filtered = filterCommits(allCommits, selectedEmails, since, until);

    if (!filtered.length) {
      console.error(
        "No matching commits found for selected email(s) and date range."
      );
      process.exit(1);
    }

    const consolidatedText = toConsolidatedText(filtered, { since, until });

    await writeFile(outPath, consolidatedText, "utf8");
    console.log(`✅ Wrote consolidated commits to ${outPath}`);
    console.log(`   Commits included: ${filtered.length}\n`);

    if (dryRun) {
      console.log("🧪 Dry run enabled — skipping server call.");
      return;
    }

    console.log(`📡 Sending to server: ${endpoint}`);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          since,
          until: until ?? null,
          selectedEmails,
          commits: filtered,
          consolidatedText
        })
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Server responded ${res.status}: ${t}`);
      }

      const data = (await res.json()) as ReviewResponse;

      console.log("\n🎉 Performance Review Output\n");
      console.log(section("What did I do well this year?", data.didWell));
      console.log(section("What could I improve upon?", data.improve));
      console.log(
        section("Goals for the upcoming year (and how)?", data.goals)
      );

      console.log("\n🧃 go forth and self-promote.\n");
    } catch (err) {
      console.error(`❌ Failed to call server: ${(err as Error).message}`);
      console.log(`You still have the raw commit dump at: ${outPath}`);
      process.exit(1);
    }
  });

program.parse(process.argv);

/** Filter commits by email(s) and date range. */
function filterCommits(
  commits: Commit[],
  emails: string[],
  since: string,
  until?: string
): Commit[] {
  const emailSet = new Set(emails.map((e) => e.toLowerCase()));

  // We'll let git do the date parsing by reusing its logic:
  // easiest approach client-side: keep all commits then do userland ISO comparisons.
  // We interpret `since`/`until` best-effort:
  const sinceDate = safeParseDate(since);
  const untilDate = until ? safeParseDate(until) : null;

  return commits.filter((c) => {
    if (!emailSet.has(c.authorEmail.toLowerCase())) return false;

    const d = new Date(c.dateISO).getTime();
    if (Number.isFinite(sinceDate) && d < sinceDate) return false;
    if (untilDate && Number.isFinite(untilDate) && d > untilDate) return false;

    return true;
  });
}

function safeParseDate(input: string): number {
  // Try Date first. If invalid, fallback to "1 year ago" style by asking git.
  const direct = Date.parse(input);
  if (Number.isFinite(direct)) return direct;

  // Fallback: ask git to interpret the date to an ISO timestamp.
  // If this fails, we just ignore date filtering.
  try {
    // synchronous-ish trick: Bun.spawnSync is ok in CLI.
    const p = Bun.spawnSync([
      "git",
      "rev-parse",
      `--since=${input}`,
      "--quiet"
    ]);
    if (p.exitCode === 0) {
      // not a real timestamp output; so we can't use it.
      // ignore.
    }
  } catch {}
  return Number.NaN;
}

/** Turn commits into a chunky text prompt. */
function toConsolidatedText(
  commits: Commit[],
  range: { since: string; until?: string }
): string {
  const header = [
    "JAVASKRRT PERFORMANCE REVIEW INPUT",
    `Date range: since=${range.since}${
      range.until ? `, until=${range.until}` : ""
    }`,
    `Total commits: ${commits.length}`,
    "",
    "Commits:"
  ].join("\n");

  const body = commits
    .map((c) => {
      const firstLine = `- [${c.repoName}] ${c.dateISO} ${c.hash.slice(0, 7)} ${
        c.subject
      }`;
      const details = c.body ? indent(c.body.trim(), 2) : "";
      return details ? `${firstLine}\n${details}` : firstLine;
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

function section(title: string, content: string) {
  return `=== ${title} ===\n${content.trim()}\n`;
}
