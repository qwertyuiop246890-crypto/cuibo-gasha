import localforage from 'localforage';

localforage.config({ name: 'CuiboGasha_DB' });

const dbState: Record<string, Record<string, any>> = {};
const listeners: Record<string, Function[]> = {};

function collectionName(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function sanitizeDoc(path: string, data: any) {
  if (!data || typeof data !== 'object') return {};
  const next = { ...data };
  const now = new Date().toISOString();
  const name = collectionName(path);

  if (name === 'customers') {
    next.name = typeof next.name === 'string' ? next.name : '';
    next.aliases = Array.isArray(next.aliases)
      ? Array.from(new Set(next.aliases.filter((alias: any) => typeof alias === 'string').map((alias: string) => alias.trim()).filter(Boolean)))
      : [];
    next.totalSpent = Number(next.totalSpent) || 0;
    next.totalItems = Number(next.totalItems) || 0;
    next.createdAt = typeof next.createdAt === 'string' ? next.createdAt : now;
    next.lastOrderAt = typeof next.lastOrderAt === 'string' ? next.lastOrderAt : now;
  }

  if (name === 'orders') {
    next.customerId = typeof next.customerId === 'string' ? next.customerId : '';
    next.customerName = typeof next.customerName === 'string' ? next.customerName : '';
    next.items = Array.isArray(next.items) ? next.items.map((item: any) => {
      const price = Number(item?.price) || 0;
      const quantity = Number(item?.quantity) || 0;
      return {
        ...item,
        id: item?.id || crypto.randomUUID(),
        machineName: typeof item?.machineName === 'string' ? item.machineName : '',
        price,
        quantity,
        subtotal: Number(item?.subtotal) || price * quantity,
        createdAt: typeof item?.createdAt === 'string' ? item.createdAt : now,
        updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : undefined,
        callTime: typeof item?.callTime === 'string' ? item.callTime : undefined,
        releaseAt: typeof item?.releaseAt === 'string' ? item.releaseAt : undefined,
        transferAt: typeof item?.transferAt === 'string' ? item.transferAt : undefined,
        exchangeAt: typeof item?.exchangeAt === 'string' ? item.exchangeAt : undefined,
        sourceCustomerId: typeof item?.sourceCustomerId === 'string' ? item.sourceCustomerId : undefined,
        sourceCustomerName: typeof item?.sourceCustomerName === 'string' ? item.sourceCustomerName : undefined,
        isReleased: Boolean(item?.isReleased),
        releaseQuantity: Number(item?.releaseQuantity) || 0,
        isChecked: Boolean(item?.isChecked)
      };
    }) : [];
    next.totalAmount = Number(next.totalAmount) || next.items.reduce((sum: number, item: any) => sum + (Number(item.subtotal) || 0), 0);
    next.status = ['pending', 'completed', 'cancelled'].includes(next.status) ? next.status : 'pending';
    next.createdAt = typeof next.createdAt === 'string' ? next.createdAt : now;
    next.updatedAt = typeof next.updatedAt === 'string' ? next.updatedAt : now;
  }

  if (name === 'machines') {
    next.name = typeof next.name === 'string' ? next.name : '';
    next.defaultPrice = Number(next.defaultPrice) || 0;
    next.variants = Array.isArray(next.variants)
      ? Array.from(new Set(next.variants.filter((variant: any) => typeof variant === 'string').map((variant: string) => variant.trim()).filter(Boolean)))
      : [];
    const rawVariantDetails = next.variantDetails && typeof next.variantDetails === 'object' && !Array.isArray(next.variantDetails)
      ? next.variantDetails
      : {};
    next.variantDetails = next.variants.reduce((acc: Record<string, any>, variant: string) => {
      const raw = rawVariantDetails[variant] && typeof rawVariantDetails[variant] === 'object' && !Array.isArray(rawVariantDetails[variant])
        ? rawVariantDetails[variant]
        : {};
      acc[variant] = {
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : variant,
        originalName: typeof raw.originalName === 'string' && raw.originalName.trim() ? raw.originalName.trim() : undefined,
        feature: typeof raw.feature === 'string' && raw.feature.trim() ? raw.feature.trim() : undefined,
        aliases: Array.isArray(raw.aliases)
          ? Array.from(new Set(raw.aliases.filter((alias: any) => typeof alias === 'string').map((alias: string) => alias.trim()).filter(Boolean)))
          : [],
        active: raw.active === false ? false : true
      };
      return acc;
    }, {});
    next.createdAt = typeof next.createdAt === 'string' ? next.createdAt : now;
    next.updatedAt = typeof next.updatedAt === 'string' ? next.updatedAt : now;
  }

  if (name === 'releases') {
    next.orderId = typeof next.orderId === 'string' ? next.orderId : '';
    next.itemId = typeof next.itemId === 'string' ? next.itemId : '';
    next.customerName = typeof next.customerName === 'string' ? next.customerName : '';
    next.machineName = typeof next.machineName === 'string' ? next.machineName : '';
    next.quantity = Number(next.quantity) || 0;
    next.price = Number(next.price) || 0;
    next.status = ['pending', 'completed', 'cancelled'].includes(next.status) ? next.status : 'pending';
    next.createdAt = typeof next.createdAt === 'string' ? next.createdAt : now;
    next.releaseAt = typeof next.releaseAt === 'string' ? next.releaseAt : next.createdAt;
    next.transferredAt = typeof next.transferredAt === 'string' ? next.transferredAt : undefined;
    next.transferTargetCustomerId = typeof next.transferTargetCustomerId === 'string' ? next.transferTargetCustomerId : undefined;
    next.transferTargetCustomerName = typeof next.transferTargetCustomerName === 'string' ? next.transferTargetCustomerName : undefined;
    next.rawIds = Array.isArray(next.rawIds) ? next.rawIds.filter((id: any) => typeof id === 'string') : undefined;
  }

  if (name === 'settings') {
    next.notificationTemplate = typeof next.notificationTemplate === 'string' ? next.notificationTemplate : '';
    next.priceMap = next.priceMap && typeof next.priceMap === 'object' && !Array.isArray(next.priceMap) ? next.priceMap : {};
    next.lastBackupAt = typeof next.lastBackupAt === 'string' ? next.lastBackupAt : now;
    next.lastDriveBackupAt = typeof next.lastDriveBackupAt === 'string' ? next.lastDriveBackupAt : undefined;
  }

  if (name === 'operationLogs') {
    next.action = typeof next.action === 'string' ? next.action : 'unknown';
    next.targetType = typeof next.targetType === 'string' ? next.targetType : 'system';
    next.targetName = typeof next.targetName === 'string' ? next.targetName : undefined;
    next.message = typeof next.message === 'string' ? next.message : '';
    next.details = next.details && typeof next.details === 'object' && !Array.isArray(next.details) ? next.details : undefined;
    next.createdAt = typeof next.createdAt === 'string' ? next.createdAt : now;
  }

  return next;
}

function sanitizeCollection(path: string) {
  if (!dbState[path]) return;
  for (const id of Object.keys(dbState[path])) {
    dbState[path][id] = sanitizeDoc(path, dbState[path][id]);
  }
}

async function loadCollection(path: string) {
  if (!dbState[path]) {
    const data = await localforage.getItem(path) || {};
    dbState[path] = data as Record<string, any>;
    sanitizeCollection(path);
  }
}

async function saveCollection(path: string) {
  await localforage.setItem(path, dbState[path]);
  notifyListeners(path);
}

function resolveIncrementFields(path: string, id: string, data: any) {
  const resolvedData = { ...data };
  for (const key in resolvedData) {
    if (resolvedData[key]?._isIncrement) {
      const current = dbState[path]?.[id]?.[key] || 0;
      resolvedData[key] = current + resolvedData[key].val;
    }
  }
  return resolvedData;
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
  if (id) {
    return { type: 'doc', path, id };
  }
  let finalPath = path;
  let finalId = crypto.randomUUID();
  if (path.includes('/')) {
     const parts = path.split('/');
     finalId = parts.pop() || crypto.randomUUID();
     finalPath = parts.join('/');
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
  const resolvedData = resolveIncrementFields(ref.path, ref.id, data);
  if (options && options.merge) {
    dbState[ref.path][ref.id] = sanitizeDoc(ref.path, { ...dbState[ref.path][ref.id], ...resolvedData });
  } else {
    dbState[ref.path][ref.id] = sanitizeDoc(ref.path, resolvedData);
  }
  await saveCollection(ref.path);
};

export const updateDoc = async (ref: any, data: any) => {
  await loadCollection(ref.path);
  const resolvedData = resolveIncrementFields(ref.path, ref.id, data);
  dbState[ref.path][ref.id] = sanitizeDoc(ref.path, { ...dbState[ref.path][ref.id], ...resolvedData });
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
          const resolvedData = resolveIncrementFields(op.ref.path, op.ref.id, op.data);
          if (op.options && op.options.merge) {
            dbState[op.ref.path][op.ref.id] = sanitizeDoc(op.ref.path, {
              ...dbState[op.ref.path][op.ref.id],
              ...resolvedData
            });
          } else {
            dbState[op.ref.path][op.ref.id] = sanitizeDoc(op.ref.path, resolvedData);
          }
        }

        if (op.type === 'update') {
          const resolvedData = resolveIncrementFields(op.ref.path, op.ref.id, op.data);
          dbState[op.ref.path][op.ref.id] = sanitizeDoc(op.ref.path, {
            ...dbState[op.ref.path][op.ref.id],
            ...resolvedData
          });
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
