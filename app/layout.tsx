import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { CookieConsent } from "@/components/CookieConsent";
import { lowestPriceClaim } from "@/lib/pricing";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Chrlit — Posty na Instagram za pár minut | AI obsah pro firmy",
  // Cena se do popisku dosazuje z ceníku — natvrdo napsaná přežije každou
  // změnu ceníku a Google ji indexuje ještě měsíce potom.
  description: `Zadejte web svého podnikání a dostanete měsíc hotového obsahu na Instagram — texty, obrázky, hashtagy. Bez grafika, bez copywritera. ${lowestPriceClaim().replace(/^od/, "Od")}.`,
  keywords: ["instagram posty", "obsah na sociální sítě", "AI obsah pro firmy", "generování příspěvků", "správa Instagramu", "chrlit", "obsah bez grafika"],
  icons: {
    icon: "/favicon.ico",
    apple: "/icon-192.png",
  },
  manifest: "/manifest.json",
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
  openGraph: {
    title: "Chrlit — Posty na Instagram za pár minut",
    description: "Měsíc obsahu na Instagram — texty, obrázky, hashtagy. Bez grafika, bez copywritera.",
    url: "https://chrlit.cz",
    siteName: "Chrlit",
    images: [{ url: "/chrlit-logo.png", width: 1024, height: 1024, alt: "Chrlit Logo" }],
    locale: "cs_CZ",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Chrlit — Posty na Instagram za pár minut",
    description: `Měsíc obsahu bez grafika a copywritera. ${lowestPriceClaim().replace(/^od/, "Od")}.`,
    images: ["/chrlit-logo.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Přibližování zůstává povolené — zakázat ho je porušení WCAG 1.4.4 a iOS to
  // stejně ignoruje. Dvojité ťuknutí hlídá `touch-action: manipulation`
  // v globals.css, což na pinch nesahá.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs" className={`${inter.variable}`}>
      <head>
        <meta name="theme-color" content="#050505" />
        {/* Show the branded splash only on the FIRST load of a session. On any later
            full-document load (e.g. a hard nav back to "/" via a #anchor from the blog),
            mark it seen synchronously here — before the body paints — so the splash is
            hidden instantly with no replayed animation (QA #9). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem('chrlit_splash_seen')){document.documentElement.setAttribute('data-splash','seen')}}catch(e){}`,
          }}
        />
        {/* Nabídku instalace pošle Chromium hned po načtení — dřív, než se React
            namountuje. Bez tohohle odchycení by zmizela a tlačítko „Nainstalovat"
            by nešlo nabídnout (components/InstallApp.tsx si ji vyzvedne tady). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__chrlitInstall=e});window.addEventListener('appinstalled',function(){window.__chrlitInstall=null});`,
          }}
        />
      </head>
      <body
        className={`${inter.className} antialiased selection:bg-aisummit-cinnabar/30 selection:text-white bg-aisummit-bg text-aisummit-text`}
      >
        <GoogleAnalytics />
        <CookieConsent />
        {/* PWA Splash Screen — Premium */}
        <div id="splash" style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: '#030303',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.6s',
        }}>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes splash-breathe {
              0%, 100% { transform: scale(1); filter: brightness(1); }
              50% { transform: scale(1.04); filter: brightness(1.15); }
            }
            @keyframes splash-glow-ring {
              0% { transform: scale(0.8); opacity: 0; }
              50% { opacity: 0.6; }
              100% { transform: scale(2.5); opacity: 0; }
            }
            @keyframes splash-reveal {
              0% { opacity: 0; transform: translateY(12px); filter: blur(4px); }
              100% { opacity: 1; transform: translateY(0); filter: blur(0); }
            }
            @keyframes splash-bar-fill {
              0% { width: 0%; }
              60% { width: 70%; }
              100% { width: 100%; }
            }
            @keyframes splash-dot {
              0%, 100% { opacity: 0; transform: translateY(0) scale(0.5); }
              50% { opacity: 1; transform: translateY(-20px) scale(1); }
            }
            #splash-backdrop {
              position: absolute; width: 300px; height: 300px;
              background: radial-gradient(circle, rgba(230,57,70,0.15) 0%, transparent 70%);
              border-radius: 50%; filter: blur(60px);
              animation: splash-breathe 3s ease-in-out infinite;
            }
            #splash-ring {
              position: absolute; width: 80px; height: 80px;
              border: 1px solid rgba(230,57,70,0.3);
              border-radius: 50%;
              animation: splash-glow-ring 2s ease-out infinite;
            }
            #splash-logo-wrap {
              position: relative; z-index: 2;
              animation: splash-breathe 3s ease-in-out infinite;
            }
            #splash-logo-wrap img {
              height: 48px; filter: drop-shadow(0 0 30px rgba(230,57,70,0.4));
            }
            #splash-sub {
              margin-top: 16px; font-size: 8px; font-weight: 700;
              letter-spacing: 0.35em; text-transform: uppercase;
              color: rgba(255,255,255,0.2); opacity: 0;
              animation: splash-reveal 0.7s cubic-bezier(0.16,1,0.3,1) forwards 0.4s;
            }
            #splash-progress {
              margin-top: 40px; width: 100px; height: 1.5px;
              background: rgba(255,255,255,0.04); border-radius: 2px;
              overflow: hidden; opacity: 0;
              animation: splash-reveal 0.4s ease forwards 0.6s;
            }
            #splash-progress-bar {
              height: 100%;
              background: linear-gradient(90deg, #c0392b, #e74c3c, #ff6b6b);
              border-radius: 2px;
              animation: splash-bar-fill 1.6s cubic-bezier(0.4,0,0.2,1) forwards 0.7s;
              box-shadow: 0 0 8px rgba(230,57,70,0.6);
            }
            .splash-dot {
              position: absolute; width: 2px; height: 2px;
              background: rgba(230,57,70,0.4); border-radius: 50%;
              animation: splash-dot 3s ease-in-out infinite;
            }
            /* Already shown this session → never paint it again (set in <head>). */
            html[data-splash="seen"] #splash { display: none !important; }
          `}} />
          <div id="splash-backdrop" />
          <div id="splash-ring" />
          <div className="splash-dot" style={{ left: '30%', top: '35%', animationDelay: '0s' }} />
          <div className="splash-dot" style={{ left: '65%', top: '40%', animationDelay: '0.8s' }} />
          <div className="splash-dot" style={{ left: '45%', top: '65%', animationDelay: '1.6s' }} />
          <div className="splash-dot" style={{ left: '70%', top: '60%', animationDelay: '0.4s' }} />
          <div className="splash-dot" style={{ left: '25%', top: '55%', animationDelay: '1.2s' }} />
          <div id="splash-logo-wrap">
            <img src="/chrlit-logo-transparent.svg" alt="" />
          </div>
          <div id="splash-sub">AI Content Studio</div>
          <div id="splash-progress"><div id="splash-progress-bar" /></div>
        </div>

        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(console.error)})}
window.addEventListener('load',()=>{
  try{sessionStorage.setItem('chrlit_splash_seen','1')}catch(e){}
  setTimeout(()=>{
    var s=document.getElementById('splash');
    if(s){
      s.style.opacity='0';
      s.style.visibility='hidden';
      s.style.pointerEvents='none';
      setTimeout(()=>s.style.display='none',500);
    }
  },1200)
})`,
          }}
        />
      </body>
    </html>
  );
}
