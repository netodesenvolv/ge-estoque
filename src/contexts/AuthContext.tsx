
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
import { auth, firestore } from '@/lib/firebase'; // Import firestore
import { doc, getDoc } from 'firebase/firestore'; // Import doc and getDoc
import { useRouter, usePathname } from 'next/navigation';
import type { UserProfile, User } from '@/types'; // Import UserProfile and User

interface AuthContextType {
  user: FirebaseUser | null;
  currentUserProfile: UserProfile | null; // Changed from User to UserProfile for clarity
  loading: boolean; 
  isMounted: boolean; 
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
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true); 
  const [isMounted, setIsMounted] = useState(false); 

  const router = useRouter();
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login' || pathname === '/signup';

  useEffect(() => {
    setIsMounted(true); 
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Fetch user profile from Firestore
        const userProfileRef = doc(firestore, "user_profiles", firebaseUser.uid);
        const userProfileSnap = await getDoc(userProfileRef);
        if (userProfileSnap.exists()) {
          setCurrentUserProfile(userProfileSnap.data() as UserProfile);
        } else {
          console.warn(`No profile found in Firestore for user ${firebaseUser.uid}`);
          // Potentially create a default profile or handle this case
          // For now, set to null or a default guest profile
          setCurrentUserProfile(null); 
        }
      } else {
        setCurrentUserProfile(null);
      }
      setLoading(false); 
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isMounted && !loading && !user && !isAuthRoute) {
      router.push('/login');
    }
  }, [isMounted, user, loading, pathname, router, isAuthRoute]);

  const authContextValue: AuthContextType = {
    user,
    currentUserProfile,
    loading,
    isMounted, 
    loginWithEmailAndPassword: async (email: string, pass: string): Promise<FirebaseUser | AuthError> => {
      try {
        const userCredential = await firebaseSignIn(auth, email, pass);
        // Profile will be fetched by onAuthStateChanged
        return userCredential.user;
      } catch (error) {
        return error as AuthError;
      }
    },
    signUpWithEmailAndPassword: async (email: string, pass: string): Promise<FirebaseUser | AuthError> => {
      try {
        const userCredential = await firebaseSignUp(auth, email, pass);
        // Profile will be created and then fetched by onAuthStateChanged if successful
        return userCredential.user;
      } catch (error) {
        return error as AuthError;
      }
    },
    logout: async (): Promise<void> => {
      await firebaseSignOut(auth);
      setCurrentUserProfile(null); // Clear profile on logout
      router.push('/login');
    }
  };

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
