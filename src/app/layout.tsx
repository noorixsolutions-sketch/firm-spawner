import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/firm-forge/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Firm Forge — Company Spawner Workspace",
  description:
    "Compose, validate and end-to-end test digital companies spawned from the company-spawner skill template: agents, plugins, secrets by name, deterministic validators and a real task pipeline.",
  keywords: [
    "company-spawner",
    "firm template",
    "Firm Forge",
    "agent workspace",
    "free-only infrastructure",
  ],
  authors: [{ name: "Firm Forge" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Firm Forge — Company Spawner Workspace",
    description:
      "Spawn firms from the template, validate with deterministic scripts, run a real end-to-end pipeline.",
    siteName: "Firm Forge",
    type: "website",
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
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
