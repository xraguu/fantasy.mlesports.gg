import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Same env files Next.js reads, with the same precedence (.env.local wins
// over .env) — `prisma generate` runs from postinstall and from
// `npm run build`, and needs DATABASE_URL from whichever file a machine
// keeps it in (local dev uses .env.local).
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
