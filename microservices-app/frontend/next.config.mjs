// In normal use the browser talks to the GATEWAY (port 8080), which serves this app and the API on one origin.
// This rewrite only matters if someone opens the frontend directly (port 3000): /api calls are forwarded to the gateway.
const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:8080";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // small self-contained build for Docker
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${GATEWAY_URL}/api/:path*` }];
  },
};
export default nextConfig;
