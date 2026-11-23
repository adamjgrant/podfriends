import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { getAllAllowedOrigins, type ProjectBindings } from "./projects";

export interface Env extends ProjectBindings {
  AUTH_DB: D1Database;
  BETTER_AUTH_SECRET: string;
  OWNER_EMAILS?: string;
  ENABLE_EMAIL_PASSWORD?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export function createAuth(env: Env, request: Request) {
  const baseURL = new URL(request.url).origin;
  const enableEmailPassword = env.ENABLE_EMAIL_PASSWORD === "true";

  return betterAuth({
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    basePath: "/api/auth",
    trustedOrigins: getAllAllowedOrigins(),
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : undefined,
    emailAndPassword: {
      enabled: enableEmailPassword,
    },
    plugins: [bearer()],
  });
}
