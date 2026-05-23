import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sonar — Market Intelligence Radar",
  description:
    "An autonomous agent that fuses news, social, and prediction markets, detects divergence, and publishes grounded, cited briefs other agents pay to read.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
