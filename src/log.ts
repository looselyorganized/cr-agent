export function log(
  level: "info" | "error",
  event: string,
  data: { repo: string; pr: number; round?: number; [key: string]: unknown }
): void {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}
