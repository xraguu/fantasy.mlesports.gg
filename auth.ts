import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.AUTH_DISCORD_ID!,
      clientSecret: process.env.AUTH_DISCORD_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      // Create or update user in database on sign in
      try {
        if (profile && profile.id) {
          const adminIds = process.env.ADMIN_DISCORD_IDS?.split(',') || [];
          const role = adminIds.includes(profile.id as string) ? 'admin' : 'user';

          await prisma.user.upsert({
            where: { discordId: profile.id as string },
            update: {
              displayName: user.name || "Unknown User",
              avatarUrl: user.image || null,
              // role is intentionally NOT overwritten here — admin-panel role
              // changes must persist across sign-ins. ADMIN_DISCORD_IDS only
              // seeds the role for brand-new users (see `create` below).
            },
            create: {
              id: randomUUID(),
              discordId: profile.id as string,
              displayName: user.name || "Unknown User",
              avatarUrl: user.image || null,
              role,
            },
          });
        }
      } catch (error) {
        console.error("Error creating/updating user in database:", error);
        // Still allow sign in even if database update fails
      }
      return true;
    },
    async jwt({ token, profile }) {
      // Add Discord ID and role to JWT token
      if (profile) {
        token.discordId = profile.id;

        // Check if user is admin based on Discord ID
        const adminIds = process.env.ADMIN_DISCORD_IDS?.split(',') || [];
        token.role = adminIds.includes(profile.id as string) ? 'admin' : 'user';
      }

      // Always fetch the latest role from database if we have a discordId
      // This ensures role changes take effect without requiring re-login
      if (token.discordId) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { discordId: token.discordId as string },
          });
          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role;
          }
        } catch (error) {
          console.error("Error fetching user from database:", error);
          // Continue with existing token data if database error
        }
      }

      return token;
    },
    async session({ session, token }) {
      // Add Discord ID, user ID, and role to session
      if (session.user) {
        session.user.id = token.id as string;
        session.user.discordId = token.discordId as string;
        session.user.role = token.role as 'admin' | 'user';
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  trustHost: true, // Required for Vercel deployment
});
