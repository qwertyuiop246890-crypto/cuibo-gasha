import localforage from 'localforage';

localforage.config({ name: 'CuiboGasha_DB' });

const dbState: Record<string, Record<string, any>> = {};
const listeners: Record<string, Function[]> = {};

async function loadCollection(path: string) {
  if (!dbState[path]) {
    const data = await localforage.getItem(path) || {};
    dbState[path] = data as Record<string, any>;
  }
}

async function saveCollection(path: string) {
  await localforage.setItem(path, dbState[path]);
  notifyListeners(path);
}

function notifyListeners(path: string) {
  // Collection listeners
  if (listeners[path]) {
    const docs = Object.entries(dbState[path] || {}).map(([id, data]) => ({
      id,
      ref: { type: 'doc', path, id },
      data: () => data,
      exists: () => true
    }));
    listeners[path].forEach(fn => fn({ docs }));
  }
  // Doc listeners
  if (dbState[path]) {
    Object.keys(dbState[path]).forEach(id => {
      const docPath = `${path}/${id}`;
      if (listeners[docPath]) {
        listeners[docPath].forEach(fn => fn({
          id,
          ref: { type: 'doc', path, id },
          data: () => dbState[path][id],
          exists: () => !!dbState[path][id]
        }));
      }
    });
  }
}

export const collection = (db: any, path: string) => ({ type: 'collection', path });

export const doc = (db: any, path: string | any, id?: string) => {
  if (typeof path === 'object' && path.type === 'collection') {
    return { type: 'doc', path: path.path, id: id || crypto.randomUUID() };
  }
  let finalPath = path;
  let finalId = id || crypto.randomUUID();
  if (path.includes('/')) {
     const parts = path.split('/');
     finalPath = parts[0];
     finalId = parts[1];
  }
  return { type: 'doc', path: finalPath, id: finalId };
};

export const onSnapshot = (ref: any, onNext: Function, onError?: Function) => {
  const isCol = ref.type === 'collection' || ref.type === 'query';
  const path = ref.path;
  const listenPath = isCol ? path : `${path}/${ref.id}`;
  
  if (!listeners[listenPath]) listeners[listenPath] = [];
  listeners[listenPath].push(onNext);

  // Initial load
  loadCollection(path).then(() => {
    if (isCol) {
      // sort by createdAt desc by default or based on query
      let entries = Object.entries(dbState[path] || {});
      if (ref.orderByField) {
        entries.sort((a, b) => {
           let va = a[1][ref.orderByField] || 0;
           let vb = b[1][ref.orderByField] || 0;
           if (ref.orderByDir === 'desc') return va < vb ? 1 : -1;
           return va > vb ? 1 : -1;
        });
      }
      const docs = entries.map(([id, data]) => ({
        id,
        ref: { type: 'doc', path: ref.path, id },
        data: () => data,
        exists: () => true
      }));
      onNext({ docs });
    } else {
      const data = dbState[path]?.[ref.id];
      onNext({
        id: ref.id,
        ref: { type: 'doc', path: ref.path, id: ref.id },
        data: () => data,
        exists: () => !!data
      });
    }
  });

  return () => {
    listeners[listenPath] = listeners[listenPath].filter(fn => fn !== onNext);
  };
};

export const setDoc = async (ref: any, data: any, options?: any) => {
  await loadCollection(ref.path);
  if (options && options.merge) {
    dbState[ref.path][ref.id] = { ...dbState[ref.path][ref.id], ...data };
  } else {
    dbState[ref.path][ref.id] = data;
  }
  await saveCollection(ref.path);
};

export const updateDoc = async (ref: any, data: any) => {
  await loadCollection(ref.path);
  // increment resolution
  const resolvedData = { ...data };
  for (const key in resolvedData) {
    if (resolvedData[key]?._isIncrement) {
      const current = dbState[ref.path]?.[ref.id]?.[key] || 0;
      resolvedData[key] = current + resolvedData[key].val;
    }
  }
  dbState[ref.path][ref.id] = { ...dbState[ref.path][ref.id], ...resolvedData };
  await saveCollection(ref.path);
};

export const deleteDoc = async (ref: any) => {
  await loadCollection(ref.path);
  if (dbState[ref.path] && dbState[ref.path][ref.id]) {
    delete dbState[ref.path][ref.id];
    await saveCollection(ref.path);
  }
};

export const getDoc = async (ref: any) => {
  await loadCollection(ref.path);
  const data = dbState[ref.path]?.[ref.id];
  return {
    id: ref.id,
    ref: { type: 'doc', path: ref.path, id: ref.id },
    data: () => data,
    exists: () => !!data
  };
};

export const getDocs = async (ref: any) => {
  await loadCollection(ref.path);
  const docs = Object.entries(dbState[ref.path] || {}).map(([id, data]) => ({
    id,
    ref: { type: 'doc', path: ref.path, id },
    data: () => data,
    exists: () => true
  }));
  return { docs };
};

export const query = (colRef: any, ...ops: any[]) => {
  let q = { ...colRef, type: 'query' };
  for (const op of ops) {
    if (op.type === 'orderBy') {
      q.orderByField = op.field;
      q.orderByDir = op.dir;
    }
  }
  return q;
};

export const orderBy = (field: string, dir: string = 'asc') => ({ type: 'orderBy', field, dir });

export const serverTimestamp = () => new Date().toISOString();

export const increment = (val: number) => ({ _isIncrement: true, val });

export const enableNetwork = async () => {};
export const disableNetwork = async () => {};
export const waitForPendingWrites = async () => {};
export const getDocFromServer = getDoc;

export const writeBatch = (db: any) => {
  const operations: Array<{
    type: 'set' | 'update' | 'delete';
    ref: any;
    data?: any;
    options?: any;
  }> = [];
  return {
    set: (ref: any, data: any, options?: any) => {
      operations.push({ type: 'set', ref, data, options });
    },
    update: (ref: any, data: any) => {
      operations.push({ type: 'update', ref, data });
    },
    delete: (ref: any) => {
      operations.push({ type: 'delete', ref });
    },
    commit: async () => {
      const changedPaths = new Set<string>();

      for (const op of operations) {
        await loadCollection(op.ref.path);

        if (op.type === 'set') {
          if (op.options && op.options.merge) {
            dbState[op.ref.path][op.ref.id] = {
              ...dbState[op.ref.path][op.ref.id],
              ...op.data
            };
          } else {
            dbState[op.ref.path][op.ref.id] = op.data;
          }
        }

        if (op.type === 'update') {
          const resolvedData = { ...op.data };
          for (const key in resolvedData) {
            if (resolvedData[key]?._isIncrement) {
              const current = dbState[op.ref.path]?.[op.ref.id]?.[key] || 0;
              resolvedData[key] = current + resolvedData[key].val;
            }
          }
          dbState[op.ref.path][op.ref.id] = {
            ...dbState[op.ref.path][op.ref.id],
            ...resolvedData
          };
        }

        if (op.type === 'delete' && dbState[op.ref.path]?.[op.ref.id]) {
          delete dbState[op.ref.path][op.ref.id];
        }

        changedPaths.add(op.ref.path);
      }

      for (const path of changedPaths) {
        await saveCollection(path);
      }
    }
  };
};
