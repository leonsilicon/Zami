import { Buffer } from "node:buffer";
import { createHmac, sign, timingSafeEqual } from "node:crypto";

const GITHUB_API = "https://api.github.com";
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;

function githubHeaders(token: string): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    authorization: "Bearer " + token,
    "content-type": "application/json",
    "user-agent": "Zami upstream sync",
    "x-github-api-version": "2026-03-10",
  };
}

async function dispatchWorkflow(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({ iss: env.GITHUB_APP_CLIENT_ID, iat: now - 60, exp: now + 300 }),
  ).toString("base64url");
  const unsigned = header + "." + claims;
  const jwt =
    unsigned +
    "." +
    sign("RSA-SHA256", Buffer.from(unsigned), env.GITHUB_APP_PRIVATE_KEY).toString("base64url");
  // Leave time for GitHub to receive the webhook response before its delivery timeout.
  const signal = AbortSignal.timeout(7_000);

  const installation = await fetch(
    GITHUB_API + "/app/installations/" + env.GITHUB_INSTALLATION_ID + "/access_tokens",
    {
      method: "POST",
      headers: githubHeaders(jwt),
      body: JSON.stringify({ repositories: ["Zami"], permissions: { actions: "write" } }),
      signal,
    },
  );
  if (!installation.ok) {
    throw new Error("GitHub installation token request returned " + installation.status);
  }
  const { token }: { token?: string } = await installation.json();
  if (!token) throw new Error("GitHub installation token was missing");

  const dispatch = await fetch(
    GITHUB_API + "/repos/leonsilicon/Zami/actions/workflows/zami-upstream-sync.yml/dispatches",
    {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({ ref: "trunk" }),
      signal,
    },
  );
  if (!dispatch.ok) {
    throw new Error("GitHub workflow dispatch returned " + dispatch.status);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== "/github") return new Response(null, { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature) || !request.body) {
      return new Response(null, { status: 401 });
    }

    const digest = createHmac("sha256", env.GITHUB_WEBHOOK_SECRET);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of request.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_PAYLOAD_BYTES) return new Response(null, { status: 413 });
      digest.update(chunk);
      chunks.push(chunk);
    }
    if (!timingSafeEqual(digest.digest(), Buffer.from(signature.slice(7), "hex"))) {
      return new Response(null, { status: 401 });
    }

    if (request.headers.get("x-github-event") !== "push") {
      return new Response(null, { status: 204 });
    }
    const push: { ref?: string; deleted?: boolean; repository?: { full_name?: string } } | null =
      JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
    if (
      push?.ref !== "refs/heads/master" ||
      push.deleted ||
      push.repository?.full_name !== "leonsilicon/Zam"
    ) {
      return new Response(null, { status: 204 });
    }

    try {
      await dispatchWorkflow(env);
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error("Zami upstream workflow dispatch failed", error);
      return new Response(null, { status: 502 });
    }
  },
};
