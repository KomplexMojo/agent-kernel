const assert = require("node:assert/strict");
const net = require("node:net");

const {
  clearRouteCache,
  hostForRoute,
  probeTcp,
  resolveRoute,
} = require("../../tools/remote-ollama-control/scripts/lib/config");

// RFC 5737 TEST-NET-1/2. Reserved for documentation and guaranteed not to be
// routable, so a probe against them fails the same way everywhere instead of
// depending on whatever happens to live at that address on a given network.
const UNREACHABLE_A = "192.0.2.1";
const UNREACHABLE_B = "198.51.100.1";

// Keep unreachable probes short: they always burn their full deadline.
const PROBE_MS = 250;

function configFor({ internalHost, externalHost, sshPort, defaultRoute = "auto" }) {
  return {
    host: {
      internalHost,
      externalHost,
      sshPort,
      defaultRoute,
      routeProbeMs: PROBE_MS,
      routeProbeInternalMs: PROBE_MS,
    },
  };
}

function listenOnLoopback() {
  return new Promise((resolveListen) => {
    const server = net.createServer((socket) => socket.destroy());
    server.listen(0, "127.0.0.1", () => resolveListen(server));
  });
}

function closeServer(server) {
  return new Promise((done) => server.close(done));
}

test("probeTcp reports open for a listening port and closed for a dead host", async () => {
  const server = await listenOnLoopback();
  const { port } = server.address();
  try {
    assert.equal(probeTcp("127.0.0.1", port, PROBE_MS), true);
    assert.equal(probeTcp(UNREACHABLE_A, port, PROBE_MS), false);
    // An empty host is a missing config value, not a reachable one.
    assert.equal(probeTcp("", port, PROBE_MS), false);
  } finally {
    await closeServer(server);
  }
});

test("an explicit route is honoured verbatim and never probes", () => {
  clearRouteCache();
  // Both hosts are unreachable: if an explicit route probed at all, these calls
  // would fail rather than return immediately.
  const config = configFor({
    internalHost: UNREACHABLE_A,
    externalHost: UNREACHABLE_B,
    sshPort: 2222,
  });

  const started = Date.now();
  assert.equal(resolveRoute(config, "internal"), "internal");
  assert.equal(resolveRoute(config, "external"), "external");
  assert.equal(resolveRoute(config, "lan"), "internal");
  assert.equal(resolveRoute(config, "vpn"), "external");
  assert.ok(
    Date.now() - started < PROBE_MS,
    "explicit routes resolved without waiting on a probe",
  );

  assert.equal(hostForRoute(config, "internal"), UNREACHABLE_A);
  assert.equal(hostForRoute(config, "external"), UNREACHABLE_B);
});

test("an unknown route names the accepted values", () => {
  const config = configFor({
    internalHost: UNREACHABLE_A,
    externalHost: UNREACHABLE_B,
    sshPort: 2222,
  });
  assert.throws(
    () => resolveRoute(config, "sideways"),
    /Unknown route 'sideways'\. Use internal, external, or auto\./,
  );
});

test("auto prefers internal when the internal host answers", async () => {
  clearRouteCache();
  const server = await listenOnLoopback();
  const { port } = server.address();
  try {
    // External is reachable-in-principle too (same live port), so choosing
    // internal reflects preference, not the external probe failing.
    const config = configFor({
      internalHost: "127.0.0.1",
      externalHost: "127.0.0.1",
      sshPort: port,
    });
    assert.equal(resolveRoute(config, null), "internal");
    assert.equal(hostForRoute(config, null), "127.0.0.1");
  } finally {
    await closeServer(server);
    clearRouteCache();
  }
});

test("auto falls back to external when only the external host answers", async () => {
  clearRouteCache();
  const server = await listenOnLoopback();
  const { port } = server.address();
  try {
    const config = configFor({
      internalHost: UNREACHABLE_A,
      externalHost: "127.0.0.1",
      sshPort: port,
    });
    assert.equal(resolveRoute(config, null), "external");
    assert.equal(hostForRoute(config, null), "127.0.0.1");
  } finally {
    await closeServer(server);
    clearRouteCache();
  }
});

test("auto caches its verdict so repeated calls probe once", async () => {
  clearRouteCache();
  const server = await listenOnLoopback();
  const { port } = server.address();
  try {
    const config = configFor({
      internalHost: UNREACHABLE_A,
      externalHost: "127.0.0.1",
      sshPort: port,
    });

    const cold = Date.now();
    assert.equal(resolveRoute(config, null), "external");
    const coldMs = Date.now() - cold;

    const warm = Date.now();
    assert.equal(resolveRoute(config, null), "external");
    const warmMs = Date.now() - warm;

    // The cold call pays the unreachable internal probe; the warm one must not.
    assert.ok(coldMs >= PROBE_MS, `cold resolve probed (${coldMs}ms)`);
    assert.ok(warmMs < PROBE_MS, `warm resolve used the cache (${warmMs}ms)`);
  } finally {
    await closeServer(server);
    clearRouteCache();
  }
});

test("auto explains itself when neither host answers", () => {
  clearRouteCache();
  const config = configFor({
    internalHost: UNREACHABLE_A,
    externalHost: UNREACHABLE_B,
    sshPort: 2222,
  });
  assert.throws(() => resolveRoute(config, null), (error) => {
    assert.match(error.message, /Route auto-detection failed/);
    // The message has to be actionable: name both deadlines, and offer the
    // explicit-route escape hatch that surfaces the underlying error.
    assert.match(error.message, /--route internal\|external/);
    assert.match(error.message, /dynamic-DNS record can go stale/);
    return true;
  });
});

test("a missing host address is reported as config, not as unreachable", () => {
  clearRouteCache();
  const config = configFor({
    internalHost: "",
    externalHost: UNREACHABLE_B,
    sshPort: 2222,
  });
  assert.throws(
    () => hostForRoute(config, "internal"),
    /LLM_INTERNAL_HOST is not set/,
  );
});

// ---------------------------------------------------------------------------
// ## TODO: Test Permutations
//
// - probe deadlines: internal shorter than external; each honoured to the ms
// - LLM_ROUTE_PROBE_INTERNAL_MS / LLM_ROUTE_PROBE_MS overrides from the env file
// - defaultRoute pinned to internal/external in config bypasses probing
// - cache key varies by host pair and port (a changed port re-probes)
// - IPv6 loopback host answers
// - host that accepts TCP but is not the expected service still counts as open
// ---------------------------------------------------------------------------
