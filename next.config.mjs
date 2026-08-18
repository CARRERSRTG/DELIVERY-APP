import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// org/project/authToken come from SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN
// (Vercel env, build-time only) rather than being written here — same rule as
// every other credential in this project.
export default withSentryConfig(nextConfig, {
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
