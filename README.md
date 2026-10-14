# MLE Fantasy

The fantasy league site for [Minor League Esports](https://mlesports.gg) (MLE) Rocket League, live at **[fantasy.mlesports.gg](https://fantasy.mlesports.gg)**.

Managers draft real MLE teams (not individual players) into 2s, 3s and flex slots, set a lineup each week, and score points from those teams' real match stats. They play head-to-head each week, and the top teams go to the playoffs.

## Features

- **Discord sign-in.** Everyone signs in with their Discord account. The first admins are set by Discord ID, and admins can make other users admins.
- **Drafts.** Snake or linear drafts with a pick timer. A manager can turn on autodraft, and the site picks for anyone whose timer runs out.
- **Rosters and lineups.** Each league sets its number of 2s, 3s, flex and bench slots. Lineups lock automatically when a week's matches start.
- **Waivers.** FAAB bidding or waiver priority, processed on a schedule the admins set.
- **Trades.** Managers propose and accept trades, and admins have a 12-hour window to veto each one.
- **Scoring.** Stats come from MLE's public Sprocket datasets and refresh every 2 hours. Admins can override a team's stats by hand.
- **Matchups, standings and playoffs.** Weekly scoreboards, standings, playoff brackets and final standings.
- **Discord DM notifications.** Optional DMs for draft turns, trades, waiver results, lineup reminders and weekly results. See [Discord notifications](#discord-notifications).
- **Admin panel.** Manages leagues, users, stats, waivers and transactions, lineup locks, season settings, database health and notifications.

### Default scoring

An MLE team in a starting slot earns points for its real stats in that game mode. Admins can change these values for each season under **Admin → Settings**.

| Stat | Points |
| --- | --- |
| Goal | 2 |
| Assist | 1.5 |
| Save | 1 |
| Shot | 0.1 |
| Demo inflicted | 0.5 |
| Demo taken | −0.5 |
| Game won | 10 |
| Game lost | 0 |
| Sprocket Rating bonus | 0 (0–30), 5 (31–50), 10 (51–70), 15 (71–90), 20 (91–100) |

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router), React 19 and TypeScript
- PostgreSQL through [Prisma](https://www.prisma.io) 6
- [Auth.js](https://authjs.dev) (NextAuth v5) with the Discord provider
- Tailwind CSS 4
- In production, a Docker container on a DigitalOcean droplet behind Nginx

## Running it locally

You need Node.js 20 or later, a PostgreSQL database, and a Discord application for sign-in (see [DISCORD_AUTH_SETUP.md](DISCORD_AUTH_SETUP.md), but use the variable names below).

1. Install dependencies. This also generates the Prisma client.
   ```bash
   npm install
   ```
2. Create a `.env.local` file in the project root with the [environment variables](#environment-variables) below.
3. Create the database tables.
   ```bash
   npx prisma db push
   ```
4. Load the MLE leagues, teams and players from `exports/`, then the stats from `data/csv/`.
   ```bash
   npx tsx scripts/import-mle-data.ts
   npm run import:csv
   ```
5. Start the site, open [http://localhost:3000](http://localhost:3000), and sign in with Discord.
   ```bash
   npm run dev
   ```

In Discord's developer portal, add `http://localhost:3000/api/auth/callback/discord` as a redirect URL for local sign-in.

## Environment variables

Locally these go in `.env.local`; on the server, in `.env` next to the Docker Compose file. Both are covered by `.gitignore`. **Never commit real values**, including in documentation.

| Variable | Required | What it's for |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | Signs sign-in sessions. Generate one with `openssl rand -base64 32` |
| `AUTH_URL` | In production | The site's public address, such as `https://fantasy.mlesports.gg`. Also used for links in DMs |
| `AUTH_DISCORD_ID` | Yes | The Discord application's client ID |
| `AUTH_DISCORD_SECRET` | Yes | The Discord application's client secret |
| `ADMIN_DISCORD_IDS` | Yes | Comma-separated Discord user IDs (no spaces) that become admins on their first sign-in. After that, roles are changed on the admin Users page |
| `DISCORD_BOT_TOKEN` | No | The bot token for DM notifications. Without it, no DMs are sent |
| `CRON_SECRET` | No | Protects `/api/cron/refresh-stats`. Without it, that endpoint works for anyone and logs a warning |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development server |
| `npm run build` | Generates the Prisma client and builds for production |
| `npm start` | Runs the production build |
| `npm run lint` | Runs ESLint |
| `npx tsc --noEmit` | Type-checks the project |
| `npm run import:csv` | Imports MLE data from `data/csv/` |

The `scripts/` folder holds one-off maintenance and data scripts, run with `npx tsx scripts/<name>.ts`. They act on whatever database `DATABASE_URL` points to, so check it before running one.

## Changing the database

Edit [`prisma/schema.prisma`](prisma/schema.prisma), then apply it with:

```bash
npx prisma db push
```

The project applies schema changes with `db push`. The `prisma/migrations` folder records only a few of them, so it can't rebuild the database from scratch.

## Background jobs

The site runs its own scheduled jobs inside the server process, started from [`instrumentation.ts`](instrumentation.ts). Nothing else needs to be set up, but **run only one copy of the app**, or the jobs would run twice.

| Job | Runs every | What it does |
| --- | --- | --- |
| Stats refresh | 2 hours (first run 30 seconds after start) | Advances weeks and locks lineups, processes waivers that are due, imports Sprocket stats and recalculates scores |
| Draft timer | 10 seconds | Makes the automatic pick when a draft pick's timer runs out |
| Trade veto window | 1 minute | Completes trades whose 12-hour veto window has ended |
| DM sender | 15 seconds | Sends queued Discord DMs |
| Notification checks | 15 minutes | Queues weekly results, lineup reminders and admin alerts |

## Discord notifications

The site can DM managers and admins through a Discord bot. It only sends one-way messages; it doesn't read messages or take commands.

- The bot is the "Bot" of the same Discord application used for sign-in. Set its token as `DISCORD_BOT_TOKEN`.
- The bot must be in the MLE Discord server. Discord only lets it DM members of a server it shares with them who allow DMs from that server's members.
- Users turn each type of DM on or off under **Notifications** on the home page.
- The admin **Notifications** page shows whether the bot is set up, what was sent recently and any failures. It also has a button to send yourself a test DM.

The code lives in [`lib/discord.ts`](lib/discord.ts) (talking to Discord), [`lib/notifications.ts`](lib/notifications.ts) (the queue and sender), [`lib/notificationEvents.ts`](lib/notificationEvents.ts) (messages for things people do) and [`lib/notificationChecks.ts`](lib/notificationChecks.ts) (calendar-based messages).

## Project layout

| Folder | What's in it |
| --- | --- |
| `app/` | Pages (`app/leagues/…` for managers, `app/admin/…` for admins) and API routes (`app/api/…`) |
| `components/` | Shared React components |
| `lib/` | The site's rules: drafts, rosters, waivers, trades, scoring, stats import and notifications |
| `prisma/` | Database schema |
| `scripts/` | Maintenance and data-import scripts |
| `data/csv/`, `exports/` | MLE source data for the import scripts |

## Deploying

Production runs as a Docker container on a DigitalOcean droplet, behind Nginx with a Let's Encrypt certificate. To deploy or update, run `deploy-cloud.sh` on the server. It uses [`docker-compose.production.yml`](docker-compose.production.yml), which passes the whole `.env` file into the container.

Avoid the plain `docker-compose.yml` for production. It passes only a fixed list of variables, so `DISCORD_BOT_TOKEN` and `CRON_SECRET` would not reach the app.

Step-by-step guides:

- [CLOUD-DEPLOY-QUICK-START.md](CLOUD-DEPLOY-QUICK-START.md): server setup, Nginx, SSL and the deploy script
- [DEPLOYMENT.md](DEPLOYMENT.md): the same in more detail, plus troubleshooting and backups
- [DISCORD_AUTH_SETUP.md](DISCORD_AUTH_SETUP.md): creating the Discord application. Its variable names are out of date; use the ones above.

For production sign-in, add `https://<your domain>/api/auth/callback/discord` as a redirect URL in Discord's developer portal.
