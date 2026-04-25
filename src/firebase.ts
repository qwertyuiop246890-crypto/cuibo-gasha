import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, collection, doc as firebaseDoc, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Initialize Firestore with IndexedDB persistence
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth();

export const getBasePath = () => {
  const user = auth.currentUser;
  if (!user) return "";
  const isAdmin = ["qwertyuiop246890@gmail.com", "cuibo.buy@gmail.com"].includes(user.email || '');
  return isAdmin ? "" : `users/${user.uid}/`;
};

export const col = (name: string) => collection(db, getBasePath() + name);
export const dbDoc = (name: string, id?: string) => id ? firebaseDoc(db, getBasePath() + name, id) : firebaseDoc(collection(db, getBasePath() + name));
