
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
  loading: boolean;
  loginWithEmailAndPassword: (email: string, pass: string) => Promise<FirebaseUser | AuthError>;
  signUpWithEmailAndPassword: (email: string, pass: string) => Promise<FirebaseUser | AuthError>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode; // Changed from render prop to ReactNode
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login' || pathname === '/signup';

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!loading && !user && !isAuthRoute) {
      router.push('/login');
    }
  }, [user, loading, pathname, router, isAuthRoute]);

  const loginWithEmailAndPassword = async (email: string, pass: string): Promise<FirebaseUser | AuthError> => {
    try {
      const userCredential = await firebaseSignIn(auth, email, pass);
      return userCredential.user;
    } catch (error) {
      return error as AuthError;
    }
  };

  const signUpWithEmailAndPassword = async (email: string, pass: string): Promise<FirebaseUser | AuthError> => {
     try {
      const userCredential = await firebaseSignUp(auth, email, pass);
      return userCredential.user;
    } catch (error) {
      return error as AuthError;
    }
  };

  const logout = async (): Promise<void> => {
    await firebaseSignOut(auth);
    router.push('/login');
  };

  const authContextValue: AuthContextType = {
    user,
    loading,
    loginWithEmailAndPassword,
    signUpWithEmailAndPassword,
    logout
  };

  // Conditional rendering logic now happens inside AuthProvider
  if (loading && !isAuthRoute) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Carregando aplicação...</p>
      </div>
    );
  }

  // If it's an auth route, or if the user is authenticated, render children
  // The redirection for unauthenticated users on non-auth routes is handled by the useEffect above.
  if (isAuthRoute || (!loading && user)) {
    return (
      <AuthContext.Provider value={authContextValue}>
        {children}
      </AuthContext.Provider>
    );
  }
  
  // If not loading, no user, and not an auth route, user will be redirected by useEffect.
  // Return a loading state or null while redirect is happening.
  return (
    <div className="flex h-screen items-center justify-center">
      <p>Verificando autenticação...</p>
    </div>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  // This hook can still be used by components deeper in the tree if needed
  return context;
};
