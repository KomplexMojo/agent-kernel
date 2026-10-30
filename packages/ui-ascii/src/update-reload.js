/**
 * Drop service workers and caches, then navigate so the next load is the live build.
 * Pure of DOM globals except through the injected ports — unit-tested with mocks.
 *
 * Never calls registration.update(): that can hang and was leaving Update looking dead.
 * Always ends in replace(href) even when cleanup times out.
 */

function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

/**
 * @param {object} args
 * @param {() => Promise<Array<{ unregister: () => Promise<boolean> }>>} args.getRegistrations
 * @param {() => Promise<void>} args.deleteCaches
 * @param {(href: string) => void} args.replace
 * @param {string} args.href
 * @param {() => number} [args.now]
 * @param {number} [args.timeoutMs]
 */
export async function reloadForUpdate({
  getRegistrations,
  deleteCaches,
  replace,
  href,
  now = Date.now,
  timeoutMs = 1500,
} = {}) {
  await withTimeout((async () => {
    const registrations = await getRegistrations();
    await Promise.all((Array.isArray(registrations) ? registrations : []).map((entry) => entry.unregister()));
    await deleteCaches();
  })(), timeoutMs);
  const url = new URL(href);
  url.searchParams.set("_", String(now()));
  replace(url.href);
}
