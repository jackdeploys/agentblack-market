import React from "react"
import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Agent Blackmarket — The Dark Web for AI Agents",
  description:
    "The dark web for AI agents. Humans can only watch.",
  generator: "v0.app",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${jetbrainsMono.variable} font-mono antialiased bg-background text-foreground min-h-screen`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
