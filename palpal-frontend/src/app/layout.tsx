import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ErrorBoundary from "@/components/ErrorBoundary";
import ClientWrapper from "@/components/ClientWrapper";
import { Suspense } from "react";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "palpal - The Podcast Search Engine",
  description: "The most intelligent search engine for your favorite podcasts",
  icons: {
    icon: '/favicon.ico',
  },
  other: {
    'google-adsense-account': 'ca-pub-9729536753725968',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9729536753725968"
     crossOrigin="anonymous"></script>
      </head>
      <body
        className={`${inter.variable} antialiased`}
        suppressHydrationWarning
      >
        <ErrorBoundary>
          <ClientWrapper>
            <Suspense fallback={<div>Loading...</div>}>
              {children}
            </Suspense>
          </ClientWrapper>
        </ErrorBoundary>
      </body>
    </html>
  );
}
