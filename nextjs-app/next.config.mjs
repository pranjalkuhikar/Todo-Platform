/** @type {import('next').NextConfig} */
const nextConfig = {
  // keep these as plain Node modules instead of bundling them
  serverExternalPackages: ["pg", "prom-client"],
};
export default nextConfig;
