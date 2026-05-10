export type User = { uid: string; email: string | null; displayName: string | null; photoURL: string | null; emailVerified: boolean; isAnonymous: boolean; tenantId: string | null; providerData: any[] };

let currentUser: User | null = {
  uid: 'local-admin',
  email: 'cuibo.buy@gmail.com',
  displayName: 'Local Admin',
  photoURL: null,
  emailVerified: true,
  isAnonymous: false,
  tenantId: null,
  providerData: []
};
let listeners: ((user: User | null) => void)[] = [];

export const getAuth = () => ({ currentUser });
export class GoogleAuthProvider { constructor() {} };
export const signInWithPopup = async (auth?: any, provider?: any) => ({ user: currentUser });
export const signOut = async (auth?: any) => {};
export const onAuthStateChanged = (auth: any, callback: (user: User | null) => void) => {
  listeners.push(callback);
  callback(currentUser);
  return () => { listeners = listeners.filter(l => l !== callback); };
};
