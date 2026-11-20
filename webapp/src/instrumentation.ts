export async function register() {
  // Only run this on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Keep this import dynamic.
    // Next.js builds instrumentation for both Node.js and Edge.
    // Edge can't load Node APIs like fs or child_process.
    // A static import would pull those APIs into the Edge build and fail compilation.
    // See docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
    const { runStartupChecks } = await import('./lib/server/startup');
    await runStartupChecks();
  }
}
