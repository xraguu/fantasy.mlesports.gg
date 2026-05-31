import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { importSprocketStatsForWeek } from "@/lib/sprocketStats";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { week, season } = body;

    if (!week || !season) {
      return NextResponse.json(
        { error: "week and season are required" },
        { status: 400 }
      );
    }

    const weekNum = parseInt(week);
    const seasonNum = parseInt(season);

    if (weekNum < 1 || weekNum > 10) {
      return NextResponse.json(
        { error: "week must be between 1 and 10" },
        { status: 400 }
      );
    }

    const result = await importSprocketStatsForWeek(weekNum, seasonNum);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Import failed";
    console.error("Sprocket import error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
