import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ErrorBoundary from "@/components/ErrorBoundary";
import ClientWrapper from "@/components/ClientWrapper";
import WhatsNewBubble from "@/components/WhatsNewBubble";
import { Suspense } from "react";
import { getWhatsNew } from "@/lib/conductor";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "palpal - The Podcast Search Engine",
  description: "Search every word of your favorite podcasts",
  icons: {
    icon: '/favicon.ico',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const whatsNewData = await getWhatsNew();
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} antialiased`}
        suppressHydrationWarning
      >
        <ErrorBoundary>
          <ClientWrapper>
            <Suspense fallback={<div>Loading...</div>}>
              {children}
            </Suspense>
            <WhatsNewBubble initialData={whatsNewData} />
          </ClientWrapper>
        </ErrorBoundary>
      </body>
    </html>
  );
}
