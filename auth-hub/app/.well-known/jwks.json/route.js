import { NextResponse } from "next/server";
import { getKeys } from "@/lib/keys";

export const dynamic = "force-dynamic";

// Public keys only. Apps download these to verify tokens, so they never need a shared secret.
export async function GET() {
  const { publicKeys } = await getKeys();
  return NextResponse.json({ keys: publicKeys });
}
