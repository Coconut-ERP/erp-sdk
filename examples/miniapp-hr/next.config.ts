import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/*
 * The ERP serves mini apps behind Traefik at /apps/<slug>-<id>/ and strips that
 * prefix before the request reaches the container. A relative asset prefix keeps
 * every /_next/ URL inside the app, so one build works under any install path
 * without knowing the slug in advance. The dev server is served from the root
 * and drives its own HMR chunks, so it keeps the default prefix.
 */
export default function config(phase: string): NextConfig {
  return {
    assetPrefix: phase === PHASE_DEVELOPMENT_SERVER ? undefined : ".",
    turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
    serverExternalPackages: ["erp-sdk"],
  };
}
