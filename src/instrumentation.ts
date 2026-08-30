// Next.js server startup hook. Starts the retention scanner (要件10.5 走査) on
// the Node.js runtime only. face-api.js warmup happens in the browser (client
// terminals call warmup()); models can't run server-side here.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRetentionScanner } = await import("@/lib/retention/scanner");
    // Demo period: sweep expired templates every 60s (要件10.5, <=60min interval).
    startRetentionScanner(60_000);
  }
}
