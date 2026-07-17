import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PrefsProvider } from "@/lib/prefs";

// Runs before paint to apply the saved theme immediately (no flash).
const themeScript = `try{var p=JSON.parse(localStorage.getItem('rtg_prefs')||'{}');document.documentElement.setAttribute('data-theme',p.theme==='dark'?'dark':'light');if(p.lang){document.documentElement.setAttribute('lang',p.lang);}}catch(e){}`;

export const metadata: Metadata = {
  title: "RDZ Deliveries | Order & Dispatch",
  description: "Delivery order management: sales create orders, the office manager approves, the warehouse fulfills.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "RDZ Deliveries" },
};

export const viewport: Viewport = {
  themeColor: "#152238",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PrefsProvider>{children}</PrefsProvider>
      </body>
    </html>
  );
}
