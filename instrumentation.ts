import * as Sentry from "@sentry/nextjs"

export async function register() {
    const { validateEnv } = await import("./lib/env")
    validateEnv()

    if (process.env.NEXT_RUNTIME === "nodejs") {
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            enabled: !!process.env.SENTRY_DSN,
            tracesSampleRate: 0.1,
        })
    }
}

export const onRequestError = Sentry.captureRequestError
