import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "ProdámeVás.cz | Autopilot pro váš Instagram",
  description: "Vygenerujte měsíc obsahu pro váš e-shop nebo osobní brand za pár minut. Od strategií, přes texty až po generování produktových mockupdate pomocí AI.",
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
