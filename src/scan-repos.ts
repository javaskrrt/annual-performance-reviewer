import { isGitRepo, getCommits } from "./git";
import { Commit } from "./types";
import { basename, join } from "path";

/** List immediate subdirectories in a root folder. */
async function listSubdirs(root: string): Promise<string[]> {
  const entries = (await Bun.file(root).exists())
    ? await Array.fromAsync(
        new Bun.Glob("*").scan({ cwd: root, onlyFiles: false })
      )
    : [];

  return entries
    .map((p) => join(root, p))
    .filter((p) => !p.includes("node_modules") && !p.includes(".git"));
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
