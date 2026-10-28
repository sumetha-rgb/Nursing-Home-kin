import { NextRequest, NextResponse } from "next/server";
import { checkBranch, currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const u = await currentUser(req);
  return NextResponse.json({ user: u ? await checkBranch(u) : null });
}
