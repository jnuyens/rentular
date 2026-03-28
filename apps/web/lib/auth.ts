import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import Facebook from "next-auth/providers/facebook";
import Twitter from "next-auth/providers/twitter";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { getDb, users } from "@rentular/db";

const db = getDb();
const providers: Provider[] = [];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    })
  );
}

if (process.env.AUTH_FACEBOOK_ID && process.env.AUTH_FACEBOOK_SECRET) {
  providers.push(
    Facebook({
      clientId: process.env.AUTH_FACEBOOK_ID,
      clientSecret: process.env.AUTH_FACEBOOK_SECRET,
      allowDangerousEmailAccountLinking: true,
    })
  );
}

if (process.env.AUTH_TWITTER_ID && process.env.AUTH_TWITTER_SECRET) {
  providers.push(
    Twitter({
      clientId: process.env.AUTH_TWITTER_ID,
      clientSecret: process.env.AUTH_TWITTER_SECRET,
      allowDangerousEmailAccountLinking: true,
    })
  );
}

providers.push(
  Credentials({
    name: "Email",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;

      const email = String(credentials.email).trim().toLowerCase();
      const password = String(credentials.password);
      if (password.length < 12) return null;

      const result = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      const user = result[0];
      if (!user?.passwordHash) return null;

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return null;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      };
    },
  })
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  providers,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        // Use email as the canonical user identifier so that different
        // OAuth providers (Google, Facebook, Twitter) or credentials
        // all map to the same user when they share the same email.
        // The API middleware (authMiddleware.ts) looks up users by email
        // to ensure data consistency across login methods.
        token.id = user.id!;
        token.email = user.email!;
        token.provider = account?.provider;

        // Fetch onboarding status from database to avoid per-request DB queries
        try {
          const db = getDb();
          const dbUser = await db
            .select({ onboardingComplete: users.onboardingComplete })
            .from(users)
            .where(eq(users.email, user.email!))
            .limit(1);
          token.onboardingComplete = dbUser[0]?.onboardingComplete ?? false;
        } catch {
          // Database unavailable at sign-in; default to incomplete
          token.onboardingComplete = false;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        if (token.email) session.user.email = token.email as string;
      }
      session.onboardingComplete = token.onboardingComplete;
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },
});
