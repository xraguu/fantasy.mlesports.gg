// app/layout.tsx
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import SessionProvider from "@/components/SessionProvider";
import AlertProvider from "@/components/AlertProvider";

const industry = localFont({
  src: [
    {
      path: "../Fonts/Industry/Industry-Light.woff",
      weight: "300",
      style: "normal",
    },
    {
      path: "../Fonts/Industry/Industry-Book.woff",
      weight: "400",
      style: "normal",
    },
    {
      path: "../Fonts/Industry/Industry-Medium.woff",
      weight: "500",
      style: "normal",
    },
    {
      path: "../Fonts/Industry/Industry-Demi.woff",
      weight: "600",
      style: "normal",
    },
    {
      path: "../Fonts/Industry/Industry-Bold.woff",
      weight: "700",
      style: "normal",
    },
    {
      path: "../Fonts/Industry/Industry-Black.woff",
      weight: "900",
      style: "normal",
    },
  ],
  variable: "--font-industry",
});

const zuume = localFont({
  src: [
    {
      path: "../Fonts/zuume-cufonfonts/Zuume Light.ttf",
      weight: "300",
      style: "normal",
    },
    {
      path: "../Fonts/zuume-cufonfonts/Zuume Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../Fonts/zuume-cufonfonts/Zuume Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../Fonts/zuume-cufonfonts/Zuume SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../Fonts/zuume-cufonfonts/Zuume Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-zuume",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${industry.variable} ${zuume.variable}`}>
        <SessionProvider>
          <AlertProvider>{children}</AlertProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
