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
    apple: "/chrlit-icon.png",
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
      <body
        className={`${inter.className} antialiased selection:bg-aisummit-cinnabar/30 selection:text-white bg-aisummit-bg text-aisummit-text`}
      >
        {children}
      </body>
    </html>
  );
}
