import React from 'react';
import Head from 'next/head';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from '@/hooks/useTheme';
import { AppProvider, useApp } from '@/context/AppContext';
import LoadingSplash from '@/components/LoadingSplash';

import '@/styles/globals.css';

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
    <AppProvider>
      <ThemeProvider>
        <Head>
          <title>MessageHub</title>
          <meta
            name="description"
            content="Personal message archive viewer for Facebook, Instagram, Google Chat, and Google Voice"
          />
          <link rel="icon" href="/favicon.png" />
        </Head>
        <div className={`${geistSans.variable} ${geistMono.variable}`}>
          <MainContent Component={Component} pageProps={pageProps} />
        </div>
      </ThemeProvider>
    </AppProvider>
  );
}

function MainContent({ Component, pageProps }: { Component: AppProps['Component']; pageProps: AppProps['pageProps'] }) {
  const { isInitialized } = useApp();
  const router = useRouter();

  // Show splash if we're checking status OR redirecting an uninitialized user to home
  if (isInitialized === null || (isInitialized === false && router.pathname !== '/')) {
    return <LoadingSplash />;
  }

  return <Component {...pageProps} />;
}
