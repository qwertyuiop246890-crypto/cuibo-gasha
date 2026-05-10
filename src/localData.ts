import { collection as mCollection, doc as mDoc } from './localDb';
import { getAuth } from './mockAuth';

export const app = {};
export const db = {};
export const auth = getAuth();

export const getBasePath = () => {
  return "local/";
};

export const col = (name: string) => mCollection(db, getBasePath() + name);
export const dbDoc = (name: string, id?: string) => {
  const collectionRef = col(name);
  return id ? mDoc(db, collectionRef, id) : mDoc(db, collectionRef);
};
