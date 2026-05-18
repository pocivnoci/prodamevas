import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Chrlit — Posty na Instagram za pár minut | AI obsah pro firmy",
  description: "Zadejte web svého podnikání a dostanete měsíc hotového obsahu na Instagram — texty, obrázky, hashtagy. Bez grafika, bez copywritera. Od 490 Kč měsíčně.",
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
    description: "Měsíc obsahu bez grafika a copywritera. Od 490 Kč.",
    images: ["/chrlit-logo.png"],
  },
  robots: { index: true, follow: true },
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
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
      </head>
      <body
        className={`${inter.className} antialiased selection:bg-aisummit-cinnabar/30 selection:text-white bg-aisummit-bg text-aisummit-text`}
      >
        {/* PWA Splash Screen */}
        <div id="splash" style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: '#050505',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          transition: 'opacity 0.5s ease, visibility 0.5s ease',
        }}>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes splash-pulse {
              0%, 100% { transform: scale(1); opacity: 0.9; }
              50% { transform: scale(1.08); opacity: 1; }
            }
            @keyframes splash-glow {
              0%, 100% { box-shadow: 0 0 20px rgba(192,57,43,0), 0 0 60px rgba(192,57,43,0); }
              50% { box-shadow: 0 0 30px rgba(192,57,43,0.3), 0 0 80px rgba(192,57,43,0.1); }
            }
            @keyframes splash-text {
              0% { opacity: 0; transform: translateY(8px); }
              100% { opacity: 1; transform: translateY(0); }
            }
            @keyframes splash-bar {
              0% { width: 0%; }
              100% { width: 100%; }
            }
            #splash-logo {
              width: 72px; height: 72px; border-radius: 16px;
              animation: splash-pulse 2s ease-in-out infinite, splash-glow 2s ease-in-out infinite;
            }
            #splash-name {
              margin-top: 20px; font-size: 24px; font-weight: 900;
              letter-spacing: -0.03em; text-transform: uppercase;
              color: #fff; opacity: 0;
              animation: splash-text 0.6s ease forwards 0.3s;
            }
            #splash-name span { color: #c0392b; }
            #splash-sub {
              margin-top: 6px; font-size: 9px; font-weight: 700;
              letter-spacing: 0.25em; text-transform: uppercase;
              color: rgba(255,255,255,0.25); opacity: 0;
              animation: splash-text 0.6s ease forwards 0.5s;
            }
            #splash-progress {
              margin-top: 32px; width: 120px; height: 2px;
              background: rgba(255,255,255,0.05); border-radius: 2px;
              overflow: hidden; opacity: 0;
              animation: splash-text 0.4s ease forwards 0.7s;
            }
            #splash-progress-bar {
              height: 100%; background: linear-gradient(90deg, #c0392b, #e74c3c);
              border-radius: 2px;
              animation: splash-bar 1.8s ease-in-out forwards 0.8s;
            }
          `}} />
          <img id="splash-logo" src="/icon-512.png" alt="" />
          <div id="splash-name">Chrl<span>it</span></div>
          <div id="splash-sub">AI Instagram Studio</div>
          <div id="splash-progress"><div id="splash-progress-bar" /></div>
        </div>

        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(console.error)})}
window.addEventListener('load',()=>{
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
