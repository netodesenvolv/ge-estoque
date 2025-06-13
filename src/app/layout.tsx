
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { SidebarProvider, Sidebar, SidebarInset, SidebarTrigger, SidebarHeader, SidebarContent, SidebarFooter } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toaster';
import AppNavigation from '@/components/AppNavigation';
import AppLogo from '@/components/AppLogo';
import { Button } from '@/components/ui/button';
import { Settings, UserCircle, LogOut } from 'lucide-react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext'; // AuthProvider is now the main wrapper

export const metadata: Metadata = {
  title: 'GE-Gestão de Estoque',
  description: 'Aplicativo de Gestão de Estoque',
};

// Extracted UI component for authenticated users
function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth(); // useAuth can be called here as AuthProvider is an ancestor

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
        <AuthProvider>
          {/* 
            The AuthProvider now internally handles:
            1. Loading state display
            2. Redirection if not authenticated and not on an auth route
            3. Rendering children if on an auth route OR if authenticated 
          */}
          {/* 
            We need a way to distinguish between auth routes and app routes *after* AuthProvider has decided to render its children.
            One way is to have another component that consumes the auth context.
          */}
          <LayoutRenderer>{children}</LayoutRenderer>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}

// This new component will consume the auth context to decide which layout to render
function LayoutRenderer({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth(); // Get user and loading state
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login' || pathname === '/signup';

  // If loading and not an auth route, AuthProvider already shows a loader.
  // If it's an auth route, render children directly (login/signup page).
  if (isAuthRoute) {
    return <>{children}</>;
  }

  // If not an auth route and user is loaded and present, render AuthenticatedLayout.
  if (user && !loading) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
  }
  
  // If it's not an auth route, not loading, but no user, AuthProvider handles redirection.
  // This component might render briefly before redirection or if there's a state mismatch.
  // AuthProvider's loading screen should cover most cases.
  // Return null or a minimal loader if this path is reached unexpectedly.
  return null; 
}
