#!/usr/bin/env node
import http from "node:http";
import { URL } from "node:url";

const port = Number(process.env.IPFS_PROXY_PORT || 8088);
const gatewayOrigin = process.env.IPFS_GATEWAY_ORIGIN || "http://127.0.0.1:8080";
const apiOrigin = process.env.IPFS_API_ORIGIN || "http://127.0.0.1:5001";
const allowedOrigins = (process.env.IPFS_PROXY_ALLOWED_ORIGINS || "http://localhost:8001,http://127.0.0.1:8001")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

function pickTarget(req) {
  const rawUrl = req.url || "/";
  if (rawUrl.startsWith("/api/v0/")) {
    return new URL(rawUrl, apiOrigin);
  }
  if (rawUrl.startsWith("/ipfs/") || rawUrl.startsWith("/ipns/")) {
    return new URL(rawUrl, gatewayOrigin);
  }
  return null;
}

const server = http.createServer((req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const target = pickTarget(req);
  if (!target) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Unsupported IPFS proxy path");
    return;
  }

  const headers = { ...req.headers, host: target.host };
  delete headers["content-length"];

  const proxyReq = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
    },
    (proxyRes) => {
      res.statusCode = proxyRes.statusCode || 502;
      Object.entries(proxyRes.headers).forEach(([key, value]) => {
        if (value !== undefined && key.toLowerCase() !== "access-control-allow-origin") {
          res.setHeader(key, value);
        }
      });
      setCors(req, res);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    res.statusCode = 502;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`Proxy error: ${error.message}`);
  });

  req.pipe(proxyReq);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`IPFS local proxy listening on http://127.0.0.1:${port}`);
  console.log(`Gateway origin: ${gatewayOrigin}`);
  console.log(`API origin: ${apiOrigin}`);
  console.log(`Allowed browser origins: ${allowedOrigins.join(", ") || "*"}`);
});
