import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getPool, q1 } from "./db";
import { sendMail } from "./mail";

const appUrl = process.env.APP_URL || "http://localhost:3000";

export const auth = betterAuth({
  appName: "Rietvalei POS",
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  database: getPool(),
  // Trust APP_URL, plus the origin the request was actually addressed to (same-origin
  // through a reverse proxy or preview host). Cross-site origins are still refused.
  trustedOrigins: (request?: Request) => {
    const out = [appUrl];
    const host = request?.headers.get("x-forwarded-host") ?? request?.headers.get("host");
    const origin = request?.headers.get("origin");
    if (host && origin) {
      try { if (new URL(origin).host === host.split(",")[0].trim()) out.push(origin); } catch { /* ignore */ }
    }
    return out;
  },
  telemetry: { enabled: false },
  // Brute-force protection on sign-in/reset. Only the automated browser tests switch it off.
  rateLimit: { enabled: process.env.AUTH_RATE_LIMIT !== "off" && process.env.NODE_ENV === "production", window: 60, max: 30 },
  emailAndPassword: {
    enabled: true,
    // Accounts are created only by the owner (or initial setup) — never self-service.
    disableSignUp: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      await sendMail(
        user.email,
        "Reset your till password",
        `Someone asked to reset the password for ${user.email}.\n\nOpen this link within one hour to choose a new password:\n${url}\n\nIf this was not you, ignore this message.`,
      );
    },
  },
  session: {
    expiresIn: 60 * 60 * 14, // one trading day
    updateAge: 60 * 30,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "cashier", input: false },
      active: { type: "boolean", required: false, defaultValue: true, input: false },
    },
  },
  advanced: {
    useSecureCookies: appUrl.startsWith("https://"),
  },
  databaseHooks: {
    session: {
      create: {
        // Deactivated staff cannot sign in.
        before: async (session) => {
          const u = await q1<{ active: boolean }>(`SELECT active FROM "user" WHERE id = $1`, [session.userId]);
          if (!u?.active) return false;
        },
      },
    },
  },
  plugins: [nextCookies()],
});
