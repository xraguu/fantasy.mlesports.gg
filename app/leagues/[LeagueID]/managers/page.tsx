// Same page as Opponents — it already self-detects an admin viewing the
// league without a team of their own (see the isAdminViewing check in
// opponents/page.tsx) and adjusts its title/hides Propose Trade accordingly.
// This route exists as a stable, dedicated URL for the admin nav's
// "Managers" link, rather than duplicating that page's logic.
export { default } from "../opponents/page";
