
'use client';

import type { User as FirebaseUser, AuthError } from 'firebase/auth';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword as firebaseSignIn,
  createUserWithEmailAndPassword as firebaseSignUp,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter, usePathname } from 'next/navigation';

interface AuthContextType {
  user: FirebaseUser | null;
  loading: boolean; // Continuará indicando o carregamento do estado de autenticação
  logout: () => Promise<void>;
  loginWithEmailAndPassword: (email: string, pass: string) => Promise<FirebaseUser | AuthError>;
  signUpWithEmailAndPassword: (email: string, pass: string) => Promise<FirebaseUser | AuthError>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true); // Indica se o estado de autenticação inicial ainda está carregando
  const [isMounted, setIsMounted] = useState(false); // Para rastrear se o componente montou no cliente

  const router = useRouter();
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login' || pathname === '/signup';

  useEffect(() => {
    setIsMounted(true); // Define como montado após a primeira renderização do cliente
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false); // Estado de autenticação carregado
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Lógica de redirecionamento: executa apenas no cliente após a montagem e o estado de auth ser carregado
    if (isMounted && !loading && !user && !isAuthRoute) {
      router.push('/login');
    }
  }, [isMounted, user, loading, pathname, router, isAuthRoute]);

  const authContextValue: AuthContextType = {
    user,
    loading,
    loginWithEmailAndPassword: async (email: string, pass: string): Promise<FirebaseUser | AuthError> => {
      try {
        const userCredential = await firebaseSignIn(auth, email, pass);
        return userCredential.user;
      } catch (error) {
        return error as AuthError;
      }
    },
    signUpWithEmailAndPassword: async (email: string, pass: string): Promise<FirebaseUser | AuthError> => {
      try {
        const userCredential = await firebaseSignUp(auth, email, pass);
        return userCredential.user;
      } catch (error) {
        return error as AuthError;
      }
    },
    logout: async (): Promise<void> => {
      await firebaseSignOut(auth);
      // O router.push('/login') está no useEffect, mas podemos adicionar aqui para garantir se necessário
      // ou confiar que o estado de 'user' mudando acionará o useEffect.
      // Para uma experiência mais imediata, podemos fazer o push aqui também.
      router.push('/login');
    }
  };

  // Durante SSR e a primeira renderização no cliente (antes de isMounted se tornar true),
  // sempre renderize os children para garantir que a hidratação corresponda.
  if (!isMounted) {
    return (
      <AuthContext.Provider value={authContextValue}>
        {children}
      </AuthContext.Provider>
    );
  }

  // Lógica de UI condicional APÓS a montagem no cliente
  if (loading && !isAuthRoute) {
    // Ainda carregando o estado de autenticação, exibe a UI de carregamento
    return (
      <AuthContext.Provider value={authContextValue}>
        <div className="flex h-screen items-center justify-center">
          <p>Carregando aplicação...</p>
        </div>
      </AuthContext.Provider>
    );
  }

  if (!loading && !user && !isAuthRoute) {
    // Autenticação carregada, sem usuário, não é uma rota de autenticação -> exibe UI de redirecionamento/verificação
    // O useEffect acima trata do router.push real.
    return (
      <AuthContext.Provider value={authContextValue}>
        <div className="flex h-screen items-center justify-center">
          <p>Verificando autenticação...</p>
        </div>
      </AuthContext.Provider>
    );
  }

  // Se for uma rota de autenticação, ou se o usuário estiver carregado e não estiver carregando: renderize os children
  return (
    <AuthContext.Provider value={authContextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
