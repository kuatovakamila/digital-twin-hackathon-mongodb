import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import "./globals.css";

/** Panel heading only — everything else stays on the system sans stack. */
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Rehearsal Room",
  description: "Practice the conversation out loud, against a model of the person.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={instrumentSerif.variable}>
      <body>{children}</body>
    </html>
  );
}
