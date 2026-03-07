import { config } from "./config";

const GITHUB_API = "https://api.github.com";

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Fetches the latest CodeRabbit review for a PR and extracts
 * the AI agent prompt section. Returns null if no CR prompt found.
 */
export async function fetchCRPrompt(
  repo: string,
  prNumber: number
): Promise<string | null> {
  const url = `${GITHUB_API}/repos/${repo}/pulls/${prNumber}/reviews`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }

  const reviews = (await res.json()) as Array<{
    user: { login: string };
    body: string;
  }>;

  // Find the latest review by coderabbitai[bot], iterating in reverse
  const crReviews = reviews.filter(
    (r) => r.user?.login === "coderabbitai[bot]"
  );

  for (let i = crReviews.length - 1; i >= 0; i--) {
    const review = crReviews[i];
    const prompt = extractPrompt(review.body);
    if (prompt) return prompt;
  }

  // Also check review comments (inline comments) for the prompt
  const commentsUrl = `${GITHUB_API}/repos/${repo}/pulls/${prNumber}/comments`;
  const commentsRes = await fetch(commentsUrl, { headers: headers() });
  if (!commentsRes.ok) {
    throw new Error(
      `GitHub API error ${commentsRes.status}: ${await commentsRes.text()}`
    );
  }

  const comments = (await commentsRes.json()) as Array<{
    user: { login: string };
    body: string;
  }>;

  const crComments = comments.filter(
    (c) => c.user?.login === "coderabbitai[bot]"
  );

  for (let i = crComments.length - 1; i >= 0; i--) {
    const comment = crComments[i];
    const prompt = extractPrompt(comment.body);
    if (prompt) return prompt;
  }

  return null;
}

const MARKER = "Prompt for all review comments with AI agents";

function extractPrompt(body: string): string | null {
  if (!body) return null;

  const idx = body.indexOf(MARKER);
  if (idx === -1) return null;

  const afterMarker = body.slice(idx + MARKER.length);

  // Check if the prompt is inside a code fence
  const fenceMatch = afterMarker.match(/```[\w]*\n([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Otherwise return everything after the marker, trimmed
  const content = afterMarker.replace(/^[:\s]*/, "").trim();
  return content || null;
}

/**
 * Checks if a PR is still open.
 */
export async function isPROpen(
  repo: string,
  prNumber: number
): Promise<boolean> {
  const url = `${GITHUB_API}/repos/${repo}/pulls/${prNumber}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }

  const pr = (await res.json()) as { state: string };
  return pr.state === "open";
}
