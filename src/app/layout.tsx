
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { SidebarProvider, Sidebar, SidebarInset, SidebarTrigger, SidebarHeader, SidebarContent, SidebarFooter } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toaster';
import AppNavigation from '@/components/AppNavigation';
import AppLogo from '@/components/AppLogo';
import { Button } from '@/components/ui/button';
import { Settings, UserCircle } from 'lucide-react';


export const metadata: Metadata = {
  title: 'GE-Gestão de Estoque',
  description: 'Aplicativo de Gestão de Estoque',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased">
        <SidebarProvider defaultOpen>
          <Sidebar>
            <SidebarHeader className="p-4">
              <div className="flex items-center justify-between">
                <AppLogo />
                <SidebarTrigger className="md:hidden" />
              </div>
            </SidebarHeader>
            <SidebarContent>
              <AppNavigation />
            </SidebarContent>
            <SidebarFooter className="p-4">
              <Button variant="ghost" className="w-full justify-start gap-2" asChild>
                <Link href="/profile">
                  <UserCircle size={20} /> Perfil
                </Link>
              </Button>
              <Button variant="ghost" className="w-full justify-start gap-2">
                <Settings size={20} /> Configurações
              </Button>
            </SidebarFooter>
          </Sidebar>
          <SidebarInset>
            <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm md:px-6">
              <div className="md:hidden">
                 <SidebarTrigger />
              </div>
              <div className="flex-1">
              </div>
              <div>
              </div>
            </header>
            <main className="flex-1 p-4 md:p-6">
              {children}
            </main>
          </SidebarInset>
        </SidebarProvider>
        <Toaster />
      </body>
    </html>
  );
}
