import { collection as mCollection, doc as mDoc } from './mockFirestore';
import { getAuth } from './mockAuth';

export const app = {};
export const db = {};
export const auth = getAuth();

export const getBasePath = () => {
  return "local/";
};

export const col = (name: string) => mCollection(db, getBasePath() + name);
export const dbDoc = (name: string, id?: string) => id ? mDoc(db, getBasePath() + name, id) : mDoc(db, getBasePath() + name);
