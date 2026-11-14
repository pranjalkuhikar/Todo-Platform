import { register } from "@/lib/metrics";

// Prometheus scrapes this. Not wrapped in observe() so scrapes don't count as traffic.
export async function GET() {
  return new Response(await register.metrics(), { headers: { "Content-Type": register.contentType } });
}
