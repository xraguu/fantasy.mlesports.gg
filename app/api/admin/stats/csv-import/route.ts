import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { logAdminActivity } from "@/lib/adminActivity";
import { getCsvImportSources, runCsvImports, isCsvImportKey } from "@/lib/csvImports";

/**
 * GET /api/admin/stats/csv-import
 * Every re-importable Sprocket dataset, with whether each of its files is
 * currently published on Sprocket's CDN (and when it was last updated).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ sources: await getCsvImportSources() });
  } catch (error) {
    console.error("Error listing CSV import sources:", error);
    return NextResponse.json({ error: "Failed to check Sprocket datasets" }, { status: 500 });
  }
}

/**
 * POST /api/admin/stats/csv-import
 * Body: { sources: ("players" | "schedule" | "historical" | "weekly")[] }
 * Re-imports the selected datasets from Sprocket's CDN. Doesn't recalculate
 * fantasy scores — that stays a separate, deliberate action.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const sources: unknown = body?.sources;
  if (!Array.isArray(sources) || sources.length === 0 || !sources.every(isCsvImportKey)) {
    return NextResponse.json({ error: "Pick at least one dataset to re-import" }, { status: 400 });
  }

  try {
    const results = await runCsvImports(sources);

    await logAdminActivity({
      adminUserId: session.user.id,
      action: "stats.csv_import",
      description: `Re-imported ${results
        .map((r) => (r.error ? `${r.label} (failed)` : r.label))
        .join(", ")} from Sprocket`,
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error("CSV import error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed" }, { status: 500 });
  }
}
