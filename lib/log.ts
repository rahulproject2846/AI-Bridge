export function logError(context: string, error: unknown, meta?: Record<string, unknown>) {
  const payload = {
    level: "error",
    context,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...(meta || {}),
  };
  console.error(JSON.stringify(payload));
}
