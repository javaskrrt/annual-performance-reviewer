import { isGitRepo, getCommits } from "./git";
import { Commit } from "./types";
import { basename, join } from "path";
import { readdir } from "fs/promises";

/** List immediate subdirectories in a root folder. */
async function listSubdirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });

    const subdirs = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !entry.name.includes("node_modules") && entry.name !== ".git")
        .map((entry) => join(root, entry.name))
    );

    return subdirs;
  } catch {
    return [];
  }
}

/** Scan all git repos under root (1 level deep). */
export async function scanRepos(root: string): Promise<string[]> {
  const candidates = await listSubdirs(root);
  const repos: string[] = [];

  for (const p of candidates) {
    if (await isGitRepo(p)) repos.push(p);
  }

  return repos;
}

/** Collect commits from all repos and annotate with repo info. */
export async function collectCommits(repos: string[]): Promise<Commit[]> {
  const all: Commit[] = [];

  for (const repoPath of repos) {
    const repoName = basename(repoPath);
    try {
      const commits = await getCommits(repoPath);
      for (const c of commits) {
        all.push({ ...c, repoName, repoPath });
      }
    } catch (err) {
      // Soft-fail one repo so the whole run doesn't die.
      console.warn(`⚠️  Skipping ${repoName}: ${(err as Error).message}`);
    }
  }

  return all;
}
