"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";

export default function LeaguePage() {
  const router = useRouter();
  const params = useParams();
  const { data: session, status } = useSession();
  const leagueId = params.LeagueID as string;

  useEffect(() => {
    if (status === "loading") return;

    const redirectToRoster = async () => {
      if (!session?.user?.id) {
        router.push("/");
        return;
      }

      try {
        // Fetch the user's team in this league
        const response = await fetch(`/api/leagues/${leagueId}`);

        if (!response.ok) {
          console.error("Failed to fetch league data");
          router.push("/");
          return;
        }

        const data = await response.json();

        // Get user's team from the league data by matching owner ID
        const userTeam = data.league?.fantasyTeams?.find(
          (team: { id: string; ownerUserId: string }) => team.ownerUserId === session.user.id
        );

        if (userTeam) {
          // Redirect to the user's roster page
          router.push(`/leagues/${leagueId}/my-roster/${userTeam.id}`);
        } else {
          // If no team found, redirect to home
          console.warn("No team found for user in this league");
          router.push("/");
        }
      } catch (error) {
        console.error("Error redirecting to roster:", error);
        router.push("/");
      }
    };

    redirectToRoster();
  }, [leagueId, router, session, status]);

  return (
    <div style={{
      minHeight: "50vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }}>
      <div style={{
        color: "var(--text-muted)",
        fontSize: "1.1rem"
      }}>
        Loading your roster...
      </div>
    </div>
  );
}
