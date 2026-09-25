export type UpdateDisplayChannel = "releases" | "commits";

export function sameGitSha(left?: string | null, right?: string | null): boolean {
  const a = left?.trim().toLowerCase() ?? "";
  const b = right?.trim().toLowerCase() ?? "";
  if (!a || !b || !/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) return false;
  const n = Math.min(a.length, b.length);
  if (n < 7) return a === b;
  return a.slice(0, n) === b.slice(0, n);
}

export function shortGitSha(value?: string | null): string | null {
  const sha = value?.trim() ?? "";
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null;
  return sha.slice(0, 12);
}

export function formatUpdateInstalledLabel(
  channel: UpdateDisplayChannel,
  currentRef?: string | null,
  version?: string | null,
): string {
  const ref = currentRef?.trim() || "";
  const labeled = ref && ref !== "unknown" ? ref : "";
  const ver = version?.trim() || "";
  if (channel === "commits") return shortGitSha(labeled) || labeled || ver || "unknown";
  return ver || labeled || "development checkout";
}

export function commitChannelUpdateAvailable(
  latestSha?: string | null,
  installedCommit?: string | null,
  checkoutSha?: string | null,
): boolean {
  if (!latestSha?.trim()) return false;
  const current = checkoutSha?.trim() ? checkoutSha : installedCommit;
  return !sameGitSha(latestSha, current);
}

export type UpdateReleaseItem = {
  tag: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  prerelease: boolean;
  current: boolean;
};

export type UpdateCommitItem = {
  sha: string;
  shortSha: string;
  title: string;
  body: string;
  htmlUrl: string;
  authoredAt: string | null;
  author: string | null;
  current: boolean;
};

export type UpdateVersionList = {
  currentRef: string;
  currentCommit: string | null;
  currentTag: string | null;
  releases: UpdateReleaseItem[];
  commits: UpdateCommitItem[];
};
