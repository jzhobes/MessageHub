import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { Geist, Geist_Mono } from 'next/font/google';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Virtual Me - Message Archive</title>
        <meta name="description" content="Personal message archive viewer for Facebook, Instagram, Google Chat, and Google Voice" />
      </Head>
      <div className={`${geistSans.variable} ${geistMono.variable}`}>
        <Component {...pageProps} />
      </div>
    </>
  );
}
