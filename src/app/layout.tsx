import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BMKG METAR Viewer - Indonesian Aviation Weather",
  description: "Real-time METAR/SPECI data from BMKG Indonesia with decoded weather reports",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-[#f8fafc]">{children}</body>
    </html>
  );
}
