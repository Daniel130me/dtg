import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { NavigationProvider } from "@/lib/prototype/navigation";
import { StudentDataProvider } from "@/lib/prototype/student-data";

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
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "DTG",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

// App-like mobile viewport: `viewportFit: cover` lets us paint under the
// status bar / home indicator and pad with safe-area insets instead.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a1a3e",
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
        suppressHydrationWarning
      >
        <NavigationProvider>
          <StudentDataProvider>{children}</StudentDataProvider>
        </NavigationProvider>
        <Toaster />
      </body>
    </html>
  );
}
