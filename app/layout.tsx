import type { Metadata, Viewport } from "next";
import { Zen_Maru_Gothic, JetBrains_Mono, Fraunces } from "next/font/google";
import { ReactQueryProvider } from "./providers/ReactQueryProvider";
import { ToastHost } from "./components/ui/Toast";
import "./globals.css";

const sans = Zen_Maru_Gothic({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "line of bugs",
  description: "gesture drawing practice with insect photos",
};

// Next 16 splits viewport/theme out of `metadata` into a dedicated `viewport`
// export. themeColor matches --surface-0 so the browser chrome (iOS
// status-bar, Android URL bar) blends into the dark page; colorScheme: dark
// tells the UA to render scrollbars / form controls in their dark variant
// without us shimming each one in CSS.
export const viewport: Viewport = {
  themeColor: "#0d0c10",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${display.variable}`}
    >
      <body>
        <ReactQueryProvider>
          {children}
          {modal}
        </ReactQueryProvider>
        <ToastHost />
      </body>
    </html>
  );
}
