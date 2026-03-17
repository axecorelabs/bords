import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import { Toaster } from "react-hot-toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "600"],
});

export const metadata = {
  title: "BORDS | Visual Productivity Platform",
  description: "Organize tasks, ideas, and projects with drag-and-drop boards, sticky notes, and checklists — all in a flexible, minimalist workspace.",
  keywords: "productivity, task management, kanban, visual workspace, project management, sticky notes, drag and drop",
  authors: [{ name: "AXECORE Labs" }],
  openGraph: {
    title: "BORDS | Visual Productivity Platform",
    description: "Organize tasks, ideas, and projects with drag-and-drop boards, sticky notes, and checklists.",
    type: "website",
    locale: "en_US",
    siteName: "BORDS",
  },
  twitter: {
    card: "summary_large_image",
    title: "BORDS | Visual Productivity Platform",
    description: "Organize tasks, ideas, and projects with drag-and-drop boards, sticky notes, and checklists.",
  },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var stored = JSON.parse(localStorage.getItem('theme-storage') || '{}');
                var isDark = stored && stored.state && stored.state.isDark;
                if (isDark !== false) {
                  document.documentElement.classList.add('dark');
                  document.documentElement.style.colorScheme = 'dark';
                  document.documentElement.style.backgroundColor = '#18181b';
                } else {
                  document.documentElement.style.colorScheme = 'light';
                  document.documentElement.style.backgroundColor = '#f4f4f5';
                }
              } catch(e) {}
              document.documentElement.classList.add('no-transitions');
              window.addEventListener('DOMContentLoaded', function() {
                requestAnimationFrame(function() {
                  document.documentElement.classList.remove('no-transitions');
                });
              });
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          {children}
          <Toaster position="top-right" />
        </AuthProvider>
      </body>
    </html>
  );
}
