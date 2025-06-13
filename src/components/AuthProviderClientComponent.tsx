
'use client';

import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';

interface AuthProviderClientComponentProps {
  children: (auth: { 
    user: FirebaseUser | null; 
    loading: boolean; 
    logout: () => Promise<void>;
    isAuthRoute: boolean;
  }) => ReactNode;
}

function AuthContent({ children }: { children: AuthProviderClientComponentProps['children'] }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login' || pathname === '/signup';
  return <>{children({ user, loading, logout, isAuthRoute })}</>;
}

export function AuthProviderClientComponent({ children }: AuthProviderClientComponentProps) {
  return (
    <AuthProvider>
      <AuthContent>{children}</AuthContent>
    </AuthProvider>
  );
}
