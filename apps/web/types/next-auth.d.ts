import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    onboardingComplete: boolean;
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    email?: string | null;
    provider?: string;
    onboardingComplete: boolean;
  }
}
