import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Chrlit — AI Autopilot pro Instagram | Chrlíme obsah, ale kvalitní",
  description: "Vygenerujte měsíc Instagram obsahu za 2 minuty. AI analyzuje váš brand, vytvoří captiony, obrázky i reels. Pro e-shopy, freelancery a agentury.",
  keywords: ["instagram autopilot", "AI obsah", "generování postů", "automatizace sociálních sítí", "content marketing", "AI marketing", "chrlit"],
  icons: {
    icon: "/favicon.ico",
    apple: "/chrlit-icon.png",
  },
  openGraph: {
    title: "Chrlit — AI Autopilot pro Instagram",
    description: "Vygenerujte měsíc Instagram obsahu za 2 minuty. AI captiony, obrázky, reels.",
    url: "https://chrlit.cz",
    siteName: "Chrlit",
    images: [{ url: "/chrlit-logo.png", width: 1024, height: 1024, alt: "Chrlit Logo" }],
    locale: "cs_CZ",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Chrlit — AI Autopilot pro Instagram",
    description: "Vygenerujte měsíc Instagram obsahu za 2 minuty.",
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
      <body
        className={`${inter.className} antialiased selection:bg-aisummit-cinnabar/30 selection:text-white bg-aisummit-bg text-aisummit-text`}
      >
        {children}
      </body>
    </html>
  );
}
