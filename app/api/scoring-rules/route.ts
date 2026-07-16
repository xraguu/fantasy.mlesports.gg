import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getActiveScoringRules } from "@/lib/scoringService";

/**
 * GET /api/scoring-rules
 * Public (any signed-in user, not admin-only) read of the currently active
 * scoring rules — backs the homepage Info guide's "exact point values"
 * detail. Session-gated like the rest of the app, but intentionally not
 * admin-gated since this is safe, non-sensitive reference data every
 * manager should be able to see.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rules = await getActiveScoringRules();
  return NextResponse.json({ rules });
}
