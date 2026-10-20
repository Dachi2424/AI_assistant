import type { Metadata } from "next";
import { Geist, Geist_Mono, Roboto } from "next/font/google";
import "./globals.scss";
import { site } from "@/lib/site";
import ChatProvider from "./context/ChatContext";
import Header from "./components/Header/Header";
import Sidebar from "./components/sidebar/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"]
})

export const metadata: Metadata = {
  title: {
    default: `${site.name} - ${site.tagline}`,
    template: `%s | ${site.name}`
  },
  description: site.description,
  applicationName: site.name
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${roboto.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ChatProvider>
          <Header />
          <div className="app">
            <Sidebar />
            <main className="app__main">{children}</main>
          </div>
        </ChatProvider>
      </body>
    </html>
  );
}