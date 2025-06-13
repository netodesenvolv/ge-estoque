
'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { SidebarProvider, Sidebar, SidebarInset, SidebarTrigger, SidebarHeader, SidebarContent, SidebarFooter } from '@/components/ui/sidebar';
import AppNavigation from '@/components/AppNavigation';
import AppLogo from '@/components/AppLogo';
import { Button } from '@/components/ui/button';
import { UserCircle, LogOut } from 'lucide-react';

// Extracted UI component for authenticated users
function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

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
            {user && <span className="text-sm text-muted-foreground">Olá, {user.email}</span>}
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
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login' || pathname === '/signup';

  if (isAuthRoute) {
    return <>{children}</>;
  }

  if (user && !loading) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
  }
  
  // Covered by AuthProvider's loading/redirect logic, but as a fallback:
  if (loading) {
     return (
      <div className="flex h-screen items-center justify-center">
        <p>Verificando autenticação (LayoutRenderer)...</p>
      </div>
    );
  }

  return null; // Or some other fallback if needed before redirection from AuthProvider takes effect
}
