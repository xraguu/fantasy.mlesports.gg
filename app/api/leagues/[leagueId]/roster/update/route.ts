import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runAutoLockSweep, isWeekLocked, isWeekFrozen } from "@/lib/autoLock";
import { generateRosterSlotId } from "@/lib/id-generator";
import { cascadeRosterForward, TOTAL_WEEKS } from "@/lib/rosterCascade";

// Distinguish expected validation failures (thrown inside the transaction
// below) from genuinely unexpected errors, so the catch block can map each
// to the right HTTP status instead of a blanket 500.
class LockedSlotError extends Error {}
class ConflictError extends Error {}

/**
 * PUT /api/leagues/[leagueId]/roster/update
 * Update roster slots for a fantasy team
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { status: true },
    });
    if (user?.status === "suspended") {
      return NextResponse.json(
        { error: "Suspended users cannot edit their roster" },
        { status: 403 }
      );
    }

    const { leagueId } = await params;
    const body = await req.json();
    const { fantasyTeamId, week, roster } = body;

    if (!fantasyTeamId || !week || !roster || !Array.isArray(roster)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Make sure lock state is current before checking it below (e.g. an
    // edit attempted right at the 3am ET boundary shouldn't slip through
    // on stale isLocked values).
    await runAutoLockSweep(leagueId);

    // Verify that the user owns this fantasy team
    const fantasyTeam = await prisma.fantasyTeam.findUnique({
      where: { id: fantasyTeamId },
      select: {
        id: true,
        ownerUserId: true,
        fantasyLeagueId: true,
        league: { select: { draftStatus: true, season: true, currentWeek: true } },
      },
    });

    if (!fantasyTeam) {
      return NextResponse.json({ error: "Fantasy team not found" }, { status: 404 });
    }

    if (fantasyTeam.ownerUserId !== session.user.id) {
      return NextResponse.json(
        { error: "You can only update your own roster" },
        { status: 403 }
      );
    }

    if (fantasyTeam.fantasyLeagueId !== leagueId) {
      return NextResponse.json(
        { error: "Fantasy team does not belong to this league" },
        { status: 400 }
      );
    }

    // Rosters are entirely populated by the draft — there's nothing to edit
    // through this route until it's finished.
    if (fantasyTeam.league.draftStatus !== "completed") {
      return NextResponse.json(
        { error: "Roster changes are not allowed until the draft is complete" },
        { status: 403 }
      );
    }

    // A week that's already over, or whose matches have started, is settled
    // — permanently, regardless of any slot's isLocked flag (which flips
    // back to false once a week ends, since that flag is only ever about
    // "is this week's own active window happening right now," not "is this
    // week done and historical"). The current week specifically stays
    // editable until its matchStart arrives — see isWeekFrozen's own doc
    // comment for why that's not just "week <= currentWeek."
    if (await isWeekFrozen(fantasyTeam.league.season, week, fantasyTeam.league.currentWeek)) {
      return NextResponse.json(
        { error: "This week's matches have already started and its lineup can't be changed" },
        { status: 423 }
      );
    }

    // The incoming roster must never assign the same MLE team to more than
    // one slot — the client's local swap/move logic is trusted for UX, but
    // never for correctness, so this is checked here regardless of how a
    // bad payload could arise (a rapid-click race in the editor, a stale
    // closure, a bug we haven't found yet). Without this, nothing stops a
    // payload that duplicates a team across two slots from being saved
    // verbatim.
    const filledIncoming = roster.filter((slot: any) => slot.mleTeam);
    const seenTeamIds = new Set<string>();
    for (const slot of filledIncoming) {
      if (seenTeamIds.has(slot.mleTeam.id)) {
        return NextResponse.json(
          { error: "That lineup has the same team in more than one slot — refresh and try again" },
          { status: 400 }
        );
      }
      seenTeamIds.add(slot.mleTeam.id);
    }

    // A slot the payload shows as empty (e.g. its team was just swapped
    // into a different slot) needs its existing DB row deleted — RosterSlot
    // has no "empty" representation, so leaving that row in place would
    // duplicate the team across both the old and new slot.
    const emptiedIncoming = roster.filter((slot: any) => !slot.mleTeam);

    // Everything below — the diff against current state and the writes
    // themselves — runs as one transaction so a concurrent save (e.g. a
    // rapid double-click before the Save button's disabled state took
    // effect) can't interleave with this one: the re-read happens inside
    // the same transaction as the writes, and each write is gated on the
    // exact prior state just read, so a losing concurrent save fails
    // cleanly instead of silently interleaving its writes with this one.
    // A genuinely empty active (non-bench) slot has no RosterSlot row, so
    // there's nothing for runAutoLockSweep to have locked — without this
    // check, a manager could drag a team into an empty active slot mid-week
    // once results start coming in, exactly what the lock rule exists to
    // prevent. Only applies to the week actually being edited — future
    // weeks (the cascade below) are never locked yet.
    const activeSlotsLockedThisWeek = await isWeekLocked(fantasyTeam.league.season, week);

    try {
      await prisma.$transaction(async (tx) => {
        const existingSlots = await tx.rosterSlot.findMany({
          where: { fantasyTeamId, week },
        });

        // The client sends the whole roster on every save, not just the
        // slots it actually changed — so "included in the payload" isn't
        // the same as "being edited." Only treat a slot as a real edit if
        // its team assignment actually differs from what's already saved;
        // otherwise a save that only touches two unlocked slots would
        // spuriously get rejected over some other, untouched, already-locked
        // slot that just happened to be present in the full payload.
        const slotsToUpdate = filledIncoming
          .map((slot: any) => {
            const existingSlot = existingSlots.find(
              (s) => s.position === slot.position && s.slotIndex === slot.slotIndex
            );
            return {
              slot,
              existingSlot,
              isActuallyChanging: !existingSlot || existingSlot.mleTeamId !== slot.mleTeam.id,
            };
          })
          .filter((entry) => entry.isActuallyChanging);

        // Slots the payload shows as empty — e.g. a team was swapped out of
        // here into a different slot — need their existing row deleted.
        // Only real if there's actually a row there to clear.
        const slotsToEmpty = emptiedIncoming
          .map((slot: any) => {
            const existingSlot = existingSlots.find(
              (s) => s.position === slot.position && s.slotIndex === slot.slotIndex
            );
            return { slot, existingSlot };
          })
          .filter(
            (entry): entry is { slot: any; existingSlot: NonNullable<typeof entry.existingSlot> } =>
              Boolean(entry.existingSlot)
          );

        // Reject the whole update if it targets any slot an admin has
        // locked — lock state is server-authoritative, never trust the
        // client for it. Applies whether the slot is being reassigned or
        // cleared out.
        const lockedTarget = slotsToUpdate.find((entry) => entry.existingSlot?.isLocked);
        if (lockedTarget) {
          throw new LockedSlotError(
            `Slot ${lockedTarget.slot.position} #${lockedTarget.slot.slotIndex + 1} is locked and cannot be edited`
          );
        }
        const lockedEmptyTarget = slotsToEmpty.find((entry) => entry.existingSlot.isLocked);
        if (lockedEmptyTarget) {
          throw new LockedSlotError(
            `Slot ${lockedEmptyTarget.slot.position} #${lockedEmptyTarget.slot.slotIndex + 1} is locked and cannot be edited`
          );
        }

        // A team already sitting in one of this roster's OTHER slots (not
        // one being updated to move away from it, and not one being cleared
        // out as part of this same save — e.g. the team's old slot when
        // it's moving into a previously-empty one) would also produce a
        // duplicate once these writes land — e.g. a concurrent save already
        // moved a team into a slot this payload doesn't know about yet.
        const updatingSlotKeys = new Set([
          ...slotsToUpdate.map(({ slot }) => `${slot.position}-${slot.slotIndex}`),
          ...slotsToEmpty.map(({ slot }) => `${slot.position}-${slot.slotIndex}`),
        ]);
        for (const { slot } of slotsToUpdate) {
          const clash = existingSlots.find(
            (s) =>
              s.mleTeamId === slot.mleTeam.id &&
              !updatingSlotKeys.has(`${s.position}-${s.slotIndex}`)
          );
          if (clash) {
            throw new ConflictError(
              "This lineup changed before your edit went through — refresh and try again"
            );
          }
        }

        // Update each slot that's actually changing, gated on the exact
        // prior mleTeamId just read so a losing concurrent transaction's
        // write matches zero rows instead of silently overwriting.
        for (const { slot, existingSlot } of slotsToUpdate) {
          if (existingSlot) {
            const result = await tx.rosterSlot.updateMany({
              where: { id: existingSlot.id, mleTeamId: existingSlot.mleTeamId },
              data: { mleTeamId: slot.mleTeam.id },
            });
            if (result.count === 0) {
              throw new ConflictError(
                "This lineup changed before your edit went through — refresh and try again"
              );
            }
          } else {
            // A brand-new slot (no prior row) can't be rejected via the
            // isLocked checks above — those only look at rows that already
            // exist — so a currently-empty active slot needs its own check
            // here instead.
            if (slot.position !== "be" && activeSlotsLockedThisWeek) {
              throw new LockedSlotError(
                `Slot ${slot.position} #${slot.slotIndex + 1} is locked for this week and can't be filled until it unlocks`
              );
            }
            await tx.rosterSlot.create({
              data: {
                id: generateRosterSlotId(fantasyTeamId, week, slot.position, slot.slotIndex),
                fantasyTeamId: fantasyTeamId,
                mleTeamId: slot.mleTeam.id,
                week: week,
                position: slot.position,
                slotIndex: slot.slotIndex,
                isLocked: false,
                fantasyPoints: slot.fantasyPoints || 0,
              },
            });
          }
        }

        // Clear out slots the payload shows as empty — gated the same way,
        // on the exact prior mleTeamId just read.
        for (const { existingSlot } of slotsToEmpty) {
          const result = await tx.rosterSlot.deleteMany({
            where: { id: existingSlot.id, mleTeamId: existingSlot.mleTeamId },
          });
          if (result.count === 0) {
            throw new ConflictError(
              "This lineup changed before your edit went through — refresh and try again"
            );
          }
        }

        // A lineup change applies to this week and every week after it —
        // never the weeks before it (those are done, or already locked).
        // Weeks past this one haven't started yet, so they're never locked
        // and always safe to fully replace with this week's just-saved
        // final state, whether or not they'd already been individually
        // customized before.
        if (week < TOTAL_WEEKS) {
          const finalWeekSlots = await tx.rosterSlot.findMany({
            where: { fantasyTeamId, week },
          });
          await cascadeRosterForward(tx, fantasyTeamId, week + 1, finalWeekSlots);
        }
      });
    } catch (error) {
      if (error instanceof LockedSlotError) {
        return NextResponse.json({ error: error.message }, { status: 423 });
      }
      if (error instanceof ConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: "Roster updated successfully",
    });
  } catch (error) {
    console.error("Error updating roster:", error);
    return NextResponse.json(
      { error: "Failed to update roster" },
      { status: 500 }
    );
  }
}
