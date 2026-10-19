/**
 * Runs once when the server process boots (before serving any request).
 * Validates the environment contract eagerly so a misconfigured deployment
 * (e.g. missing AUTH_SECRET or DATABASE_URL on Coolify) fails LOUDLY at boot
 * with an exact key in the container logs — instead of every register/login
 * request dying with an opaque 500 "حدث خطأ. حاول مجددًا."
 *
 * Never logs secret values — only key names and validation messages.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { env } = await import("./server/env");
    const e = env();
    console.log(
      JSON.stringify({
        event: "boot.env_ok",
        keys: Object.keys(e),
        authSecretLen: e.AUTH_SECRET.length,
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "boot.env_invalid",
        // message contains only the failing key name and rule — never values
        detail: err instanceof Error ? err.message : String(err),
      }),
    );
    // fail fast: a server that cannot mint sessions is worse than a down one
    process.exit(1);
  }
}