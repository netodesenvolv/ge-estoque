
'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { SidebarProvider, Sidebar, SidebarInset, SidebarTrigger, SidebarHeader, SidebarContent, SidebarFooter } from '@/components/ui/sidebar';
import AppNavigation from '@/components/AppNavigation';
import AppLogo from '@/components/AppLogo';
import { Button } from '@/components/ui/button';
import { UserCircle, LogOut, Loader2 } from 'lucide-react';
import { Toaster } from '@/components/ui/toaster';

// Extracted UI component for authenticated users
function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, currentUserProfile } = useAuth();

  return (
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
          <Button variant="ghost" className="w-full justify-start gap-2" onClick={logout}>
            <LogOut size={20} /> Sair
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
            {currentUserProfile && <span className="text-sm text-muted-foreground">Olá, {currentUserProfile.name || user?.email}</span>}
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function LayoutRenderer({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, isMounted } = useAuth();
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login' || pathname === '/signup';

  if (!isMounted) {
    return null;
  }

  let pageContent: React.ReactNode;

  if (isAuthRoute) {
    pageContent = <>{children}</>;
  } else if (authLoading) {
    pageContent = (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="mr-2 h-8 w-8 animate-spin text-primary" />
        <p className="text-lg text-muted-foreground">Carregando aplicação...</p>
      </div>
    );
  } else if (!user) {
    // This case is typically handled by the redirect in AuthContext,
    // but we can keep a loading screen as a fallback.
    pageContent = (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="mr-2 h-8 w-8 animate-spin text-primary" />
        <p className="text-lg text-muted-foreground">Verificando autenticação...</p>
      </div>
    );
  } else {
    // user is present
    pageContent = <AuthenticatedLayout>{children}</AuthenticatedLayout>;
  }

  return (
    <>
      {pageContent}
      <Toaster />
    </>
  );
}
