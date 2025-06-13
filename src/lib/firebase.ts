// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, type Analytics } from "firebase/analytics";
import { getAuth, type Auth } from "firebase/auth";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAvBsihNG2gtATFlW540SawQLH_NmIOO8M",
  authDomain: "ge-gestaoestoque.firebaseapp.com",
  projectId: "ge-gestaoestoque",
  storageBucket: "ge-gestaoestoque.firebasestorage.app",
  messagingSenderId: "524885756211",
  appId: "1:524885756211:web:1fbdde75b52e42e8739646",
  measurementId: "G-E7ME4XHT1Z"
};

// Initialize Firebase
let app: FirebaseApp;
let auth: Auth;
let analytics: Analytics | null = null;

if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

auth = getAuth(app);

if (typeof window !== 'undefined') {
  if (app.name && typeof window !== 'undefined') {
    analytics = getAnalytics(app);
  }
}

export { app, auth, analytics };
