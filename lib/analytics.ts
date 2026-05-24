/**
 * Analytics utilities — separate from GoogleAnalytics component
 * to avoid pulling next/script into client component bundles
 * (which causes React #310 in production builds).
 */

export function trackEvent(name: string, params?: Record<string, string | number | boolean>) {
    if (typeof window !== "undefined" && typeof (window as any).gtag === "function") {
        ;(window as any).gtag("event", name, params)
    }
}
