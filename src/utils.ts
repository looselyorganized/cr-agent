/** Parse a repo string into owner and name */
export function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.trim().split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo argument: "${repo}". Expected format: "owner/name"`);
  }
  return { owner: parts[0], name: parts[1] };
}

/** Format bytes into human-readable string */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error(`Invalid bytes argument: ${bytes}. Expected a finite, non-negative number`);
  }
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
}

/** Sleep for ms milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
