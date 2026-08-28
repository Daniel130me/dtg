import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { NavigationProvider } from "@/lib/prototype/navigation";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DTG - Learn from the Best | Online Courses",
  description: "DTG is a premier online learning platform offering expert-led courses in web development, data science, mobile development, and more.",
  keywords: ["DTG", "online courses", "web development", "data science", "learning", "education"],
  authors: [{ name: "DTG" }],
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <NavigationProvider>{children}</NavigationProvider>
        <Toaster />
      </body>
    </html>
  );
}
