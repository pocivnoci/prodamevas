"use client"

import Script from "next/script"

const GA_ID = process.env.NEXT_PUBLIC_GA_ID

export function GoogleAnalytics() {
    if (!GA_ID) return null

    return (
        <>
            <Script
                src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
                strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
                {`
                    window.dataLayer = window.dataLayer || [];
                    function gtag(){dataLayer.push(arguments);}
                    gtag('js', new Date());
                    // Výchozí stav je ODMÍTNUTO a musí být nastavený dřív, než se
                    // pošle 'config' — souhlas udělený až potom by nezabránil
                    // prvnímu měření, tedy přesně tomu, co má souhlas hlídat.
                    // Na 'granted' to přepne až CookieConsent přes consent update.
                    gtag('consent', 'default', {
                        'analytics_storage': 'denied'
                    });
                    try {
                        if (localStorage.getItem('chrlit-cookie-consent') === 'granted') {
                            gtag('consent', 'update', { 'analytics_storage': 'granted' });
                        }
                    } catch (e) { /* bez úložiště zůstává odmítnuto */ }
                    gtag('config', '${GA_ID}', {
                        page_path: window.location.pathname,
                    });
                `}
            </Script>
        </>
    )
}

// Reusable event tracking utility
export function trackEvent(eventName: string, params?: Record<string, string | number | boolean>) {
    if (typeof window !== "undefined" && typeof (window as any).gtag === "function") {
        ;(window as any).gtag("event", eventName, params)
    }
}
