import type { Metadata } from "next";
import "./globals.css";
import localFont from "next/font/local";
const mono=localFont({src:"./fonts/GeistMonoVF.woff",variable:"--font-terminal-mono",display:"swap"});
import Providers from "./providers";

export const metadata: Metadata = {
  title: "ValueInsight · 估值研究终端",
  description: "DCF 估值穿透与弹性空间测算终端",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`dark ${mono.variable}`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
