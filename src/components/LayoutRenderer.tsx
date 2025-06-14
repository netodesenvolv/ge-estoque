
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

  if (loading) {
     return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="mr-2 h-8 w-8 animate-spin text-primary" />
        <p className="text-lg text-muted-foreground">Carregando aplicação...</p>
      </div>
    );
  }

  if (!user && !isAuthRoute) {
    // O AuthProvider já lida com o redirecionamento.
    // Podemos mostrar uma tela de "Verificando..." ou um spinner se o redirecionamento demorar.
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="mr-2 h-8 w-8 animate-spin text-primary" />
        <p className="text-lg text-muted-foreground">Verificando autenticação...</p>
      </div>
    );
  }
  
  if (user) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
  }

  // Fallback para o caso de rotas de autenticação se o usuário já estiver logado (embora o AuthProvider deva redirecionar)
  // Ou se algo inesperado acontecer.
  return (
    <div className="flex h-screen items-center justify-center">
       <Loader2 className="mr-2 h-8 w-8 animate-spin text-primary" />
       <p className="text-lg text-muted-foreground">Redirecionando...</p>
    </div>
  );
}

