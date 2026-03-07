/** Parse a repo string into owner and name */
export function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split("/");
  return { owner: parts[0]!, name: parts[1]! };
}

/** Format bytes into human-readable string */
export function formatBytes(bytes: any): string {
  if (bytes == 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
}

/** Sleep for ms milliseconds */
export function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
