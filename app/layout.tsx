import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cambio',
  description: 'Play Cambio with friends. Private rooms, your house rules, and a good game of memory.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
