export async function register() {
  // Only run this on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Dynamic import is REQUIRED here.
    // Why: Next.js builds two bundles: one for Node.js and one for the 'Edge Runtime' (middleware).
    // The Edge Runtime does not support Node.js APIs like 'fs' or 'child_process'.
    // If we import statically, the Edge compiler sees 'fs' and fails the build.
    // See docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
    const { runStartupChecks } = await import('./lib/server/startup');
    await runStartupChecks();
  }
}
