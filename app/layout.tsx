import type { Metadata } from 'next';
import './globals.css';
import ConditionalLayout from '@/components/ui/ConditionalLayout';

export const metadata: Metadata = {
  title: 'RPJ Ecom System',
  description: 'Business Operations MVP for RPJ Ecommerce',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  );
}
