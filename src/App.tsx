import React, { useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { 
  Plus, List, Package, Users, LayoutDashboard, Settings, 
  Search, Printer, Copy, Download, Upload, Trash2, 
  LogOut, ChevronRight, CheckCircle2, AlertCircle, X,
  ArrowLeft, Save, RefreshCw, TrendingUp, MessageSquare,
  Coins, ArrowRight, Database, Home, ArrowRightLeft, UserPlus, User as UserIcon,
  Grid2x2, LayoutGrid, Edit2, Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User
} from './mockAuth';
import { GoogleGenAI, Type } from '@google/genai';
import { 
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, 
  query, orderBy, serverTimestamp, getDoc, getDocs, writeBatch,
  getDocFromServer, increment, enableNetwork, disableNetwork, waitForPendingWrites
} from './localDb';
import { useReactToPrint } from 'react-to-print';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { auth, db, col, dbDoc } from './localData';
import { cn } from './lib/utils';
import { Customer, MachineVariantDetail, OperationLog, Order, OrderItem, SystemSettings } from './types';

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface LocalDataErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  userInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleLocalDataError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: LocalDataErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    userInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: (auth.currentUser?.providerData || []).map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Local Data Error: ', JSON.stringify(errInfo));
  window.dispatchEvent(new CustomEvent('local-data-error', { detail: errInfo }));
  throw new Error(JSON.stringify(errInfo));
};

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string | null;
}

class ErrorBoundary extends React.Component<any, any> {
  state: any = { hasError: false, errorInfo: null };

  constructor(props: any) {
    super(props);
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "應用程式發生錯誤。";
      let isQuotaError = false;
      try {
        const parsed = JSON.parse(this.state.errorInfo || "");
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          displayMessage = `權限不足：無法執行 ${parsed.operationType} 操作於 ${parsed.path}。請確認您是否為管理員。`;
        } else if (parsed.error && (parsed.error.toLowerCase().includes("quota") || parsed.error.includes("Quota exceeded") || parsed.error.includes("quota-exceeded"))) {
          isQuotaError = true;
          displayMessage = `資料庫免費額度已滿：無法連線至雲端。如果要繼續編輯資料，請點擊下方的「切換為本地模式」按鈕，系統會將後續的更動儲存在您的裝置中，不影響您繼續使用。`;
        }
      } catch (e) {
        displayMessage = this.state.errorInfo || "發生未知錯誤。";
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="max-w-md w-full bg-card-white p-8 rounded-3xl card-shadow text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-ink mb-4">糟糕！出錯了</h2>
            <p className="text-ink/60 mb-8 leading-relaxed">{displayMessage}</p>
            <div className="flex flex-col gap-3">
              {isQuotaError && (
                <button 
                  onClick={() => {
                    localStorage.setItem('cuibo_gasha_autosync', 'false');
                    window.location.reload();
                  }}
                  className="w-full py-4 bg-orange-500 text-white rounded-2xl font-bold shadow-lg shadow-orange-500/30 mb-2"
                >
                  切換為本地模式並繼續使用
                </button>
              )}
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-4 bg-primary-blue text-white rounded-2xl font-bold shadow-lg shadow-primary-blue/30"
              >
                重新整理頁面
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

// --- Constants ---
const TAIWAN_TZ = 'Asia/Taipei';
const DEFAULT_NOTIFICATION_TEMPLATE = `可以先幫我搭波卻可
有誤的話～請趕快跟我說！
₊⊹ 若是沒有漏掉的商品 ₊⊹
₊⊹ 若是還有扭蛋 ₊⊹
請等我第二個通知
網址：
找到自己名字後完成下單就可以嚕
𐙚 收到所有連結後請盡速完成付款
 不要耽誤到最佳的賞味期限唷
💡 小小提醒：
再麻煩於 ？號前幫我完成付款，以免影響您之後的購買權益哦！
如果期間內有困難無法付款，請務必提早私訊告知我。若是無故拖延或於約定時間未付款，以後就只能「預先儲值」才能幫您代購喊單了，再請大家多多配合與體諒 ♡

⚝ p.s. 前一次連線有開箱分享的朋友~
下單後請幫我備註一下：開箱禮
𝐭𝐡𝐚𝐧𝐤 𝐲𝐨𝐮 („• ֊ •„)੭`;

const DEFAULT_PRICE_MAP: Record<number, number> = {
  100: 50,
  200: 80,
  300: 120,
  400: 140,
  500: 170,
  600: 190,
  700: 250,
  800: 270,
  1000: 360,
  1500: 450
};

type TimelineFilterType = 'createdAt' | 'callTime' | 'updatedAt' | 'releaseAt' | 'transferAt' | 'exchangeAt';

const optionalIsoString = (value: any) => typeof value === 'string' && value ? value : undefined;
const optionalText = (value: any) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

const getItemTimelineValue = (item: OrderItem, order: Pick<Order, 'createdAt' | 'updatedAt'>, type: TimelineFilterType) => {
  if (type === 'createdAt') return order.createdAt || item.createdAt;
  if (type === 'callTime') return item.callTime || item.createdAt || order.createdAt;
  if (type === 'updatedAt') return item.updatedAt || order.updatedAt || item.createdAt || order.createdAt;
  if (type === 'releaseAt') return item.releaseAt;
  if (type === 'transferAt') return item.transferAt;
  if (type === 'exchangeAt') return item.exchangeAt;
  return item.createdAt || order.createdAt;
};

const toDateTimeInputValue = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const fromDateTimeInputValue = (value: string, fallback: string) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

const getCurrentDateTimeInputValue = () => toDateTimeInputValue(new Date().toISOString());

const normalizeOrderItem = (item: any): OrderItem => {
  const price = Number(item?.price) || 0;
  const quantity = Number(item?.quantity) || 0;
  return {
    ...item,
    id: item?.id || crypto.randomUUID(),
    machineName: typeof item?.machineName === 'string' ? item.machineName : '',
    price,
    quantity,
    subtotal: Number(item?.subtotal) || price * quantity,
    createdAt: typeof item?.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    callTime: optionalIsoString(item?.callTime),
    releaseAt: optionalIsoString(item?.releaseAt),
    transferAt: optionalIsoString(item?.transferAt),
    exchangeAt: optionalIsoString(item?.exchangeAt),
    sourceCustomerId: optionalIsoString(item?.sourceCustomerId),
    sourceCustomerName: optionalIsoString(item?.sourceCustomerName),
    updatedAt: optionalIsoString(item?.updatedAt)
  };
};

const normalizeCustomerNameKey = (value: string) => value.replace(/\s+/g, '').toLowerCase();

const normalizeCustomerAliases = (aliases: any): string[] => {
  if (!Array.isArray(aliases)) return [];
  return Array.from(new Set(
    aliases
      .filter((alias: any) => typeof alias === 'string')
      .map((alias: string) => alias.trim())
      .filter(Boolean)
  ));
};

const normalizeCustomer = (id: string, data: any): Customer => ({
  id,
  ...data,
  name: typeof data?.name === 'string' ? data.name : '',
  aliases: normalizeCustomerAliases(data?.aliases),
  totalSpent: Number(data?.totalSpent) || 0,
  totalItems: Number(data?.totalItems) || 0,
  createdAt: typeof data?.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
  lastOrderAt: typeof data?.lastOrderAt === 'string' ? data.lastOrderAt : new Date().toISOString()
});

const customerMatchesName = (customer: Customer, inputName: string) => {
  const key = normalizeCustomerNameKey(inputName);
  if (!key) return false;
  return normalizeCustomerNameKey(customer.name) === key ||
    (customer.aliases || []).some(alias => normalizeCustomerNameKey(alias) === key);
};

const findCustomerByName = (customers: Customer[], inputName: string) => (
  customers.find(customer => customerMatchesName(customer, inputName))
);

const getCustomerNameSuggestions = (customers: Customer[]) => Array.from(new Set(
  customers.flatMap(customer => [customer.name, ...(customer.aliases || [])]).filter(Boolean)
));

const normalizeVariantNames = (variants: any): string[] => {
  if (!Array.isArray(variants)) return [];
  return Array.from(new Set(
    variants
      .filter((variant: any) => typeof variant === 'string')
      .map((variant: string) => variant.trim())
      .filter(Boolean)
  ));
};

const createDefaultVariantDetails = (variants: string[]): Record<string, MachineVariantDetail> => (
  variants.reduce<Record<string, MachineVariantDetail>>((acc, variant) => {
    acc[variant] = { name: variant, aliases: [], active: true };
    return acc;
  }, {})
);

const normalizeVariantDetails = (variants: string[], rawDetails: any): Record<string, MachineVariantDetail> => {
  const source = rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails) ? rawDetails : {};
  return variants.reduce<Record<string, MachineVariantDetail>>((acc, variant) => {
    const raw = source[variant] && typeof source[variant] === 'object' && !Array.isArray(source[variant])
      ? source[variant]
      : {};
    acc[variant] = {
      name: optionalText(raw.name) || variant,
      originalName: optionalText(raw.originalName),
      feature: optionalText(raw.feature),
      aliases: normalizeCustomerAliases(raw.aliases),
      active: raw.active === false ? false : true
    };
    return acc;
  }, {});
};

const normalizeAiVariantDetails = (variants: string[], rawDetails: any): Record<string, MachineVariantDetail> => {
  const source = Array.isArray(rawDetails)
    ? rawDetails.reduce<Record<string, any>>((acc, item) => {
        const name = optionalText(item?.name) || optionalText(item?.variant) || optionalText(item?.variantName);
        if (name) acc[name] = item;
        return acc;
      }, {})
    : rawDetails;
  return normalizeVariantDetails(variants, source);
};

const formatMachineForAiPrompt = (machine: any) => {
  const variants = normalizeVariantNames(machine?.variants);
  if (variants.length === 0) return `- ${machine.name}：尚無款式`;
  const details = normalizeVariantDetails(variants, machine?.variantDetails);
  return `- ${machine.name}：${variants.map(variant => {
    const detail = details[variant];
    const parts = [variant];
    if (detail.feature) parts.push(`特徵：${detail.feature}`);
    if (detail.originalName) parts.push(`原文：${detail.originalName}`);
    if (detail.aliases && detail.aliases.length > 0) parts.push(`別名：${detail.aliases.join('、')}`);
    if (detail.active === false) parts.push('停用');
    return parts.join(' / ');
  }).join('、')}`;
};

const normalizeOrder = (id: string, data: any): Order => {
  const items = Array.isArray(data?.items) ? data.items.map(normalizeOrderItem) : [];
  return {
    id,
    ...data,
    customerId: typeof data?.customerId === 'string' ? data.customerId : '',
    customerName: typeof data?.customerName === 'string' ? data.customerName : '',
    items,
    totalAmount: Number(data?.totalAmount) || items.reduce((sum, item) => sum + item.subtotal, 0),
    status: ['pending', 'completed', 'cancelled'].includes(data?.status) ? data.status : 'pending',
    createdAt: typeof data?.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : new Date().toISOString()
  };
};

const normalizeMachine = (id: string, data: any) => {
  const variants = normalizeVariantNames(data?.variants);
  return {
    id,
    ...data,
    name: typeof data?.name === 'string' ? data.name : '',
    defaultPrice: Number(data?.defaultPrice) || 0,
    variants,
    variantDetails: normalizeVariantDetails(variants, data?.variantDetails),
    createdAt: typeof data?.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : new Date().toISOString()
  };
};

const normalizeRelease = (id: string, data: any) => ({
  id,
  ...data,
  orderId: typeof data?.orderId === 'string' ? data.orderId : '',
  itemId: typeof data?.itemId === 'string' ? data.itemId : '',
  customerName: typeof data?.customerName === 'string' ? data.customerName : '',
  machineName: typeof data?.machineName === 'string' ? data.machineName : '',
  quantity: Number(data?.quantity) || 0,
  price: Number(data?.price) || 0,
  status: ['pending', 'completed', 'cancelled'].includes(data?.status) ? data.status : 'pending',
  createdAt: typeof data?.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
  releaseAt: optionalIsoString(data?.releaseAt),
  transferredAt: optionalIsoString(data?.transferredAt),
  transferTargetCustomerId: optionalIsoString(data?.transferTargetCustomerId),
  transferTargetCustomerName: optionalIsoString(data?.transferTargetCustomerName)
});

const normalizeOperationLog = (id: string, data: any): OperationLog => ({
  id,
  action: typeof data?.action === 'string' ? data.action : 'unknown',
  targetType: typeof data?.targetType === 'string' ? data.targetType : 'system',
  targetName: optionalIsoString(data?.targetName),
  message: typeof data?.message === 'string' ? data.message : '',
  details: data?.details && typeof data.details === 'object' && !Array.isArray(data.details) ? data.details : undefined,
  createdAt: typeof data?.createdAt === 'string' ? data.createdAt : new Date().toISOString()
});

const normalizeSettings = (id: string, data: any): SystemSettings => ({
  id,
  ...data,
  notificationTemplate: typeof data?.notificationTemplate === 'string' ? data.notificationTemplate : DEFAULT_NOTIFICATION_TEMPLATE,
  priceMap: data?.priceMap && typeof data.priceMap === 'object' && !Array.isArray(data.priceMap) ? data.priceMap : DEFAULT_PRICE_MAP,
  lastBackupAt: typeof data?.lastBackupAt === 'string' ? data.lastBackupAt : new Date().toISOString(),
  lastDriveBackupAt: optionalIsoString(data?.lastDriveBackupAt)
});

const IMPORT_COLLECTIONS = [
  { key: 'customers', path: 'customers' },
  { key: 'orders', path: 'orders' },
  { key: 'machines', path: 'machines' },
  { key: 'releases', path: 'releases' },
  { key: 'operationLogs', path: 'operationLogs' },
] as const;

type ImportCollectionKey = typeof IMPORT_COLLECTIONS[number]['key'];

type PreparedImport = {
  fileName: string;
  fileSize: number;
  counts: Record<ImportCollectionKey, number> & { images: number };
  warnings: string[];
  payload: {
    customers: Customer[];
    orders: Order[];
    machines: any[];
    releases: any[];
    operationLogs: OperationLog[];
    settings: Omit<SystemSettings, 'id'> | null;
  };
};

type BackupPayload = {
  customers: Customer[];
  orders: Order[];
  settings: SystemSettings | null;
  machines: any[];
  releases: any[];
  operationLogs: OperationLog[];
  exportedAt: string;
  backupMeta: {
    app: 'cuibo-gasha';
    backupVersion: 1;
    deviceId: string;
    dataHash: string;
    counts: BackupCounts;
  };
};

type RestoreSnapshot = {
  customers: Customer[];
  orders: Order[];
  machines: any[];
  releases: any[];
  settings: Omit<SystemSettings, 'id'> | null;
  createdAt: string;
};

type BackupCounts = Record<ImportCollectionKey, number> & { images: number; totalRecords: number };

type DriveBackupFile = {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
  appProperties?: Record<string, string>;
};

type DriveBackupStatus = {
  connected: boolean;
  loading: boolean;
  latest: DriveBackupFile | null;
  files: DriveBackupFile[];
  message: string;
};

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const prepareImportPayload = (raw: any, fileName: string, fileSize: number): PreparedImport => {
  const importedAt = new Date().toISOString();
  const warnings: string[] = [];

  for (const { key } of IMPORT_COLLECTIONS) {
    if (raw[key] && !Array.isArray(raw[key])) {
      throw new Error(`Invalid backup: ${key} must be an array`);
    }

    const invalidItem = raw[key]?.find((item: any) => !item || typeof item.id !== 'string' || !item.id.trim());
    if (invalidItem) {
      throw new Error(`Invalid backup: ${key} contains an item without an id`);
    }
  }

  const normalizeImportedOrderItem = (item: any): OrderItem => {
    const price = Number(item?.price) || 0;
    const quantity = Number(item?.quantity) || 0;
    return {
      id: item?.id || crypto.randomUUID(),
      machineId: item?.machineId,
      machineName: typeof item?.machineName === 'string' ? item.machineName : '',
      price,
      quantity,
      variant: item?.variant,
      subtotal: Number(item?.subtotal) || price * quantity,
      isReleased: Boolean(item?.isReleased),
      releaseQuantity: Number(item?.releaseQuantity) || 0,
      createdAt: typeof item?.createdAt === 'string' ? item.createdAt : importedAt,
      callTime: optionalIsoString(item?.callTime),
      releaseAt: optionalIsoString(item?.releaseAt),
      transferAt: optionalIsoString(item?.transferAt),
      exchangeAt: optionalIsoString(item?.exchangeAt),
      sourceCustomerId: optionalIsoString(item?.sourceCustomerId),
      sourceCustomerName: optionalIsoString(item?.sourceCustomerName),
      updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : importedAt,
      isChecked: Boolean(item?.isChecked)
    };
  };

  const customers = (raw.customers || []).map((item: any) => normalizeCustomer(item.id, item));
  const orders = (raw.orders || []).map((item: any) => normalizeOrder(item.id, {
    ...item,
    items: Array.isArray(item?.items) ? item.items.map(normalizeImportedOrderItem) : []
  }));
  const machines = (raw.machines || []).map((item: any) => normalizeMachine(item.id, item));
  const releases = (raw.releases || []).map((item: any) => normalizeRelease(item.id, item));
  const operationLogs = (raw.operationLogs || []).map((item: any) => normalizeOperationLog(item.id, item));
  const normalizedSettings = raw.settings
    ? (() => {
        const { id, ...rest } = normalizeSettings('global', raw.settings);
        return rest;
      })()
    : null;

  const images = machines.filter(machine => typeof machine?.imageUrl === 'string' && machine.imageUrl.trim()).length;
  const missingOrderItems = (raw.orders || []).filter((order: any) => !Array.isArray(order?.items)).length;
  const missingMachineVariants = (raw.machines || []).filter((machine: any) => !Array.isArray(machine?.variants)).length;

  if (missingOrderItems > 0) {
    warnings.push(`${missingOrderItems} orders had missing items and were normalized to empty lists.`);
  }
  if (missingMachineVariants > 0) {
    warnings.push(`${missingMachineVariants} machines had missing variants and were normalized to empty lists.`);
  }
  if (!raw.settings) {
    warnings.push('No settings found in backup. Current default settings will be used.');
  }

  return {
    fileName,
    fileSize,
    counts: {
      customers: customers.length,
      orders: orders.length,
      machines: machines.length,
      releases: releases.length,
      operationLogs: operationLogs.length,
      images
    },
    warnings,
    payload: {
      customers,
      orders,
      machines,
      releases,
      operationLogs,
      settings: normalizedSettings
    }
  };
};

const createRestoreSnapshot = async (): Promise<RestoreSnapshot> => {
  const readCollection = async <T,>(name: string, normalizer: (id: string, data: any) => T) => {
    const snapshot = await getDocs(col(name));
    return snapshot.docs.map((item: any) => normalizer(item.id, item.data()));
  };

  const settingsSnap = await getDoc(dbDoc('settings', 'global'));
  const normalizedSettings = settingsSnap.exists()
    ? (() => {
        const { id, ...rest } = normalizeSettings(settingsSnap.id, settingsSnap.data());
        return rest;
      })()
    : null;

  return {
    customers: await readCollection('customers', normalizeCustomer),
    orders: await readCollection('orders', normalizeOrder),
    machines: await readCollection('machines', normalizeMachine),
    releases: await readCollection('releases', normalizeRelease),
    settings: normalizedSettings,
    createdAt: new Date().toISOString()
  };
};

const pruneRestoreSnapshots = async (keepCount = 30) => {
  try {
    const snapshot = await getDocs(col('operationLogs'));
    const logs = snapshot.docs
      .map((item: any) => ({ id: item.id, ref: item.ref, ...normalizeOperationLog(item.id, item.data()) }))
      .filter((log: OperationLog) => Boolean(log.details?.restoreSnapshot))
      .sort((a: OperationLog, b: OperationLog) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const expired = logs.slice(keepCount);
    await Promise.all(expired.map((log: any) => updateDoc(log.ref, {
      details: {
        ...(log.details || {}),
        restoreSnapshot: undefined,
        restorePointExpired: true
      }
    })));
  } catch (err) {
    console.warn('Restore snapshot prune failed', err);
  }
};

const addOperationLog = async (
  action: string,
  targetType: string,
  message: string,
  targetName?: string,
  details?: Record<string, any>,
  options: { createRestorePoint?: boolean } = { createRestorePoint: true }
) => {
  try {
    const restoreSnapshot = options.createRestorePoint === false ? undefined : await createRestoreSnapshot();
    await setDoc(dbDoc('operationLogs'), {
      action,
      targetType,
      targetName,
      message,
      details: restoreSnapshot ? { ...(details || {}), restoreSnapshot } : details,
      createdAt: new Date().toISOString()
    });
    if (restoreSnapshot) {
      pruneRestoreSnapshots();
    }
  } catch (err) {
    console.warn('Operation log failed', err);
  }
};

const getLatestDataTime = (customers: Customer[], orders: Order[], machines: any[], releases: any[]) => {
  const dates = [
    ...customers.map(item => item.lastOrderAt || item.createdAt),
    ...orders.map(item => item.updatedAt || item.createdAt),
    ...orders.flatMap(order => order.items.map(item => item.updatedAt || item.callTime || item.createdAt)),
    ...machines.map(item => item.updatedAt || item.createdAt),
    ...releases.map(item => item.transferredAt || item.releaseAt || item.createdAt)
  ]
    .map(value => value ? new Date(value).getTime() : 0)
    .filter(value => Number.isFinite(value) && value > 0);

  if (dates.length === 0) return null;
  return new Date(Math.max(...dates)).toISOString();
};

const isBackupStale = (latestLocalAt: string | null, lastBackupAt?: string) => {
  if (!latestLocalAt) return false;
  if (!lastBackupAt) return true;
  return new Date(latestLocalAt).getTime() > new Date(lastBackupAt).getTime() + 60 * 1000;
};

const getBackupFreshness = (latestLocalAt: string | null, cloudBackupAt?: string) => {
  if (!latestLocalAt && !cloudBackupAt) return '目前沒有可比較的資料版本';
  if (latestLocalAt && !cloudBackupAt) return '本地有資料，雲端尚無備份';
  if (!latestLocalAt && cloudBackupAt) return '雲端有備份，本地目前沒有資料';
  const localTime = new Date(latestLocalAt || '').getTime();
  const cloudTime = new Date(cloudBackupAt || '').getTime();
  if (!Number.isFinite(localTime) || !Number.isFinite(cloudTime)) return '資料時間無法判斷，請先匯出本地備份';
  if (localTime > cloudTime + 60 * 1000) return '本地資料比較新，下載雲端前請先上傳或匯出本地備份';
  if (cloudTime > localTime + 60 * 1000) return '雲端備份比較新，下載後會以匯入預覽等待確認';
  return '本地與雲端時間接近';
};

const formatBackupCounts = (counts: BackupCounts | null) => {
  if (!counts) return '筆數未知';
  return `顧客 ${counts.customers}、訂單 ${counts.orders}、機台 ${counts.machines}、釋出 ${counts.releases}、圖片 ${counts.images}`;
};

const getActionableErrorMessage = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error || '');
  const lower = raw.toLowerCase();
  if (lower.includes('quota') || lower.includes('storage') || lower.includes('exceeded')) {
    return '本地儲存空間不足。請先匯出備份，刪除瀏覽器快取中不需要的資料，或改用另一個瀏覽器再匯入。';
  }
  if (lower.includes('invalid authentication') || lower.includes('unauthenticated') || lower.includes('401')) {
    return 'Google 授權已失效。請先登出雲端再重新登入，然後重試備份操作。';
  }
  if (lower.includes('popup') || lower.includes('blocked')) {
    return 'Google 授權視窗被瀏覽器阻擋。請允許此網站開啟彈出視窗後重試。';
  }
  if (lower.includes('redirect_uri_mismatch')) {
    return `Google OAuth 網址設定不一致。請到 Google Cloud 加入 Redirect URI：${getGoogleAuthRedirectUri()}`;
  }
  if (lower.includes('cannot read properties') || lower.includes('map')) {
    return '資料格式有損壞或缺少清單欄位。請改用最近一份正常備份匯入，或先匯出目前資料讓我檢查。';
  }
  if (lower.includes('json') || lower.includes('syntax')) {
    return '備份檔格式不是有效 JSON。請確認選到的是 cuibo_gasha_backup 開頭的備份檔。';
  }
  return raw || '發生未知錯誤。請先匯出目前資料，再重新整理頁面後重試。';
};

const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_CLIENT_ID_STORAGE_KEY = 'cuibo_gasha_google_client_id';
const GOOGLE_DRIVE_REDIRECT_STATE_KEY = 'cuibo_gasha_drive_redirect_state';
const GOOGLE_DRIVE_REDIRECT_ACTION_KEY = 'cuibo_gasha_drive_redirect_action';
const GOOGLE_DRIVE_TOKEN_STORAGE_KEY = 'cuibo_gasha_drive_token';
const DEFAULT_GOOGLE_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;

const getGoogleClientId = () => {
  return DEFAULT_GOOGLE_CLIENT_ID || localStorage.getItem(GOOGLE_CLIENT_ID_STORAGE_KEY) || '';
};

const getGoogleAuthOrigin = () => window.location.origin;
const getGoogleAuthRedirectUri = () => `${window.location.origin}${window.location.pathname}`;

const getStoredDriveToken = () => {
  try {
    const raw = sessionStorage.getItem(GOOGLE_DRIVE_TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.expiresAt) return null;
    if (Date.now() > Number(parsed.expiresAt) - 60 * 1000) {
      sessionStorage.removeItem(GOOGLE_DRIVE_TOKEN_STORAGE_KEY);
      return null;
    }
    return parsed.token as string;
  } catch {
    sessionStorage.removeItem(GOOGLE_DRIVE_TOKEN_STORAGE_KEY);
    return null;
  }
};

const storeDriveToken = (token: string, expiresInSeconds = 3600) => {
  sessionStorage.setItem(GOOGLE_DRIVE_TOKEN_STORAGE_KEY, JSON.stringify({
    token,
    expiresAt: Date.now() + expiresInSeconds * 1000
  }));
};

const clearDriveToken = () => {
  sessionStorage.removeItem(GOOGLE_DRIVE_TOKEN_STORAGE_KEY);
};

declare global {
  interface Window {
    google?: any;
  }
}

let googleIdentityScriptPromise: Promise<void> | null = null;

const getDeviceId = () => {
  const storageKey = 'cuibo_gasha_device_id';
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(storageKey, next);
  return next;
};

const getBackupCounts = (
  customers: Customer[],
  orders: Order[],
  machines: any[],
  releases: any[],
  operationLogs: OperationLog[] = []
): BackupCounts => {
  const images = machines.filter(machine => typeof machine?.imageUrl === 'string' && machine.imageUrl.trim()).length;
  return {
    customers: customers.length,
    orders: orders.length,
    machines: machines.length,
    releases: releases.length,
    operationLogs: operationLogs.length,
    images,
    totalRecords: customers.length + orders.length + machines.length + releases.length
  };
};

const sortById = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));

const buildHashInput = (payload: Omit<BackupPayload, 'backupMeta'>) => JSON.stringify({
  customers: sortById(payload.customers),
  orders: sortById(payload.orders),
  machines: sortById(payload.machines),
  releases: sortById(payload.releases),
  operationLogs: sortById(payload.operationLogs),
  settings: payload.settings
});

const sha256 = async (text: string) => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const parseCounts = (file: DriveBackupFile | null): BackupCounts | null => {
  if (!file?.appProperties?.counts) return null;
  try {
    const counts = JSON.parse(file.appProperties.counts);
    return {
      customers: Number(counts.customers) || 0,
      orders: Number(counts.orders) || 0,
      machines: Number(counts.machines) || 0,
      releases: Number(counts.releases) || 0,
      operationLogs: Number(counts.operationLogs) || 0,
      images: Number(counts.images) || 0,
      totalRecords: Number(counts.totalRecords) || 0
    };
  } catch {
    return null;
  }
};

const loadGoogleIdentityScript = () => new Promise<void>((resolve, reject) => {
  if (window.google?.accounts?.oauth2) {
    resolve();
    return;
  }
  if (googleIdentityScriptPromise) {
    googleIdentityScriptPromise.then(resolve).catch(reject);
    return;
  }
  const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
  if (existing) {
    existing.addEventListener('load', () => resolve(), { once: true });
    existing.addEventListener('error', () => reject(new Error('Google Identity 載入失敗')), { once: true });
    return;
  }
  googleIdentityScriptPromise = new Promise<void>((scriptResolve, scriptReject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = () => scriptResolve();
    script.onerror = () => scriptReject(new Error('Google Identity 載入失敗'));
    document.head.appendChild(script);
  });
  googleIdentityScriptPromise.then(resolve).catch(reject);
});

const requestGoogleDriveToken = async () => {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('尚未設定 VITE_GOOGLE_CLIENT_ID，請先建立 Google OAuth Client ID 後填入 Vercel 環境變數。');
  }
  if (!window.google?.accounts?.oauth2) {
    loadGoogleIdentityScript().catch(() => {});
    throw new Error('Google 授權元件尚未載入完成，請等 1 秒後再按一次。');
  }

  return new Promise<string>((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_SCOPE,
      prompt: '',
      callback: (response: any) => {
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        if (!response?.access_token) {
          reject(new Error('沒有取得 Google Drive 權杖'));
          return;
        }
        storeDriveToken(response.access_token, Number(response.expires_in) || 3600);
        resolve(response.access_token);
      },
      error_callback: (error: any) => reject(new Error(error?.message || 'Google 授權失敗'))
    });
    tokenClient.requestAccessToken();
  });
};

const driveFetch = async (url: string, token: string, init: RequestInit = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive API 失敗 (${response.status})：${text}`);
  }
  return response;
};

const validateDriveToken = async (token: string) => {
  const response = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!response.ok) {
    throw new Error('Google Drive token 驗證失敗，請重新授權。');
  }
  const info = await response.json();
  const scopes = typeof info.scope === 'string' ? info.scope.split(/\s+/) : [];
  if (!scopes.includes(GOOGLE_DRIVE_SCOPE)) {
    throw new Error('Google Drive 授權範圍不足，請重新授權並允許 Drive 備份權限。');
  }
  return info;
};

const listDriveBackups = async (token: string): Promise<DriveBackupFile[]> => {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: "name contains 'cuibo-gasha-backup-' and trashed=false",
    fields: 'files(id,name,createdTime,modifiedTime,size,appProperties)',
    orderBy: 'createdTime desc',
    pageSize: '20'
  });
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, token);
  const data = await response.json();
  return Array.isArray(data.files) ? data.files : [];
};

const uploadDriveBackup = async (token: string, payload: BackupPayload) => {
  const fileBody = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const metadata = {
    name: `cuibo-gasha-backup-${format(toZonedTime(new Date(), TAIWAN_TZ), 'yyyyMMdd-HHmmss')}.json`,
    parents: ['appDataFolder'],
    mimeType: 'application/json',
    appProperties: {
      app: payload.backupMeta.app,
      backupVersion: String(payload.backupMeta.backupVersion),
      deviceId: payload.backupMeta.deviceId,
      dataHash: payload.backupMeta.dataHash,
      counts: JSON.stringify(payload.backupMeta.counts)
    }
  };

  const sessionResponse = await driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,createdTime,modifiedTime,size,appProperties',
    token,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/json',
        'X-Upload-Content-Length': String(fileBody.size)
      },
      body: JSON.stringify(metadata)
    }
  );
  const uploadUrl = sessionResponse.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('Google Drive 沒有回傳上傳位置');
  }

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: fileBody
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive 上傳失敗 (${response.status})：${text}`);
  }
  return response.json() as Promise<DriveBackupFile>;
};

const downloadDriveBackup = async (token: string, fileId: string) => {
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, token);
  return response.json();
};

const getDriveErrorMessage = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  if (message.toLowerCase().includes('popup')) {
    return 'Google 授權視窗被瀏覽器阻擋，系統將改用同頁授權。';
  }
  return message;
};

const isDrivePopupError = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  return message.toLowerCase().includes('popup');
};

const isDriveAuthError = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('Google Drive API 失敗 (401)') ||
    message.includes('Invalid Credentials') ||
    message.includes('token 驗證失敗') ||
    message.includes('授權範圍不足');
};

type DriveRedirectAction = 'upload' | 'download' | 'refresh';

const startGoogleDriveRedirect = (action: DriveRedirectAction) => {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('尚未設定 Google OAuth Client ID');
  }
  const state = crypto.randomUUID();
  sessionStorage.setItem(GOOGLE_DRIVE_REDIRECT_STATE_KEY, state);
  sessionStorage.setItem(GOOGLE_DRIVE_REDIRECT_ACTION_KEY, action);

  const redirectUri = getGoogleAuthRedirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: GOOGLE_DRIVE_SCOPE,
    include_granted_scopes: 'true',
    state
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
};

const consumeGoogleDriveRedirect = (): { token: string; action: DriveRedirectAction } | null => {
  if (!window.location.hash.includes('access_token=')) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('access_token');
  const expiresIn = Number(params.get('expires_in')) || 3600;
  const state = params.get('state');
  const expectedState = sessionStorage.getItem(GOOGLE_DRIVE_REDIRECT_STATE_KEY);
  const action = sessionStorage.getItem(GOOGLE_DRIVE_REDIRECT_ACTION_KEY) as DriveRedirectAction | null;
  sessionStorage.removeItem(GOOGLE_DRIVE_REDIRECT_STATE_KEY);
  sessionStorage.removeItem(GOOGLE_DRIVE_REDIRECT_ACTION_KEY);
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);

  if (!token || !state || state !== expectedState || !action) return null;
  storeDriveToken(token, expiresIn);
  return { token, action };
};

// --- Components ---

const SuggestiveInput = ({ 
  value, 
  onChange, 
  placeholder, 
  suggestions, 
  className 
}: { 
  value: string, 
  onChange: (v: string) => void, 
  placeholder: string, 
  suggestions: string[],
  className?: string
}) => {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s !== value);

  return (
    <div className="relative w-full">
      <input 
        type="text" 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        placeholder={placeholder}
        className={cn("w-full px-4 py-4 bg-background rounded-2xl border-none focus:ring-2 focus:ring-primary-blue", className)}
      />
      <AnimatePresence>
        {showSuggestions && filtered.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute left-0 right-0 top-full mt-2 bg-card-white rounded-2xl shadow-xl z-50 overflow-y-auto max-h-60 border border-divider"
          >
            {filtered.map(s => (
              <button
                key={s}
                onClick={() => onChange(s)}
                className="w-full px-4 py-3 text-left hover:bg-background text-sm font-medium transition-colors border-b border-divider last:border-none"
              >
                {s}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const LoadingScreen = () => (
  <div className="fixed inset-0 bg-background flex items-center justify-center z-50">
    <div className="text-center">
      <RefreshCw className="w-12 h-12 text-primary-blue animate-spin mx-auto mb-4" />
      <p className="text-ink font-medium">載入中...</p>
    </div>
  </div>
);

const LoginScreen = () => {
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    try {
      setError(null);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        console.log('Login cancelled by user.');
      } else if (err.code === 'auth/network-request-failed') {
        console.error('Login error:', err);
        setError(`登入失敗: 網路請求失敗。這通常發生在瀏覽器阻擋了第三方 Cookie 或彈出式視窗，或您正在預覽畫面中進行登入。請嘗試「在新分頁中開啟」，或關閉瀏覽器的阻擋追蹤功能。`);
      } else {
        console.error('Login error:', err);
        setError(`登入失敗: ${err.message || err.code || '未知錯誤'}`);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-card-white p-8 rounded-3xl card-shadow text-center">
        <div className="w-32 h-32 mx-auto mb-6">
          <img src="/logo.png" alt="Cuibo Store" className="w-full h-full object-contain drop-shadow-md" />
        </div>
        <h1 className="text-2xl font-bold text-ink mb-2">Cuibo Gasha</h1>
        <p className="text-ink/60 mb-8">扭蛋管理系統 - 溫暖、即時、專業</p>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">
            {error}
          </div>
        )}

        <button 
          onClick={handleLogin}
          className="w-full py-4 bg-primary-blue text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:opacity-90 transition-opacity"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm font-bold text-ink">G</span>
          使用 Google 帳號登入
        </button>
      </div>
    </div>
  );
};

const Header = ({ user, activeTab }: { user: User, activeTab: string }) => {
  const tabNames: Record<string, string> = {
    dashboard: '儀表板',
    orders: '訂單清單',
    customers: '顧客管理',
    machines: '機台管理',
    print: '列印預覽',
    settings: '系統設定',
    create: '新增訂單'
  };

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md px-6 py-4 flex items-center justify-between border-b border-divider">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden">
          <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-ink leading-tight">Cuibo Gasha</h1>
          <p className="text-xs text-ink/50 font-medium uppercase tracking-wider">{tabNames[activeTab]}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden sm:block text-right">
          <p className="text-sm font-bold text-ink">{user.displayName}</p>
          <p className="text-[10px] text-ink/50">{user.email}</p>
        </div>
        {user.photoURL ? (
          <img src={user.photoURL} className="w-10 h-10 rounded-full border-2 border-card-white shadow-sm" alt="User" />
        ) : (
          <div className="w-10 h-10 rounded-full border-2 border-card-white shadow-sm bg-primary-blue/10 flex items-center justify-center text-primary-blue font-bold">
            {user.displayName?.charAt(0) || user.email?.charAt(0) || 'U'}
          </div>
        )}
      </div>
    </header>
  );
};

const BottomNav = ({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (t: string) => void }) => {
  const navItems = [
    { id: 'create', icon: Home, label: '首頁' },
    { id: 'orders', icon: List, label: '清單' },
    { id: 'customers', icon: Users, label: '顧客' },
    { id: 'machines', icon: Package, label: '機台' },
    { id: 'print', icon: Printer, label: '列印' },
    { id: 'dashboard', icon: LayoutDashboard, label: '儀表板' },
    { id: 'settings', icon: Settings, label: '設定' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-card-white border-t border-divider pb-[env(safe-area-inset-bottom)] shadow-2xl">
      <div className="flex items-center justify-around py-1 sm:justify-center sm:gap-12">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "flex flex-col items-center gap-0.5 p-2 transition-all duration-300",
              activeTab === item.id ? "text-primary-blue scale-105" : "text-ink/40"
            )}
          >
            <item.icon className={cn("w-5 h-5", activeTab === item.id ? "fill-primary-blue/20" : "")} />
            <span className="text-[10px] font-bold">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};

const BackupStatusBanner = ({
  latestLocalAt,
  lastBackupAt,
  lastDriveBackupAt,
  localCounts,
  latestCloud,
  driveEnabled,
  driveLoading,
  onUpload,
  onOpenSettings
}: {
  latestLocalAt: string | null;
  lastBackupAt?: string;
  lastDriveBackupAt?: string;
  localCounts: BackupCounts;
  latestCloud: DriveBackupFile | null;
  driveEnabled: boolean;
  driveLoading: boolean;
  onUpload: () => void;
  onOpenSettings: () => void;
}) => {
  const localStale = isBackupStale(latestLocalAt, lastBackupAt);
  const driveStale = isBackupStale(latestLocalAt, lastDriveBackupAt);
  const cloudCounts = parseCounts(latestCloud);
  const cloudAt = latestCloud?.createdTime || lastDriveBackupAt;
  if (!latestLocalAt || (!localStale && !driveStale)) return null;

  return (
    <div className="mb-6 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-bold">目前有尚未備份的本地資料</p>
            <p className="mt-1 text-xs font-medium text-amber-800/75">
              最新資料：{formatDateTime(latestLocalAt)}。本機備份：{lastBackupAt ? formatDateTime(lastBackupAt) : '尚無'}；雲端備份：{lastDriveBackupAt ? formatDateTime(lastDriveBackupAt) : '尚無'}。
            </p>
            <div className="mt-3 grid gap-2 text-[11px] font-bold sm:grid-cols-2">
              <div className="rounded-xl bg-white/70 p-3">
                <p className="text-amber-900/50">本地資料</p>
                <p className="mt-1">{formatBackupCounts(localCounts)}</p>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <p className="text-amber-900/50">雲端資料</p>
                <p className="mt-1">{cloudAt ? `${formatDateTime(cloudAt)}；${formatBackupCounts(cloudCounts)}` : '尚未讀取到雲端備份'}</p>
              </div>
            </div>
            <p className="mt-2 text-xs font-bold text-amber-900">
              {getBackupFreshness(latestLocalAt, cloudAt)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {driveEnabled && (
            <button
              onClick={onUpload}
              disabled={driveLoading}
              className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {driveLoading ? '上傳中' : '立即上傳'}
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-amber-800"
          >
            備份設定
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Tab Components ---

const CreateOrder = ({ 
  customers, 
  orders,
  machines,
  settings, 
  setActiveTab,
  showToast
}: { 
  customers: Customer[], 
  orders: Order[],
  machines: any[],
  settings: SystemSettings | null,
  setActiveTab: (t: string) => void,
  showToast: (m: string, t?: 'success' | 'error') => void
}) => {
  const [customerName, setCustomerName] = useState('');
  const [machineName, setMachineName] = useState('');
  const [price, setPrice] = useState<number>(100);
  const [orderItems, setOrderItems] = useState([{ id: crypto.randomUUID(), variant: '', quantity: 1, isEco: false }]);
  const [callTime, setCallTime] = useState(() => getCurrentDateTimeInputValue());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [aiVariantDetails, setAiVariantDetails] = useState<Record<string, MachineVariantDetail>>({});
  const [aiCandidate, setAiCandidate] = useState<{
    source: 'exact-image' | 'similar-image' | 'ai';
    machineName: string;
    price: number;
    variants: string[];
    variantDetails: Record<string, MachineVariantDetail>;
    existingMachine?: any;
    similarity?: number;
    factCheckNotes?: string;
    sources?: string[];
  } | null>(null);
  const [isFullscreenImage, setIsFullscreenImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyAiCandidate = (candidate = aiCandidate) => {
    if (!candidate) return;
    setMachineName(candidate.existingMachine?.name || candidate.machineName);
    setPrice(candidate.existingMachine?.defaultPrice || candidate.price || price);
    setAiVariantDetails(candidate.variantDetails);
    setOrderItems((candidate.variants.length > 0 ? candidate.variants : ['']).map((variant) => ({
      id: crypto.randomUUID(),
      variant,
      quantity: 1,
      isEco: false
    })));
    setAiCandidate(null);
    showToast(candidate.existingMachine ? `已套用既有機台「${candidate.existingMachine.name}」` : '已套用 AI 建議，請確認後新增');
  };

  const processImage = async (file: File) => {
    setIsAnalyzing(true);
    showToast('正在分析圖片...', 'success');

    try {
      const compressImage = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX_WIDTH = 1024;
              const MAX_HEIGHT = 1024;
              let width = img.width;
              let height = img.height;

              if (width > height) {
                if (width > MAX_WIDTH) {
                  height *= MAX_WIDTH / width;
                  width = MAX_WIDTH;
                }
              } else {
                if (height > MAX_HEIGHT) {
                  width *= MAX_HEIGHT / height;
                  height = MAX_HEIGHT;
                }
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
              }
              resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = (error) => reject(error);
          };
          reader.onerror = (error) => reject(error);
        });
      };

      const calculateHash = (dataUrl: string): Promise<string> => {
        return new Promise((resolve) => {
          if (!dataUrl) { resolve(''); return; }
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 9;
            canvas.height = 8;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(''); return; }
            ctx.drawImage(img, 0, 0, 9, 8);
            const data = ctx.getImageData(0, 0, 9, 8).data;
            let hash = '';
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                const idx1 = (y * 9 + x) * 4;
                const idx2 = (y * 9 + x + 1) * 4;
                const luma1 = data[idx1] * 0.299 + data[idx1 + 1] * 0.587 + data[idx1 + 2] * 0.114;
                const luma2 = data[idx2] * 0.299 + data[idx2 + 1] * 0.587 + data[idx2 + 2] * 0.114;
                hash += luma1 > luma2 ? '1' : '0';
              }
            }
            resolve(hash);
          };
          img.onerror = () => resolve('');
          img.src = dataUrl;
        });
      };

      const hashDistance = (h1: string, h2: string): number => {
        if (!h1 || !h2 || h1.length !== 64 || h2.length !== 64) return 64;
        let diff = 0;
        for (let i = 0; i < 64; i++) {
          if (h1[i] !== h2[i]) diff++;
        }
        return diff;
      };

      const compressedDataUrl = await compressImage(file);
      const suggestExistingMachine = (machine: any, source: 'exact-image' | 'similar-image', message: string, similarity?: number) => {
        setUploadedImage(compressedDataUrl);
        setAiCandidate({
          source,
          machineName: machine.name,
          price: machine.defaultPrice,
          variants: machine.variants || [],
          variantDetails: normalizeVariantDetails(machine.variants || [], machine.variantDetails),
          existingMachine: machine,
          similarity,
          factCheckNotes: message
        });
        showToast(message, 'success');
      };
      
      // 檢查是否已經上傳過相同的圖片 (精確匹配)
      const existingMachineByImg = machines.find(m => m.imageUrl === compressedDataUrl);
      if (existingMachineByImg) {
        suggestExistingMachine(existingMachineByImg, 'exact-image', `已找到相同圖片：請確認是否套用既有機台「${existingMachineByImg.name}」`);
        setIsAnalyzing(false);
        return;
      }

      // 進階檢查：相似度高達 90% 以上 (差異 <= 6)
      const targetHash = await calculateHash(compressedDataUrl);
      if (targetHash) {
        const hashPromises = machines.map(async (m) => {
          if (m.imageUrl) {
            const h = await calculateHash(m.imageUrl);
            return { machine: m, hash: h };
          }
          return null;
        });
        const hashes = await Promise.all(hashPromises);
        
        let bestMatch = null;
        let lowestDist = 64;
        for (const item of hashes) {
          if (item && item.hash) {
            const dist = hashDistance(targetHash, item.hash);
            if (dist < lowestDist) {
              lowestDist = dist;
              bestMatch = item.machine;
            }
          }
        }

        if (bestMatch && lowestDist <= 6) {
          const similarity = Math.round((1 - lowestDist / 64) * 100);
          suggestExistingMachine(bestMatch, 'similar-image', `圖片相似度 ${similarity}%：請確認是否套用既有機台「${bestMatch.name}」`, similarity);
          setIsAnalyzing(false);
          return;
        }
      }

      const base64String = compressedDataUrl.split(',')[1];
      setUploadedImage(compressedDataUrl);
      
      const apiKeys = [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_KEY_2,
        process.env.GEMINI_API_KEY_3,
        process.env.GEMINI_API_KEY_4,
        process.env.GEMINI_API_KEY_5
      ].filter(Boolean) as string[];
      
      let response;
      let aiError;
      const shuffledKeys = apiKeys.sort(() => Math.random() - 0.5);
      if (shuffledKeys.length === 0) throw new Error("No Gemini API keys configured");

      for (const key of shuffledKeys) {
        try {
          const ai = new GoogleGenAI({ apiKey: key });
      
          response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  data: base64String,
                  mimeType: "image/jpeg"
                }
              },
              {
                text: "請根據系統指令分析此圖片，並嚴格依照指定的 JSON 格式回傳結果。"
              }
            ]
          }
        ],
        config: {
          systemInstruction: `[角色任務]
你是一位嚴謹且精通日文、台灣玩具圈在地用語與電商倉儲管理的扭蛋辨識專家。你的任務是將日本扭蛋商品圖片轉換成台灣玩家看得懂、倉儲人員容易撿貨、且能避免重複建檔的機台名稱與款式名稱。

[背景資訊]
需處理日本扭蛋商品資訊，克服語言與文化差異，並確保所有翻譯完全符合台灣玩家的習慣用語。不得使用中國大陸、香港或非台灣常用譯名取代台灣正式或慣用名稱。為了提升實體撿貨的直覺性與作業效率，必須將圖片中的商品轉換為標準化名稱。維持既有資料的一致性是第一優先，不能因翻譯方式不同而建立重複機台或重複款式。

[台灣譯名優先]
所有角色、作品、道具與款式名稱都必須使用台灣正式譯名或台灣玩具圈慣用譯名。若官方或市售資料出現不同地區譯名，請優先採用台灣用語，並避免中國大陸用語。
常見例子：
- Baymax / ベイマックス：台灣用「杯麵」，不可用「大白」。
- Scrump / スクランプ：台灣常用「醜丫頭」，不可自行翻成其他名稱。
- Winnie the Pooh / くまのプーさん：台灣用「小熊維尼」。
- Piglet / ピグレット：台灣用「小豬」。
- Simba / シンバ：台灣用「辛巴」。
- Rafiki / ラフィキ：台灣用「拉飛奇」。
如果不確定台灣正式譯名，請查證台灣官方、台灣 Disney / Bandai / 玩具通路、市售頁面或台灣玩家常用稱呼；信心低於 90% 時輸出「【資料不足，無法確認】」。

[既有資料庫優先]
在產生任何新名稱前，請先比對以下已建立機台與款式。若圖片中的商品屬於既有機台，machineName 必須逐字回傳既有機台名稱，variants 必須優先逐字使用該機台已建立款式，不得另創其他翻譯版本。
現有機台與款式：
${machines.map(formatMachineForAiPrompt).join('\n')}

[具體指令]
在開始辨識與翻譯前，請務必先啟動「內部事實查核」程序：
1. 證據優先：僅依據圖片可見資訊、既有資料庫資料，以及可查證的官方或市售資訊回答，嚴禁使用「可能、應該、或許」等模糊推測。
2. 允許留白：如果對某款式的翻譯或資訊信心水準低於 90%，或缺乏足夠資訊，該款式直接輸出「【資料不足，無法確認】」。
3. 來源標註：請在 factCheckNotes 或 sources 中列出查證依據、參考來源連結，或明確說明是根據圖片可見特徵與既有資料庫比對而來。

完成查核後，請執行以下操作：
1. 上網搜尋並確認該扭蛋系列的完整官方或市售資訊。
2. 辨識出該系列包含的所有款式。
3. 將每一種款式的日文名稱逐一翻譯為最貼近台灣習慣的道地用語，必須優先使用台灣正式譯名，不得使用中國大陸譯名。
4. 扭蛋系列機台名稱限制在 15 字以內，主動去除行銷贅字，僅保留核心角色與主題。
5. 款式名稱以肉眼撿貨為優先，格式必須使用「角色/款式名稱 + 視覺特徵」。前半段是正確翻譯後的角色或款式名稱，後半段是這一顆與其他款式最容易區分的外觀、動作、持物、同伴或姿勢。
6. 款式名稱不可只輸出角色名稱，也不可只輸出原文翻譯。每一個 variants 項目都必須同時包含「名稱」與「特徵」兩段資訊。
7. 若圖片款式是「くまのプーさん＆ピグレット」，應輸出「小熊維尼 維尼抱著小豬」，不要只輸出「小熊維尼」或「小熊維尼與小豬」。
8. 其他格式範例：「史迪奇 抱著醜丫頭」、「杯麵 騎著招財貓」、「辛巴與拉飛奇 拉飛奇抱著辛巴」。請勿包含括號或「檢貨」字樣。
9. 請同時輸出 variantDetails。每個 variantDetails.name 必須與 variants 內的款式名稱逐字相同。originalName 填日文原文款式名稱；feature 填最容易目視區分的特徵；aliases 填常見別名、錯譯或不同地區用語，例如杯麵可把「大白、Baymax、ベイマックス」放入 aliases，方便之後比對但不要拿來當正式名稱。

[約束條件]
- 視覺核心優先與字數限制：去除所有行銷贅字。扭蛋系列檢貨標題絕對不可超過 15 個字。單款視覺特徵檢貨名稱應極致精煉，專注描述核心外觀差異，格式為「名稱+特徵」。
- 款式命名強制規則：variants 裡的每一筆都必須是「角色/款式名稱 + 目視特徵」，例如「小熊維尼 維尼抱著小豬」。只有角色名、只有系列名、只有「角色A與角色B」都不合格。
- 台灣譯名強制規則：所有角色名稱必須使用台灣正式或慣用譯名。例如 Baymax 必須輸出「杯麵」，不可輸出「大白」。
- 現有機台優先：如果圖片中的商品屬於既有機台，請務必直接使用既有 machineName 與既有 variants，避免因翻譯差異建立重複資料。
- 若既有機台已有款式，除非圖片明確出現資料庫沒有的新款式，否則不要輸出新的款式翻譯。
- 證據優先：嚴禁使用「可能、應該、或許」等模糊推測。
- 允許留白：若信心水準低於 90% 或無法確認品項，請輸出「【資料不足，無法確認】」。
- 格式要求：一律使用繁體中文。`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              machineName: { 
                type: Type.STRING,
                description: "系列檢貨標題，嚴格限制在 15 字以內"
              },
              variants: { 
                type: Type.ARRAY,
                items: { 
                  type: Type.STRING,
                  description: "視覺特徵檢貨名稱，格式：[角色/款式名稱] [目視特徵]。不可只輸出角色名。例如：小熊維尼 維尼抱著小豬、美樂蒂 手上拿麥克風"
                }
              },
              price: { 
                type: Type.NUMBER,
                description: "辨識出的金額"
              },
              factCheckNotes: {
                type: Type.STRING,
                description: "簡短說明查證依據、推論邏輯，或指出已沿用資料庫既有資料"
              },
              sources: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                  description: "官方或市售參考來源連結；若無可靠來源可留空陣列"
                }
              },
              variantDetails: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: {
                      type: Type.STRING,
                      description: "必須與 variants 中的正式款式名稱逐字相同"
                    },
                    originalName: {
                      type: Type.STRING,
                      description: "圖片或查證來源中的日文原文款式名稱；無法確認時留空字串"
                    },
                    feature: {
                      type: Type.STRING,
                      description: "肉眼最容易分辨此款的外觀、動作、持物、同伴或姿勢"
                    },
                    aliases: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.STRING,
                        description: "常見別名、錯譯、英文名、日文名或不同地區用語"
                      }
                    }
                  }
                }
              }
            }
          }
        }
        });
        break; // success
        } catch (err: any) {
             console.warn("API Error with a key, trying next... ", err?.message);
             aiError = err;
        }
      }
      if (!response) throw aiError || new Error("All API keys failed.");

      const text = response.text;
      if (text) {
        const result = JSON.parse(text);
        const aiMachineName = result.machineName || '';
        const aiVariants = normalizeVariantNames(result.variants || (result.variant ? [result.variant] : []));
        const detectedVariantDetails = normalizeAiVariantDetails(aiVariants, result.variantDetails);
        const normalizeMachineName = (value: string) => value.toLowerCase().replace(/[\s　・･\-—＿_（）()【】\[\]]+/g, '');
        
        // 檢查 AI 回傳的機台名稱是否已存在；若只是空格或標點差異，也優先沿用既有資料。
        const normalizedAiMachineName = normalizeMachineName(aiMachineName);
        const existingMachineByName = machines.find(m => {
          const normalizedExistingName = normalizeMachineName(m.name);
          return normalizedExistingName === normalizedAiMachineName ||
            (normalizedAiMachineName.length >= 4 && normalizedExistingName.includes(normalizedAiMachineName)) ||
            (normalizedExistingName.length >= 4 && normalizedAiMachineName.includes(normalizedExistingName));
        });
        
        if (existingMachineByName) {
          const mergedDetails = {
            ...normalizeVariantDetails(existingMachineByName.variants || [], existingMachineByName.variantDetails),
            ...detectedVariantDetails
          };
          setAiCandidate({
            source: 'ai',
            machineName: existingMachineByName.name,
            price: existingMachineByName.defaultPrice,
            variants: existingMachineByName.variants && existingMachineByName.variants.length > 0 ? existingMachineByName.variants : aiVariants,
            variantDetails: mergedDetails,
            existingMachine: existingMachineByName,
            factCheckNotes: result.factCheckNotes,
            sources: Array.isArray(result.sources) ? result.sources : []
          });
          showToast(`AI 找到疑似既有機台「${existingMachineByName.name}」，請確認後套用`, 'success');
        } else {
          setAiCandidate({
            source: 'ai',
            machineName: aiMachineName,
            price: Number(result.price) || price,
            variants: aiVariants,
            variantDetails: detectedVariantDetails,
            factCheckNotes: result.factCheckNotes,
            sources: Array.isArray(result.sources) ? result.sources : []
          });
          showToast('圖片分析完成，請確認候選結果後套用', 'success');
        }
      }
      setIsAnalyzing(false);
    } catch (err) {
      console.error(err);
      showToast(`圖片分析失敗：${getActionableErrorMessage(err)}`, 'error');
      setIsAnalyzing(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processImage(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            await processImage(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [settings]);

  // Auto-fill price and variants when machine name changes
  useEffect(() => {
    if (!machineName) return;
    const machine = machines.find(m => m.name === machineName);
    if (machine) {
      setPrice(machine.defaultPrice);
    } else {
      const lastOrderWithMachine = orders.find(o => o.items.some(i => i.machineName === machineName));
      if (lastOrderWithMachine) {
        const item = lastOrderWithMachine.items.find(i => i.machineName === machineName);
        if (item) {
          const baseTwdPrice = item.price - (item.variant?.includes('(環保)') ? 10 : 0);
          const currentPriceMap = settings?.priceMap || DEFAULT_PRICE_MAP;
          const jpyPriceStr = Object.keys(currentPriceMap).find(key => currentPriceMap[parseInt(key)] === baseTwdPrice);
          if (jpyPriceStr) {
            setPrice(parseInt(jpyPriceStr));
          }
        }
      }
    }
  }, [machineName, machines, orders, settings]);

  const submitOrder = async (mode: 'same_cust' | 'same_item' | 'same_both' | 'new') => {
    const trimmedName = customerName.replace(/\s+/g, '');
    
    let totalAddedQuantity = 0;
    const newVariantsToSave = new Set<string>();

    for (const orderItem of orderItems) {
      if (orderItem.variant.trim()) {
        newVariantsToSave.add(orderItem.variant.trim());
      }
      if (orderItem.quantity > 0) {
        totalAddedQuantity += orderItem.quantity;
      }
    }

    if (!machineName) {
      showToast('請填寫機台名稱', 'error');
      return;
    }

    if (totalAddedQuantity > 0 && !trimmedName) {
      showToast('請填寫顧客名稱', 'error');
      return;
    }

    if (totalAddedQuantity === 0 && newVariantsToSave.size === 0 && !uploadedImage) {
      showToast('請至少輸入一個數量大於0的項目，或輸入款式/上傳圖片以建立機台資料', 'error');
      return;
    }
    
    const now = new Date().toISOString();
    const orderCallTime = fromDateTimeInputValue(callTime, now);
    
    try {
      const undoSnapshot = await createRestoreSnapshot();
      const batch = writeBatch(db);
      let customerId: string | undefined;
      let existingOrder: Order | undefined;
      let newCustomerRef: any = null;
      let newCustomerBase: Omit<Customer, 'id'> | null = null;
      let orderCustomerName = trimmedName;

      if (totalAddedQuantity > 0) {
        // 1. Find or Create Customer
        let customer = findCustomerByName(customers, trimmedName);
        customerId = customer?.id;
        orderCustomerName = customer?.name || trimmedName;

        if (!customer) {
          const newCustRef = dbDoc('customers');
          const newCust: Omit<Customer, 'id'> = {
            name: orderCustomerName,
            aliases: [],
            totalSpent: 0,
            totalItems: 0,
            createdAt: now,
            lastOrderAt: now
          };
          customerId = newCustRef.id;
          customer = { id: customerId, ...newCust };
          newCustomerRef = newCustRef;
          newCustomerBase = newCust;
        }

        // 2. Find existing pending order for this customer to consolidate
        existingOrder = orders.find(o => o.customerId === customerId && o.status === 'pending');
      }
      
      let updatedItems = existingOrder ? [...existingOrder.items] : [];
      let totalAddedAmount = 0;

      for (const orderItem of orderItems) {
        if (orderItem.quantity <= 0) continue;
        
        const itemPrice = (settings?.priceMap?.[price] || DEFAULT_PRICE_MAP[price] || 0) + (orderItem.isEco ? 10 : 0);
        const subtotal = itemPrice * orderItem.quantity;
        const finalVariant = orderItem.variant + (orderItem.isEco ? ' (環保)' : '');
        
        totalAddedAmount += subtotal;

        updatedItems.push({
          id: Math.random().toString(36).substr(2, 9),
          machineName,
          price: itemPrice,
          quantity: orderItem.quantity,
          variant: finalVariant,
          subtotal,
          createdAt: now,
          callTime: orderCallTime,
          isChecked: false
        });
      }

      if (totalAddedQuantity > 0 && customerId) {
        if (newCustomerRef && newCustomerBase) {
          batch.set(newCustomerRef, {
            ...newCustomerBase,
            totalSpent: totalAddedAmount,
            totalItems: totalAddedQuantity,
            lastOrderAt: now
          });
        }

        if (existingOrder) {
          batch.update(dbDoc('orders', existingOrder.id), {
            items: updatedItems,
            totalAmount: existingOrder.totalAmount + totalAddedAmount,
            updatedAt: now
          });
        } else {
          // Create new order
          const orderRef = dbDoc('orders');
          const newOrder: Omit<Order, 'id'> = {
            customerId: customerId!,
            customerName: orderCustomerName,
            items: updatedItems,
            totalAmount: totalAddedAmount,
            status: 'pending',
            createdAt: now,
            updatedAt: now
          };
          batch.set(orderRef, newOrder);
        }
        
        // 3. Update customer stats
        if (!newCustomerRef) {
          batch.update(dbDoc('customers', customerId!), {
            totalSpent: increment(totalAddedAmount),
            totalItems: increment(totalAddedQuantity),
            lastOrderAt: now
          });
        }
      }

      // 4. Update Machine Variants and Image
      const machine = machines.find(m => m.name === machineName);
      if (machine) {
        const variantsToAdd = Array.from(newVariantsToSave).filter(v => !machine.variants.includes(v));
        const nextVariants = variantsToAdd.length > 0 ? [...machine.variants, ...variantsToAdd] : machine.variants;
        const mergedVariantDetails = normalizeVariantDetails(nextVariants, {
          ...normalizeVariantDetails(machine.variants || [], machine.variantDetails),
          ...aiVariantDetails
        });
        const updates: any = { updatedAt: now };
        if (variantsToAdd.length > 0) {
          updates.variants = nextVariants;
        }
        if (Object.keys(aiVariantDetails).length > 0 || variantsToAdd.length > 0) {
          updates.variantDetails = mergedVariantDetails;
        }
        if (uploadedImage && machine.imageUrl !== uploadedImage) {
          updates.imageUrl = uploadedImage;
        }
        if (Object.keys(updates).length > 1) { // more than just updatedAt
          batch.update(dbDoc('machines', machine.id), updates);
        }
      } else {
        const machineRef = dbDoc('machines');
        const newMachine: any = {
          name: machineName,
          defaultPrice: parseInt(price as any) || 0,
          variants: Array.from(newVariantsToSave),
          variantDetails: normalizeVariantDetails(Array.from(newVariantsToSave), aiVariantDetails),
          createdAt: now,
          updatedAt: now
        };
        if (uploadedImage) {
          newMachine.imageUrl = uploadedImage;
        }
        batch.set(machineRef, newMachine);
      }

      await batch.commit();
      await addOperationLog(
        totalAddedQuantity > 0 ? 'order_create' : 'machine_create',
        totalAddedQuantity > 0 ? 'order' : 'machine',
        totalAddedQuantity > 0
          ? `${trimmedName} 新增 ${totalAddedQuantity} 顆，NT$${totalAddedAmount}`
          : `建立機台資料：${machineName}`,
        totalAddedQuantity > 0 ? trimmedName : machineName,
        { undoSnapshot, machineName, quantity: totalAddedQuantity, amount: totalAddedAmount, mode, callTime: orderCallTime }
      );
      showToast(totalAddedQuantity > 0 ? '訂單已更新/建立！' : '機台資料已建立！');
      setCallTime(getCurrentDateTimeInputValue());

      // Handle Modes
      if (mode === 'same_cust') {
        // Clear items, keep customer
        setMachineName('');
        setOrderItems([{ id: crypto.randomUUID(), variant: '', quantity: 1, isEco: false }]);
        setUploadedImage(null);
        setAiVariantDetails({});
      } else if (mode === 'same_item') {
        // Keep items, clear customer
        setCustomerName('');
      } else if (mode === 'same_both') {
        // Keep all - just stay here
      } else {
        // New - clear all
        setCustomerName('');
        setMachineName('');
        setOrderItems([{ id: crypto.randomUUID(), variant: '', quantity: 1, isEco: false }]);
        setUploadedImage(null);
        setAiVariantDetails({});
        setActiveTab('create');
      }
    } catch (err: any) {
      console.error(err);
      showToast(`新增失敗：${getActionableErrorMessage(err)}`, 'error');
    }
  };

  const customerSuggestions = getCustomerNameSuggestions(customers);
  const machineSuggestions = Array.from(new Set([
    ...machines.map(m => m.name),
    ...orders.flatMap(o => o.items.map(i => i.machineName))
  ]));
  const latestOrder = [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const latestMachineName = latestOrder?.items?.[latestOrder.items.length - 1]?.machineName || '';
  const quickMachines = Array.from(
    orders.flatMap(order => order.items).reduce((map, item) => {
      map.set(item.machineName, (map.get(item.machineName) || 0) + item.quantity);
      return map;
    }, new Map<string, number>())
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name]) => name);
  const adjustCallTimeMinutes = (minutes: number) => {
    const base = callTime ? new Date(callTime) : new Date();
    if (Number.isNaN(base.getTime())) {
      setCallTime(getCurrentDateTimeInputValue());
      return;
    }
    base.setMinutes(base.getMinutes() + minutes);
    setCallTime(toDateTimeInputValue(base.toISOString()));
  };
  
  const selectedMachine = machines.find(m => m.name === machineName);
  const variantSuggestions = selectedMachine 
    ? Array.from(new Set([
        ...(selectedMachine.variants || []),
        ...orders.flatMap(o => o.items).filter(i => i.machineName === machineName).map(i => i.variant).filter(Boolean)
      ]))
    : Array.from(new Set(
        orders
          .flatMap(o => o.items)
          .filter(i => i.machineName === machineName)
          .map(i => i.variant || '')
      )).filter(v => v && !v.includes('(環保)'));

  return (
    <div className="space-y-6 pb-24">
      <div className="bg-card-white p-6 rounded-3xl card-shadow">
        <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4">輸入顧客名稱</h3>
        <SuggestiveInput 
          value={customerName}
          onChange={setCustomerName}
          placeholder="輸入或選擇顧客名稱..."
          suggestions={customerSuggestions}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {latestOrder?.customerName && (
            <button
              onClick={() => setCustomerName(latestOrder.customerName)}
              className="rounded-xl bg-background px-3 py-2 text-xs font-bold text-ink/60"
            >
              上一位：{latestOrder.customerName}
            </button>
          )}
          <button
            onClick={() => setCustomerName('')}
            className="rounded-xl bg-background px-3 py-2 text-xs font-bold text-ink/40"
          >
            清空顧客
          </button>
        </div>
        <div className="mt-4">
          <label className="text-xs font-bold text-ink/40 block mb-2">喊單時間</label>
          <input
            type="datetime-local"
            value={callTime}
            onChange={(e) => setCallTime(e.target.value)}
            className="w-full px-4 py-3 bg-background rounded-xl border-none text-ink outline-none focus:ring-2 focus:ring-primary-blue"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => setCallTime(getCurrentDateTimeInputValue())} className="rounded-lg bg-background px-3 py-1.5 text-[10px] font-bold text-ink/50">現在</button>
            <button onClick={() => adjustCallTimeMinutes(1)} className="rounded-lg bg-background px-3 py-1.5 text-[10px] font-bold text-ink/50">+1 分</button>
            <button onClick={() => adjustCallTimeMinutes(5)} className="rounded-lg bg-background px-3 py-1.5 text-[10px] font-bold text-ink/50">+5 分</button>
            <button onClick={() => adjustCallTimeMinutes(-1)} className="rounded-lg bg-background px-3 py-1.5 text-[10px] font-bold text-ink/50">-1 分</button>
          </div>
          <p className="text-[10px] text-ink/30 mt-2">預設當下時間；新增成功後會自動更新為新的當下時間。</p>
        </div>
      </div>

      <div className="bg-card-white p-6 rounded-3xl card-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-background rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
              <Package className="w-6 h-6 text-ink/20" />
            </div>
            <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest">機台與款式</h3>
          </div>
          <div>
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleImageUpload}
            />
            <div className="flex flex-col items-end gap-1">
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isAnalyzing}
                className="px-4 py-2 bg-primary-blue/10 text-primary-blue rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-primary-blue/20 transition-colors disabled:opacity-50"
              >
                {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {isAnalyzing ? '分析中...' : '圖片辨識'}
              </button>
              <span className="text-[10px] text-ink/30 font-bold">支援 Ctrl+V 貼上圖片</span>
            </div>
          </div>
        </div>

        {uploadedImage && (
          <div className="mb-6 relative group cursor-pointer" onClick={() => setIsFullscreenImage(true)}>
            <div className="w-full h-80 sm:h-96 rounded-2xl overflow-hidden bg-background border border-divider relative">
              <img src={uploadedImage || undefined} alt="Uploaded" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                <span className="bg-black/50 text-white px-3 py-1 rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity">點擊放大</span>
              </div>
            </div>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setUploadedImage(null);
                setAiVariantDetails({});
                setAiCandidate(null);
              }}
              className="absolute top-2 right-2 p-2 bg-white/80 hover:bg-white rounded-full shadow-sm text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}

        {aiCandidate && (
          <div className="mb-6 rounded-3xl border border-primary-blue/20 bg-primary-blue/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold text-primary-blue">AI 候選確認</p>
                <h4 className="mt-1 break-words text-lg font-bold text-ink">
                  {aiCandidate.existingMachine ? `疑似既有機台：${aiCandidate.existingMachine.name}` : aiCandidate.machineName || '未命名機台'}
                </h4>
                <p className="mt-1 text-xs font-medium text-ink/50">
                  {aiCandidate.similarity ? `圖片相似度 ${aiCandidate.similarity}%；` : ''}
                  價格 ¥{aiCandidate.price || price}；款式 {aiCandidate.variants.length} 筆。套用後才會進入目前表單，儲存前仍可修改。
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setAiCandidate(null)}
                  className="rounded-xl bg-card-white px-4 py-2 text-xs font-bold text-ink/60"
                >
                  不採用
                </button>
                <button
                  onClick={() => applyAiCandidate()}
                  className="rounded-xl bg-primary-blue px-4 py-2 text-xs font-bold text-white"
                >
                  套用候選
                </button>
              </div>
            </div>
            {aiCandidate.existingMachine?.imageUrl && (
              <div className="mt-3 overflow-hidden rounded-2xl bg-card-white">
                <img src={aiCandidate.existingMachine.imageUrl || undefined} alt="既有機台圖片" className="h-40 w-full object-contain" referrerPolicy="no-referrer" />
              </div>
            )}
            <div className="mt-3 grid gap-2">
              {aiCandidate.variants.map(variant => {
                const detail = aiCandidate.variantDetails[variant];
                return (
                  <div key={variant} className="rounded-2xl bg-card-white p-3 text-xs">
                    <p className="font-bold text-ink">{variant}</p>
                    <p className="mt-1 text-ink/50">
                      {[
                        detail?.originalName ? `原文：${detail.originalName}` : '',
                        detail?.feature ? `特徵：${detail.feature}` : '',
                        detail?.aliases?.length ? `別名：${detail.aliases.join('、')}` : ''
                      ].filter(Boolean).join(' / ') || '尚無結構化補充'}
                    </p>
                  </div>
                );
              })}
            </div>
            {aiCandidate.factCheckNotes && (
              <p className="mt-3 rounded-2xl bg-card-white p-3 text-xs font-medium leading-relaxed text-ink/55">
                {aiCandidate.factCheckNotes}
              </p>
            )}
            {aiCandidate.sources && aiCandidate.sources.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {aiCandidate.sources.map(source => (
                  <a key={source} href={source} target="_blank" rel="noreferrer" className="rounded-lg bg-card-white px-2 py-1 text-[10px] font-bold text-primary-blue">
                    來源
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 mb-4">
          <SuggestiveInput 
            value={machineName}
            onChange={(value) => {
              setMachineName(value);
              const selected = machines.find(m => m.name === value);
              if (selected) {
                setAiVariantDetails(normalizeVariantDetails(selected.variants || [], selected.variantDetails));
              }
            }}
            placeholder="輸入機台名稱 (例: 吉伊卡哇)"
            suggestions={machineSuggestions}
          />
          <div className="flex flex-wrap gap-2">
            {latestMachineName && (
              <button
                onClick={() => setMachineName(latestMachineName)}
                className="rounded-xl bg-background px-3 py-2 text-xs font-bold text-ink/60"
              >
                上一台：{latestMachineName}
              </button>
            )}
            {quickMachines.map(name => (
              <button
                key={name}
                onClick={() => setMachineName(name)}
                className="rounded-xl bg-primary-blue/10 px-3 py-2 text-xs font-bold text-primary-blue"
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 mb-6">
          {orderItems.map((item, index) => (
            <div key={item.id} className="flex flex-col gap-3 p-4 bg-background rounded-2xl">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-ink/40">款式 {index + 1}</h4>
                {orderItems.length > 1 && (
                  <button onClick={() => setOrderItems(orderItems.filter(i => i.id !== item.id))} className="text-red-400 hover:text-red-500 p-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative">
                  <SuggestiveInput 
                    value={item.variant}
                    onChange={(v) => {
                      const newItems = [...orderItems];
                      newItems[index].variant = v;
                      setOrderItems(newItems);
                    }}
                    placeholder="輸入款式 (選填)"
                    suggestions={variantSuggestions}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button onClick={() => {
                      const newItems = [...orderItems];
                      newItems[index].quantity = Math.max(0, newItems[index].quantity - 1);
                      setOrderItems(newItems);
                    }} className="w-10 h-10 bg-card-white rounded-full flex items-center justify-center shadow-sm">-</button>
                    <span className="text-xl font-bold w-8 text-center">{item.quantity}</span>
                    <button onClick={() => {
                      const newItems = [...orderItems];
                      newItems[index].quantity++;
                      setOrderItems(newItems);
                    }} className="w-10 h-10 bg-card-white rounded-full flex items-center justify-center shadow-sm">+</button>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={item.isEco} 
                      onChange={(e) => {
                        const newItems = [...orderItems];
                        newItems[index].isEco = e.target.checked;
                        setOrderItems(newItems);
                      }}
                      className="w-4 h-4 rounded text-primary-blue focus:ring-primary-blue"
                    />
                    <span className="text-xs font-bold text-ink/60">環保費 (+$10)</span>
                  </label>
                </div>
              </div>
            </div>
          ))}
          <button 
            onClick={() => setOrderItems([...orderItems, { id: crypto.randomUUID(), variant: '', quantity: 1, isEco: false }])}
            className="w-full py-3 border-2 border-dashed border-ink/20 text-ink/40 rounded-2xl font-bold text-sm hover:bg-ink/5 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> 新增款式
          </button>
        </div>

        {Object.keys(aiVariantDetails).length > 0 && (
          <div className="mb-6 rounded-2xl bg-primary-blue/5 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-primary-blue">AI 已填入款式辨識資料</p>
              <p className="text-[10px] font-bold text-ink/35">儲存後可到機台編輯修改</p>
            </div>
            <div className="space-y-2">
              {Array.from(new Set(orderItems.map(item => item.variant.trim()).filter(Boolean)))
                .map(variant => {
                  const detail = aiVariantDetails[variant];
                  if (!detail) return null;
                  return (
                    <div key={variant} className="rounded-xl bg-card-white p-3 text-xs">
                      <p className="font-bold text-ink">{variant}</p>
                      <p className="mt-1 text-ink/50">
                        {[
                          detail.originalName ? `原文：${detail.originalName}` : '',
                          detail.feature ? `特徵：${detail.feature}` : '',
                          detail.aliases?.length ? `別名：${detail.aliases.join('、')}` : ''
                        ].filter(Boolean).join(' / ') || '已建立預設辨識資料'}
                      </p>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
        
        <div className="flex flex-wrap gap-2 mb-6">
          {Object.keys(settings?.priceMap || DEFAULT_PRICE_MAP).map(p => parseInt(p)).sort((a, b) => a - b).map(p => (
            <button
              key={p}
              onClick={() => setPrice(p)}
              className={cn(
                "px-4 py-3 rounded-xl text-sm font-bold transition-all min-w-[80px]",
                price === p ? "bg-ink text-white shadow-md" : "bg-background text-ink"
              )}
            >
              ¥{p}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between bg-background p-4 rounded-2xl mb-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-ink/60">訂單總計</p>
            <p className="text-xs text-ink/40">共 {orderItems.reduce((sum, item) => sum + item.quantity, 0)} 項商品</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink/50 font-bold">單價基準</p>
            <p className="text-xl font-bold text-ink">
              NT${settings?.priceMap?.[price] || DEFAULT_PRICE_MAP[price] || 0}
            </p>
            <p className="text-[10px] text-ink/30">總計: NT${
              orderItems.reduce((sum, item) => sum + ((settings?.priceMap?.[price] || DEFAULT_PRICE_MAP[price] || 0) + (item.isEco ? 10 : 0)) * item.quantity, 0)
            }</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button 
            onClick={() => submitOrder('same_cust')}
            className="p-4 bg-orange-500 text-white rounded-2xl text-center transition-all active:scale-95 shadow-lg shadow-orange-500/20"
          >
            <p className="font-bold text-sm">同客續加</p>
            <p className="text-[10px] opacity-80">(清商品/留顧客)</p>
          </button>
          <button 
            onClick={() => submitOrder('same_item')}
            className="p-4 bg-stone-500 text-white rounded-2xl text-center transition-all active:scale-95 shadow-lg shadow-stone-500/20"
          >
            <p className="font-bold text-sm">同品換客</p>
            <p className="text-[10px] opacity-80">(留商品/清顧客)</p>
          </button>
          <button 
            onClick={() => submitOrder('same_both')}
            className="p-4 bg-green-500 text-white rounded-2xl text-center transition-all active:scale-95 shadow-lg shadow-green-500/20"
          >
            <p className="font-bold text-sm">同品同客</p>
            <p className="text-[10px] opacity-80">(全留/方便換款)</p>
          </button>
          <button 
            onClick={() => submitOrder('new')}
            className="p-4 bg-blue-500 text-white rounded-2xl text-center transition-all active:scale-95 shadow-lg shadow-blue-500/20"
          >
            <p className="font-bold text-sm">全新加單</p>
            <p className="text-[10px] opacity-80">(清空全部/留在首頁)</p>
          </button>
        </div>
      </div>
      <AnimatePresence>
        {isFullscreenImage && uploadedImage && (
          <div 
            className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 cursor-pointer"
            onClick={() => setIsFullscreenImage(false)}
          >
            <motion.img 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              src={uploadedImage || undefined} 
              alt="Fullscreen" 
              className="max-w-full max-h-full object-contain rounded-lg"
              referrerPolicy="no-referrer"
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const OrdersList = ({ 
  orders, 
  machines,
  setConfirmModal,
  showToast,
  setEditingMachine
}: { 
  orders: Order[], 
  machines: any[],
  setConfirmModal: (m: any) => void,
  showToast: (m: string, t?: 'success' | 'error') => void,
  setEditingMachine: (m: any) => void
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [dateFilter, setDateFilter] = useState('');
  const [dateFilterType, setDateFilterType] = useState<TimelineFilterType>('createdAt');
  const [editingItem, setEditingItem] = useState<{ orderId: string, item: OrderItem } | null>(null);

  const handleUpdateItem = async (orderId: string, updatedItem: OrderItem) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      const oldItem = order.items.find(i => i.id === updatedItem.id);
      const qtyDiff = updatedItem.quantity - (oldItem?.quantity || 0);

      // 設定 updatedAt
      updatedItem.updatedAt = new Date().toISOString();

      const newItems = order.items.map(i => i.id === updatedItem.id ? updatedItem : i);
      const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);

      const batch = writeBatch(db);
      batch.update(dbDoc('orders', orderId), {
        items: newItems,
        totalAmount: newTotal,
        updatedAt: new Date().toISOString()
      });
      
      const diff = newTotal - order.totalAmount;
      if (diff !== 0 || qtyDiff !== 0) {
        batch.update(dbDoc('customers', order.customerId), {
          totalSpent: increment(diff),
          totalItems: increment(qtyDiff)
        });
      }

      setEditingItem(null);
      showToast('儲存成功');
      await batch.commit();
    } catch (err: any) {
      if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
        showToast('儲存失敗：資料庫免費額度已滿', 'error');
      } else {
        showToast('儲存失敗', 'error');
      }
      setEditingItem(null);
      handleLocalDataError(err, OperationType.WRITE, `orders/${orderId}`);
    }
  };

  const handleToggleCheck = async (orderId: string, item: OrderItem) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      const newItems = order.items.map(i => 
        i.id === item.id ? { ...i, isChecked: !i.isChecked } : i
      );

      await updateDoc(dbDoc('orders', orderId), {
        items: newItems,
        // no update to order updatedAt due to simple checkbox toggle, or optionally add later
      });
    } catch (err) {
      handleLocalDataError(err, OperationType.WRITE, `orders/${orderId}`);
    }
  };

  // Flatten and mix in order metadata
  const flattenedItems = orders.flatMap(order => 
    order.items.map(item => ({
      ...item,
      orderId: order.id,
      customerName: order.customerName,
      customerId: order.customerId,
      orderCreatedAt: order.createdAt,
      orderUpdatedAt: order.updatedAt,
      orderTime: getItemTimelineValue(item, order, dateFilterType)
    }))
  );

  const filteredItems = flattenedItems.filter(item => {
    const lowerSearch = searchTerm.toLowerCase();
    const requiresOperationTime = ['releaseAt', 'transferAt', 'exchangeAt'].includes(dateFilterType);
    if (requiresOperationTime && !item.orderTime) return false;
    const itemDate = item.orderTime ? format(toZonedTime(new Date(item.orderTime), TAIWAN_TZ), 'yyyy-MM-dd') : '';
    
    return (item.customerName.toLowerCase().includes(lowerSearch) ||
           item.machineName.toLowerCase().includes(lowerSearch) ||
           (item.variant && item.variant.toLowerCase().includes(lowerSearch))) &&
           (!dateFilter || itemDate === dateFilter);
  });

  // Sort by orderTime based on sortOrder
  const sortedItems = filteredItems.sort((a, b) => {
    const timeA = a.orderTime ? new Date(a.orderTime).getTime() : 0;
    const timeB = b.orderTime ? new Date(b.orderTime).getTime() : 0;
    return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
  });

  return (
    <div className="space-y-4">
      <div className="bg-card-white p-4 rounded-2xl card-shadow flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink/30" />
          <input 
            type="text" 
            placeholder="搜尋顧客、商品名稱或款式..." 
            className="w-full pl-12 pr-4 py-3 bg-background rounded-xl border-none focus:ring-2 focus:ring-primary-blue transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex flex-row flex-wrap gap-4">
          <select
            value={dateFilterType}
            onChange={(e) => setDateFilterType(e.target.value as TimelineFilterType)}
            className="px-4 py-3 bg-background rounded-xl border-none text-ink cursor-pointer outline-none focus:ring-2 focus:ring-primary-blue"
          >
            <option value="createdAt">依訂單建立時間</option>
            <option value="callTime">依喊單時間</option>
            <option value="updatedAt">依編輯時間</option>
            <option value="releaseAt">依釋出時間</option>
            <option value="transferAt">依轉讓時間</option>
            <option value="exchangeAt">依交換時間</option>
          </select>
          <input 
            type="date" 
            className="px-4 py-3 bg-background rounded-xl border-none text-ink cursor-pointer outline-none focus:ring-2 focus:ring-primary-blue"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
          <button
            onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-background rounded-xl text-ink font-medium whitespace-nowrap hover:bg-ink/5 transition-colors"
          >
            <ArrowRightLeft className="w-4 h-4 rotate-90" />
            {sortOrder === 'desc' ? '由新到舊' : '由舊到新'}
          </button>
        </div>
      </div>
      
      {sortedItems.length === 0 ? (
        <div className="bg-card-white p-12 rounded-3xl card-shadow text-center">
          <div className="w-16 h-16 bg-background rounded-full flex items-center justify-center mx-auto mb-4">
            <Package className="w-8 h-8 text-ink/20" />
          </div>
          <p className="text-ink/40 font-bold">尚未有資料</p>
          {(searchTerm || dateFilter) && <p className="text-xs text-ink/20 mt-1">請嘗試清除篩選條件</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {sortedItems.map((item, idx) => {
            const machine = machines.find(m => m.name === item.machineName);
            const isChecked = !!item.isChecked;
            return (
              <motion.div 
                layout
                key={`${item.orderId}-${item.id}`} 
                className={cn(
                  "bg-card-white p-4 rounded-2xl border-l-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all duration-300",
                  isChecked ? "border-green-400 opacity-60 bg-green-50/10" : "border-primary-blue hover:bg-slate-50 card-shadow"
                )}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: isChecked ? 0.6 : 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(idx * 0.05, 0.5) }}
              >
                <div className="flex items-start sm:items-center gap-4 flex-1">
                  <button
                    onClick={() => handleToggleCheck(item.orderId, item)}
                    className={cn(
                      "w-8 h-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors shadow-sm",
                      isChecked ? "bg-green-400 border-green-400 text-white" : "border-ink/20 text-transparent hover:border-green-400 hover:text-green-400/30"
                    )}
                  >
                    <CheckCircle2 className="w-5 h-5" />
                  </button>
                  <div 
                    className="w-12 h-12 bg-background rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 cursor-pointer shadow-sm relative group"
                    onClick={() => {
                      if (machine) {
                        setEditingMachine(machine);
                      } else {
                        setEditingMachine({
                          id: '',
                          name: item.machineName,
                          defaultPrice: 0,
                          variants: [],
                          imageUrl: null
                        });
                      }
                    }}
                  >
                    {machine?.imageUrl ? (
                      <img src={machine.imageUrl || undefined} alt={item.machineName} className="w-full h-full object-cover relative z-10 transition-transform group-hover:scale-110" referrerPolicy="no-referrer" />
                    ) : (
                      <Package className="w-5 h-5 text-ink/20 relative z-10" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <div className={cn(
                      "text-[15px] font-bold leading-snug flex flex-wrap items-center gap-2",
                      isChecked ? "text-ink/60 line-through" : "text-ink"
                    )}>
                      {item.machineName}
                      {item.variant && (
                        <span className="px-2 py-0.5 bg-primary-blue/10 text-primary-blue rounded-md text-xs whitespace-nowrap no-underline">
                          {item.variant}
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] text-ink/60 mt-1 flex items-center gap-1">
                      <UserIcon className="w-3.5 h-3.5" />
                      {item.customerName}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto mt-2 sm:mt-0 pt-3 sm:pt-0 border-t border-ink/5 sm:border-0 pl-12 sm:pl-0">
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] uppercase font-bold text-ink/30 tracking-wider mb-0.5">數量</span>
                    <span className={cn(
                      "font-bold text-lg px-3 py-0.5 rounded-lg",
                      isChecked ? "bg-transparent text-ink/50" : "bg-background text-ink"
                    )}>
                      {item.quantity}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-ink/40 tracking-tight">建立：{formatDateTime(item.orderCreatedAt)}</span>
                    <span className="text-xs text-ink/40 tracking-tight">喊單：{formatDateTime(item.callTime || item.createdAt)}</span>
                    {item.releaseAt && <span className="text-[10px] text-orange-500 tracking-tight">釋出：{formatDateTime(item.releaseAt)}</span>}
                    {item.transferAt && <span className="text-[10px] text-primary-blue tracking-tight">轉讓：{formatDateTime(item.transferAt)}</span>}
                    {item.exchangeAt && <span className="text-[10px] text-green-600 tracking-tight">交換：{formatDateTime(item.exchangeAt)}</span>}
                    <button 
                      onClick={() => setEditingItem({ orderId: item.orderId, item })}
                      className="p-1.5 text-primary-blue hover:text-white hover:bg-primary-blue rounded-lg transition-all"
                      disabled={isChecked}
                    >
                      <Save className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Edit Modal */}
      <AnimatePresence>
        {editingItem && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              className="bg-card-white w-full max-w-md p-6 rounded-t-3xl sm:rounded-3xl shadow-2xl"
            >
              <h3 className="text-lg font-bold text-ink mb-4">編輯項目</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-ink/40 block mb-1">款式</label>
                  {machines.find(m => m.name === editingItem.item.machineName) ? (
                    <select 
                      className="w-full p-4 bg-background rounded-2xl border-none"
                      value={editingItem.item.variant || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, variant: e.target.value } })}
                    >
                      <option value="">選擇款式</option>
                      {(machines.find(m => m.name === editingItem.item.machineName)?.variants || []).map((v: string) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  ) : (
                    <input 
                      className="w-full p-4 bg-background rounded-2xl border-none"
                      value={editingItem.item.variant || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, variant: e.target.value } })}
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-ink/40 block mb-1">單價</label>
                    <input 
                      type="number" className="w-full p-4 bg-background rounded-2xl border-none"
                      value={isNaN(editingItem.item.price) ? '' : editingItem.item.price}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        const newPrice = isNaN(val) ? 0 : val;
                        setEditingItem({ ...editingItem, item: { ...editingItem.item, price: newPrice, subtotal: newPrice * editingItem.item.quantity } })
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-ink/40 block mb-1">數量</label>
                    <input 
                      type="number" className="w-full p-4 bg-background rounded-2xl border-none"
                      value={isNaN(editingItem.item.quantity) ? '' : editingItem.item.quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        const newQty = isNaN(val) ? 0 : val;
                        setEditingItem({ ...editingItem, item: { ...editingItem.item, quantity: newQty, subtotal: editingItem.item.price * newQty } })
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-ink/40 block mb-1">喊單時間</label>
                  <input
                    type="datetime-local"
                    className="w-full p-4 bg-background rounded-2xl border-none"
                    value={toDateTimeInputValue(editingItem.item.callTime || editingItem.item.createdAt)}
                    onChange={(e) => setEditingItem({
                      ...editingItem,
                      item: {
                        ...editingItem.item,
                        callTime: fromDateTimeInputValue(e.target.value, editingItem.item.createdAt || new Date().toISOString())
                      }
                    })}
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <button onClick={() => setEditingItem(null)} className="flex-1 py-4 bg-background text-ink rounded-2xl font-bold">取消</button>
                  <button 
                    onClick={() => {
                      setConfirmModal({
                        show: true,
                        title: '刪除項目',
                        message: `確定要從這個顧客的清單中刪除 ${editingItem.item.machineName} 嗎？`,
                        type: 'danger',
                        onConfirm: async () => {
                          setEditingItem(null);
                          const order = orders.find(o => o.id === editingItem.orderId);
                          if (!order) return;
                          const newItems = order.items.filter(i => i.id !== editingItem.item.id);
                          const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);
                          
                          try {
                            const undoSnapshot = await createRestoreSnapshot();
                            const batch = writeBatch(db);
                            if (newItems.length === 0) {
                              batch.delete(dbDoc('orders', order.id));
                            } else {
                              batch.update(dbDoc('orders', order.id), {
                                items: newItems,
                                totalAmount: newTotal,
                                updatedAt: new Date().toISOString()
                              });
                            }
                            
                            // Update customer stats
                            batch.update(dbDoc('customers', order.customerId), {
                              totalSpent: increment(-editingItem.item.subtotal),
                              totalItems: increment(-editingItem.item.quantity)
                            });
                            
                            await batch.commit();
                            await addOperationLog('order_item_delete', 'order', `已刪除項目：${editingItem.item.machineName}`, order.customerName, {
                              undoSnapshot,
                              orderId: order.id,
                              machineName: editingItem.item.machineName,
                              variant: editingItem.item.variant,
                              quantity: editingItem.item.quantity,
                              amount: editingItem.item.subtotal
                            });

                            showToast('項目已刪除');
                          } catch (err: any) {
                            if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
                              showToast('刪除失敗：資料庫免費額度已滿', 'error');
                            } else {
                              showToast('刪除失敗', 'error');
                            }
                            handleLocalDataError(err, OperationType.WRITE, `orders/${order.id}`);
                          }
                        }
                      });
                    }}
                    className="p-4 bg-red-50 text-red-500 rounded-2xl"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <button onClick={() => handleUpdateItem(editingItem.orderId, editingItem.item)} className="flex-[2] py-4 bg-primary-blue text-white rounded-2xl font-bold">儲存</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const CustomersList = ({ 
  customers,
  setConfirmModal,
  showToast,
  onSelectCustomer,
  onCopyNotification,
  orders
}: { 
  customers: Customer[],
  setConfirmModal: (m: any) => void,
  showToast: (m: string, t?: 'success' | 'error') => void,
  onSelectCustomer: (c: Customer) => void,
  onCopyNotification: (c: Customer) => void,
  orders: Order[]
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'spent' | 'lastOrder'>('lastOrder');
  const [showSimilarModal, setShowSimilarModal] = useState(false);
  const [similarPairs, setSimilarPairs] = useState<[Customer, Customer][]>([]);

  const isSimilarName = (name1: string, name2: string) => {
    const n1 = name1.toLowerCase().replace(/\s+/g, ' ');
    const n2 = name2.toLowerCase().replace(/\s+/g, ' ');
    if (n1 === n2) return true;
    if (n1.length >= 2 && n2.length >= 2) {
      if (n1.includes(n2) || n2.includes(n1)) return true;
      let matches = 0;
      for (const char of n1) {
        if (n2.includes(char)) matches++;
      }
      if (matches >= 2 && matches / Math.max(n1.length, n2.length) > 0.6) return true;
    }
    return false;
  };

  const handleCheckSimilar = () => {
    const pairs: [Customer, Customer][] = [];
    for (let i = 0; i < customers.length; i++) {
      for (let j = i + 1; j < customers.length; j++) {
        const leftNames = [customers[i].name, ...(customers[i].aliases || [])];
        const rightNames = [customers[j].name, ...(customers[j].aliases || [])];
        if (leftNames.some(left => rightNames.some(right => isSimilarName(left, right)))) {
          pairs.push([customers[i], customers[j]]);
        }
      }
    }
    setSimilarPairs(pairs);
    setShowSimilarModal(true);
  };

  const handleSyncAllStats = async () => {
    try {
      const batch = writeBatch(db);
      customers.forEach(customer => {
        const custOrders = orders.filter(o => o.customerId === customer.id);
        const actualTotalSpent = custOrders.reduce((sum, o) => sum + o.totalAmount, 0);
        const actualTotalItems = custOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
        
        let lastOrderAt = customer.lastOrderAt;
        if (custOrders.length > 0) {
          const sortedOrders = [...custOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          lastOrderAt = sortedOrders[0].createdAt;
        }

        batch.update(dbDoc('customers', customer.id), {
          totalSpent: actualTotalSpent,
          totalItems: actualTotalItems,
          lastOrderAt
        });
      });
      showToast('所有顧客數據已同步');
      await batch.commit();
    } catch (err) {
      handleLocalDataError(err, OperationType.WRITE, 'customers_sync');
    }
  };

  const sortedCustomers = [...customers]
    .filter(c => [c.name, ...(c.aliases || [])].some(name => name.toLowerCase().includes(searchTerm.toLowerCase())))
    .sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, 'zh-Hant');
      }
      if (sortBy === 'lastOrder') {
        const dateA = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0;
        const dateB = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0;
        return dateB - dateA; // descending
      }
      return b.totalSpent - a.totalSpent;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink/30" />
          <input 
            type="text" 
            placeholder="輸入顧客名稱..." 
            className="w-full pl-12 pr-4 py-4 bg-card-white rounded-2xl border-none card-shadow"
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleCheckSimilar}
            className="p-4 bg-card-white text-orange-500 rounded-2xl card-shadow flex-shrink-0 hover:bg-orange-50 transition-colors"
            title="檢查高度相似名稱"
          >
            <Users className="w-5 h-5" />
          </button>
          <button 
            onClick={handleSyncAllStats}
            className="px-4 py-3 bg-card-white text-primary-blue rounded-2xl card-shadow flex-shrink-0 hover:bg-primary-blue/5 transition-colors flex items-center gap-2"
            title="同步所有顧客數據"
          >
            <RefreshCw className="w-5 h-5" />
            <span className="hidden sm:inline text-xs font-bold">同步顆數</span>
          </button>
          <div className="flex bg-card-white p-1 rounded-2xl card-shadow overflow-x-auto scroolbar-hide">
            <button 
              onClick={() => setSortBy('lastOrder')}
              className={cn(
                "px-3 sm:px-4 py-2 flex-shrink-0 rounded-xl text-xs font-bold transition-all whitespace-nowrap",
                sortBy === 'lastOrder' ? "bg-ink text-white" : "text-ink/40"
              )}
            >
              日期排序
            </button>
            <button 
              onClick={() => setSortBy('spent')}
              className={cn(
                "px-3 sm:px-4 py-2 flex-shrink-0 rounded-xl text-xs font-bold transition-all whitespace-nowrap",
                sortBy === 'spent' ? "bg-ink text-white" : "text-ink/40"
              )}
            >
              金額排序
            </button>
            <button 
              onClick={() => setSortBy('name')}
              className={cn(
                "px-3 sm:px-4 py-2 flex-shrink-0 rounded-xl text-xs font-bold transition-all whitespace-nowrap",
                sortBy === 'name' ? "bg-ink text-white" : "text-ink/40"
              )}
            >
              名稱排序
            </button>
          </div>
        </div>
      </div>

      {sortedCustomers.length === 0 ? (
        <div className="bg-card-white p-12 rounded-3xl card-shadow text-center">
          <div className="w-16 h-16 bg-background rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-ink/20" />
          </div>
          <p className="text-ink/40 font-bold">尚未有顧客資料</p>
          {searchTerm && <p className="text-xs text-ink/20 mt-1">請嘗試其他搜尋關鍵字</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {sortedCustomers.map(customer => (
            <div 
              key={customer.id} 
              onClick={() => onSelectCustomer(customer)}
              className="bg-card-white p-6 rounded-3xl card-shadow flex items-center justify-between group cursor-pointer hover:bg-background transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary-blue/10 rounded-2xl flex items-center justify-center text-primary-blue font-bold text-xl">
                  {customer.name[0]}
                </div>
                <div>
                  <h4 className="font-bold text-ink">{customer.name}</h4>
                  <p className="text-xs text-ink/40">共 {customer.totalItems || 0} 顆</p>
                  {(customer.aliases || []).length > 0 && (
                    <p className="mt-1 max-w-[180px] truncate text-[10px] font-medium text-primary-blue/70">
                      別名：{(customer.aliases || []).join('、')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="font-bold text-ink">NT${customer.totalSpent}</p>
                  <p className="text-[10px] text-ink/30">最後消費: {customer.lastOrderAt ? format(toZonedTime(new Date(customer.lastOrderAt), TAIWAN_TZ), 'MM/dd') : '無'}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopyNotification(customer);
                    }}
                    className="p-2 text-primary-blue hover:bg-primary-blue/10 rounded-xl transition-colors"
                    title="複製通知"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmModal({
                        show: true,
                        title: '刪除顧客',
                        message: `確定要刪除顧客 ${customer.name} 嗎？`,
                        checkboxLabel: '同時刪除該顧客的所有訂單',
                        type: 'danger',
                        onConfirm: async (checked?: boolean) => {
                          try {
                            const undoSnapshot = await createRestoreSnapshot();
                            const batch = writeBatch(db);
                            batch.delete(dbDoc('customers', customer.id));
                            
                            if (checked) {
                              const customerOrders = orders.filter(o => o.customerId === customer.id);
                              customerOrders.forEach(order => {
                                batch.delete(dbDoc('orders', order.id));
                              });
                            }
                            
                            await batch.commit();
                            await addOperationLog('customer_delete', 'customer', `已刪除顧客：${customer.name}`, customer.name, {
                              undoSnapshot,
                              deleteRelatedOrders: Boolean(checked)
                            });
                            showToast('顧客已刪除');
                          } catch (err) {
                            handleLocalDataError(err, OperationType.DELETE, `customers/${customer.id}`);
                          }
                        }
                      });
                    }}
                    className="p-2 text-ink/20 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                    title="刪除顧客"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Similar Names Modal */}
      <AnimatePresence>
        {showSimilarModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/20 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card-white rounded-3xl p-6 w-full max-w-lg card-shadow max-h-[80vh] flex flex-col"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-ink">高度相似顧客名稱</h3>
                <button onClick={() => setShowSimilarModal(false)} className="p-2 bg-background rounded-full hover:bg-ink/5">
                  <X className="w-5 h-5 text-ink/60" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                {similarPairs.length > 0 ? (
                  similarPairs.map((pair, idx) => (
                    <div key={idx} className="p-4 bg-background rounded-2xl flex flex-col gap-3">
                      <p className="text-sm font-bold text-ink/80 border-b border-divider pb-2">發現疑似重複顧客</p>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-ink">{pair[0].name}</span>
                          <span className="text-xs text-ink/40">NT${pair[0].totalSpent}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-ink">{pair[1].name}</span>
                          <span className="text-xs text-ink/40">NT${pair[1].totalSpent}</span>
                        </div>
                      </div>
                      <p className="text-xs text-ink/40 mt-2">請確認是否為同一人。如需合併，請點擊顧客卡片上的「編輯」按鈕修改名稱。</p>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <UserIcon className="w-12 h-12 text-ink/10 mx-auto mb-3" />
                    <p className="text-ink/60 font-bold">目前沒有發現高度相似的顧客名稱</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const MachineEditModal = ({
  machine,
  onClose,
  onSave,
  onDelete,
  orders,
  customers,
  settings,
  showToast,
  setConfirmModal
}: {
  machine: any;
  onClose: () => void;
  onSave: (data: any, oldName: string, variantMapping: Record<string, string>, syncWithOrders: boolean) => Promise<void>;
  onDelete: (machineId: string, machineName: string) => void;
  orders: Order[];
  customers: Customer[];
  settings: SystemSettings | null;
  showToast: (m: string, t?: 'success' | 'error') => void;
  setConfirmModal: (m: any) => void;
}) => {
  const [name, setName] = useState(machine.name);
  const [price, setPrice] = useState(machine.defaultPrice.toString());
  const [variantList, setVariantList] = useState<string[]>(machine.variants || []);
  const [variantDetails, setVariantDetails] = useState<Record<string, MachineVariantDetail>>(
    normalizeVariantDetails(machine.variants || [], machine.variantDetails)
  );
  const [newVariant, setNewVariant] = useState('');
  const [editingVariantIndex, setEditingVariantIndex] = useState<number | null>(null);
  const [editingVariantValue, setEditingVariantValue] = useState('');
  const [variantMapping, setVariantMapping] = useState<Record<string, string>>({});
  const [uploadedImage, setUploadedImage] = useState<string | null>(machine.imageUrl || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingItem, setEditingItem] = useState<{ orderId: string, item: OrderItem } | null>(null);

  const handleUpdateItem = async (orderId: string, updatedItem: OrderItem) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      const oldItem = order.items.find(i => i.id === updatedItem.id);
      const qtyDiff = updatedItem.quantity - (oldItem?.quantity || 0);

      updatedItem.updatedAt = new Date().toISOString();
      const newItems = order.items.map(i => i.id === updatedItem.id ? updatedItem : i);
      const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);

      const batch = writeBatch(db);
      batch.update(dbDoc('orders', orderId), {
        items: newItems,
        totalAmount: newTotal,
        updatedAt: new Date().toISOString()
      });
      
      const diff = newTotal - order.totalAmount;
      if (diff !== 0 || qtyDiff !== 0) {
        batch.update(dbDoc('customers', order.customerId), {
          totalSpent: increment(diff),
          totalItems: increment(qtyDiff)
        });
      }

      setEditingItem(null);
      showToast('儲存成功');
      await batch.commit();
    } catch (err: any) {
      if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
        showToast('儲存失敗：資料庫免費額度已滿', 'error');
      } else {
        showToast('儲存失敗', 'error');
      }
      setEditingItem(null);
      handleLocalDataError(err, OperationType.WRITE, `orders/${orderId}`);
    }
  };

  const machineOrders = orders
    .filter(o => o.items.some(i => i.machineName === machine.name))
    .map(o => ({
      ...o,
      items: o.items.filter(i => i.machineName === machine.name)
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.src = reader.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
          }
          setUploadedImage(canvas.toDataURL('image/jpeg', 0.7));
        };
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onloadend = () => {
            const img = new Image();
            img.src = reader.result as string;
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX_WIDTH = 800;
              const MAX_HEIGHT = 800;
              let width = img.width;
              let height = img.height;

              if (width > height) {
                if (width > MAX_WIDTH) {
                  height *= MAX_WIDTH / width;
                  width = MAX_WIDTH;
                }
              } else {
                if (height > MAX_HEIGHT) {
                  width *= MAX_HEIGHT / height;
                  height = MAX_HEIGHT;
                }
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
              }
              setUploadedImage(canvas.toDataURL('image/jpeg', 0.7));
            };
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    }
  };

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const addVariant = () => {
    if (newVariant.trim() && !variantList.includes(newVariant.trim())) {
      const variantName = newVariant.trim();
      setVariantList([...variantList, variantName]);
      setVariantDetails(prev => ({
        ...prev,
        [variantName]: prev[variantName] || { name: variantName, aliases: [], active: true }
      }));
      setNewVariant('');
    }
  };

  const removeVariant = (v: string) => {
    setVariantList(variantList.filter(item => item !== v));
    setVariantDetails(prev => {
      const next = { ...prev };
      delete next[v];
      return next;
    });
  };

  const startEditingVariant = (index: number, value: string) => {
    setEditingVariantIndex(index);
    setEditingVariantValue(value);
  };

  const saveEditedVariant = () => {
    if (editingVariantIndex !== null && editingVariantValue.trim()) {
      const oldVal = variantList[editingVariantIndex];
      const newVal = editingVariantValue.trim();
      
      if (oldVal !== newVal) {
        const newList = [...variantList];
        newList[editingVariantIndex] = newVal;
        setVariantList(newList);
        setVariantDetails(prev => {
          const next = { ...prev };
          const previousDetail = next[oldVal] || { name: oldVal, aliases: [], active: true };
          delete next[oldVal];
          next[newVal] = { ...previousDetail, name: newVal };
          return next;
        });
        
        const originalName = Object.keys(variantMapping).find(key => variantMapping[key] === oldVal) || oldVal;
        setVariantMapping(prev => ({ ...prev, [originalName]: newVal }));
      }
      
      setEditingVariantIndex(null);
      setEditingVariantValue('');
    }
  };

  const [syncWithOrders, setSyncWithOrders] = useState(true);

  const handleSave = async () => {
    if (!name || !price) {
      showToast('請填寫名稱與金額', 'error');
      return;
    }
    await onSave({
      id: machine.id,
      name,
      defaultPrice: parseInt(price),
      variants: variantList,
      variantDetails: normalizeVariantDetails(variantList, variantDetails),
      imageUrl: uploadedImage
    }, machine.name, variantMapping, syncWithOrders);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-background w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-divider flex justify-between items-center bg-card-white rounded-t-3xl">
          <h3 className="text-xl font-bold text-ink">編輯機台: {machine.name}</h3>
          <button onClick={onClose} className="p-2 hover:bg-background rounded-full transition-colors">
            <X className="w-6 h-6 text-ink/40" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-ink/40 block mb-2 uppercase tracking-widest">機台名稱</label>
              <input 
                type="text" 
                className="w-full px-4 py-3 bg-card-white rounded-2xl border border-divider"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-ink/40 block mb-2 uppercase tracking-widest">預設日幣金額</label>
              <input 
                type="number" 
                className="w-full px-4 py-3 bg-card-white rounded-2xl border border-divider"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold text-ink/40 uppercase tracking-widest">機台圖片</label>
              <div>
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 bg-primary-blue/10 text-primary-blue rounded-xl text-xs font-bold flex items-center gap-1 hover:bg-primary-blue/20 transition-colors"
                >
                  <Upload className="w-3 h-3" />
                  上傳圖片
                </button>
              </div>
            </div>
            {uploadedImage ? (
              <div className="relative group">
                <div className="w-full h-48 rounded-2xl overflow-hidden bg-card-white border border-divider">
                  <img src={uploadedImage || undefined} alt="Machine" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                </div>
                <button 
                  onClick={() => setUploadedImage(null)}
                  className="absolute top-2 right-2 p-2 bg-white/80 hover:bg-white rounded-full shadow-sm text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-32 rounded-2xl border-2 border-dashed border-divider flex flex-col items-center justify-center text-ink/30 cursor-pointer hover:bg-card-white hover:border-primary-blue/30 transition-colors"
              >
                <Package className="w-8 h-8 mb-2 opacity-50" />
                <span className="text-sm font-bold">點擊上傳或貼上圖片</span>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-ink/40 block mb-2 uppercase tracking-widest">款式管理</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {variantList.map((v, index) => (
                <div key={index} className="relative group">
                  {editingVariantIndex === index ? (
                    <input
                      autoFocus
                      type="text"
                      className="px-3 py-1.5 bg-card-white border border-primary-blue rounded-xl text-sm font-bold w-32 outline-none"
                      value={editingVariantValue}
                      onChange={(e) => setEditingVariantValue(e.target.value)}
                      onBlur={saveEditedVariant}
                      onKeyDown={(e) => e.key === 'Enter' && saveEditedVariant()}
                    />
                  ) : (
                    <span 
                      onClick={() => startEditingVariant(index, v)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-primary-blue/10 text-primary-blue rounded-xl text-sm font-bold cursor-pointer hover:bg-primary-blue/20 transition-colors"
                    >
                      {v}
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          removeVariant(v);
                        }} 
                        className="hover:text-red-500 ml-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                </div>
              ))}
              {variantList.length === 0 && <p className="text-xs text-ink/30 italic">尚未新增款式</p>}
            </div>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="輸入新款式名稱..." 
                className="flex-1 px-4 py-3 bg-card-white rounded-xl border border-divider text-sm"
                value={newVariant}
                onChange={(e) => setNewVariant(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addVariant()}
              />
              <button 
                onClick={addVariant}
                className="px-4 py-3 bg-ink text-white rounded-xl text-sm font-bold"
              >
                新增
              </button>
            </div>
          </div>

          {variantList.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-bold text-ink/40 uppercase tracking-widest">款式辨識資料</label>
                <span className="text-xs text-ink/40">提供 AI 比對既有款式，避免重複翻譯</span>
              </div>
              <div className="space-y-3">
                {variantList.map(variant => {
                  const detail = variantDetails[variant] || { name: variant, aliases: [], active: true };
                  return (
                    <div key={variant} className="p-4 bg-card-white border border-divider rounded-2xl space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-bold text-ink text-sm">{variant}</div>
                        <label className="flex items-center gap-2 text-xs font-bold text-ink/50">
                          <input
                            type="checkbox"
                            checked={detail.active !== false}
                            onChange={(e) => setVariantDetails(prev => ({
                              ...prev,
                              [variant]: { ...detail, active: e.target.checked }
                            }))}
                          />
                          啟用
                        </label>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <input
                          type="text"
                          placeholder="原文名稱，例如 ベイマックス＆モチ"
                          className="px-3 py-2 bg-background rounded-xl border-none text-sm"
                          value={detail.originalName || ''}
                          onChange={(e) => setVariantDetails(prev => ({
                            ...prev,
                            [variant]: { ...detail, originalName: e.target.value }
                          }))}
                        />
                        <input
                          type="text"
                          placeholder="目視特徵，例如 杯麵抱著三色貓"
                          className="px-3 py-2 bg-background rounded-xl border-none text-sm"
                          value={detail.feature || ''}
                          onChange={(e) => setVariantDetails(prev => ({
                            ...prev,
                            [variant]: { ...detail, feature: e.target.value }
                          }))}
                        />
                        <input
                          type="text"
                          placeholder="別名，用 、 或逗號分隔"
                          className="px-3 py-2 bg-background rounded-xl border-none text-sm"
                          value={(detail.aliases || []).join('、')}
                          onChange={(e) => setVariantDetails(prev => ({
                            ...prev,
                            [variant]: {
                              ...detail,
                              aliases: e.target.value.split(/[、,，]/).map(alias => alias.trim()).filter(Boolean)
                            }
                          }))}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="pt-6 border-t border-divider">
            <h4 className="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4">這台機台的扭蛋紀錄</h4>
            {machineOrders.length === 0 ? (
              <p className="text-center py-8 text-ink/30 font-medium">尚無顧客扭這台機台</p>
            ) : (
              <div className="space-y-3">
                {machineOrders.map(order => 
                  order.items.map(item => (
                    <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-background rounded-2xl hover:bg-ink/5 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary-blue/10 rounded-xl flex items-center justify-center text-primary-blue font-bold">
                          {item.quantity}
                        </div>
                        <div>
                          <div className="font-bold text-ink text-sm">
                            {order.customerName}
                          </div>
                          {item.variant ? (
                            <span className="text-xs text-ink/60 bg-white px-2 py-0.5 rounded-md mt-1 inline-block border border-divider">
                              {item.variant}
                            </span>
                          ) : (
                            <span className="text-xs text-ink/40 italic mt-1 inline-block">未指定款式</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-4 mt-3 sm:mt-0">
                        <div className="text-right">
                          <div className="text-xs text-ink/40">NT$ {item.subtotal}</div>
                          <div className="text-[10px] text-ink/30">{format(toZonedTime(new Date(order.createdAt), TAIWAN_TZ), 'yyyy/MM/dd HH:mm')}</div>
                        </div>
                        <button 
                          onClick={() => setEditingItem({ orderId: order.id, item })}
                          className="p-2 text-primary-blue hover:text-white hover:bg-primary-blue rounded-xl transition-all border border-primary-blue/20 bg-white"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-divider bg-card-white rounded-b-3xl flex justify-between">
          <button 
            onClick={() => onDelete(machine.id, machine.name)}
            className="px-6 py-3 text-red-500 font-bold hover:bg-red-50 rounded-xl transition-colors"
          >
            刪除機台
          </button>
          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="px-6 py-3 text-ink/60 font-bold hover:bg-background rounded-xl transition-colors"
            >
              取消
            </button>
            <button 
              onClick={handleSave}
              className="px-6 py-3 bg-primary-blue text-white rounded-xl font-bold hover:bg-blue-600 transition-colors"
            >
              儲存{syncWithOrders ? '並同步訂單' : ''}
            </button>
          </div>
        </div>

        <div className="px-6 pb-6 flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer group">
            <div className="relative flex items-center justify-center w-5 h-5 rounded border-2 border-ink/20 group-hover:border-primary-blue transition-colors">
              <input 
                type="checkbox" 
                className="absolute opacity-0 w-full h-full cursor-pointer peer"
                checked={syncWithOrders}
                onChange={(e) => setSyncWithOrders(e.target.checked)}
              />
              <CheckCircle2 className="w-3.5 h-3.5 text-primary-blue opacity-0 peer-checked:opacity-100 transition-opacity" />
            </div>
            <span className="text-xs font-bold text-ink/40 group-hover:text-ink/60 transition-colors">同步更新現有訂單資料</span>
          </label>
        </div>
      </div>

      {/* Editing Item Modal */ }
      <AnimatePresence>
        {editingItem && (
          <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card-white w-full max-w-sm p-6 rounded-3xl shadow-2xl"
            >
              <h3 className="text-lg font-bold text-ink mb-4">編輯訂單項目</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-ink/40 block mb-1">款式</label>
                  <SuggestiveInput 
                    value={editingItem.item.variant || ''}
                    onChange={(v) => setEditingItem({ ...editingItem, item: { ...editingItem.item, variant: v } })}
                    placeholder="輸入款式"
                    suggestions={variantList}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-ink/40 block mb-1">數量</label>
                    <input 
                      type="number" className="w-full p-4 bg-background rounded-2xl border-none"
                      value={isNaN(editingItem.item.quantity) ? '' : editingItem.item.quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        const newQty = isNaN(val) ? 1 : Math.max(1, val);
                        setEditingItem({ ...editingItem, item: { ...editingItem.item, quantity: newQty, subtotal: editingItem.item.price * newQty } })
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-ink/40 block mb-1">單價 (NT$)</label>
                    <input 
                      type="number" className="w-full p-4 bg-background rounded-2xl border-none"
                      value={isNaN(editingItem.item.price) ? '' : editingItem.item.price}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        const newPrice = isNaN(val) ? 0 : val;
                        setEditingItem({ ...editingItem, item: { ...editingItem.item, price: newPrice, subtotal: newPrice * editingItem.item.quantity } })
                      }}
                    />
                  </div>
                </div>
                <div className="pt-2 flex gap-2">
                  <button onClick={() => setEditingItem(null)} className="flex-1 py-4 bg-background text-ink rounded-2xl font-bold">取消</button>
                  <button 
                    onClick={() => {
                      setConfirmModal({
                        show: true,
                        title: '刪除項目',
                        message: `確定要刪除這筆訂單項目嗎？`,
                        type: 'danger',
                        onConfirm: async () => {
                          setEditingItem(null);
                          const order = orders.find(o => o.id === editingItem.orderId);
                          if (!order) return;
                          const newItems = order.items.filter(i => i.id !== editingItem.item.id);
                          const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);
                          
                          try {
                            const undoSnapshot = await createRestoreSnapshot();
                            const batch = writeBatch(db);
                            if (newItems.length === 0) {
                              batch.delete(dbDoc('orders', order.id));
                            } else {
                              batch.update(dbDoc('orders', order.id), {
                                items: newItems,
                                totalAmount: newTotal,
                                updatedAt: new Date().toISOString()
                              });
                            }
                            
                            // Update customer stats
                            batch.update(dbDoc('customers', order.customerId), {
                              totalSpent: increment(-editingItem.item.subtotal),
                              totalItems: increment(-editingItem.item.quantity)
                            });
                            
                            await batch.commit();
                            await addOperationLog('order_item_delete', 'order', `已刪除項目：${editingItem.item.machineName}`, order.customerName, {
                              undoSnapshot,
                              orderId: order.id,
                              machineName: editingItem.item.machineName,
                              variant: editingItem.item.variant,
                              quantity: editingItem.item.quantity,
                              amount: editingItem.item.subtotal
                            });

                            showToast('項目已刪除');
                          } catch (err: any) {
                            if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
                              showToast('刪除失敗：資料庫免費額度已滿', 'error');
                            } else {
                              showToast('刪除失敗', 'error');
                            }
                            handleLocalDataError(err, OperationType.WRITE, `orders/${order.id}`);
                          }
                        }
                      });
                    }}
                    className="p-4 bg-red-50 text-red-500 rounded-2xl"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <button onClick={() => handleUpdateItem(editingItem.orderId, editingItem.item)} className="flex-[2] py-4 bg-primary-blue text-white rounded-2xl font-bold">儲存</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const MachineManagement = ({ 
  machines, 
  orders,
  customers,
  settings,
  showToast,
  setConfirmModal,
  setEditingMachine
}: { 
  machines: any[], 
  orders: Order[],
  customers: Customer[],
  settings: SystemSettings | null,
  showToast: (m: string, t?: 'success' | 'error') => void,
  setConfirmModal: (m: any) => void,
  setEditingMachine: (m: any) => void
}) => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [variantList, setVariantList] = useState<string[]>([]);
  const [newVariant, setNewVariant] = useState('');
  const [editingVariantIndex, setEditingVariantIndex] = useState<number | null>(null);
  const [editingVariantValue, setEditingVariantValue] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid-sm' | 'grid-lg'>('list');
  const [machineSearchTerm, setMachineSearchTerm] = useState('');

  // Derive all unique machine names from orders
  const machineNamesFromOrders = Array.from(new Set(orders.flatMap(o => o.items.map(i => i.machineName))));
  
  // Combine with existing configured machines
  const allMachineNames = Array.from(new Set([
    ...machineNamesFromOrders,
    ...machines.map(m => m.name)
  ])).sort().filter(name => name.toLowerCase().includes(machineSearchTerm.toLowerCase()));

  const autoInitializeUnsetMachines = async () => {
    const unsetMachines = allMachineNames.filter(name => !machines.find(m => m.name === name));
    if (unsetMachines.length === 0) {
      showToast('沒有未設定的機台', 'success');
      return;
    }

    setConfirmModal({
      show: true,
      title: '一鍵初始化未設定機台',
      message: `將自動為 ${unsetMachines.length} 個未設定的機台建立預設資料（自動抓取訂單中的款式與金額）。確定要執行嗎？`,
      onConfirm: async (checked?: boolean) => {
        if (!checked) {
          showToast('已取消刪除：需要勾選確認才會清空資料', 'error');
          return;
        }
        try {
          const batch = writeBatch(db);
          const now = new Date().toISOString();
          let addedCount = 0;

          unsetMachines.forEach(machineName => {
            // Try to guess JPY price from last order
            let guessedPrice = 0;
            const lastOrderWithMachine = orders.find(o => o.items.some(i => i.machineName === machineName));
            if (lastOrderWithMachine) {
              const item = lastOrderWithMachine.items.find(i => i.machineName === machineName);
              if (item) {
                const ntPrice = item.price;
                const map = settings?.priceMap || DEFAULT_PRICE_MAP;
                const guessedJpy = Object.keys(map).find(k => map[parseInt(k)] === ntPrice) || 
                                  Object.keys(map).find(k => map[parseInt(k)] === ntPrice - 10);
                if (guessedJpy) guessedPrice = parseInt(guessedJpy);
              }
            }

            // Extract variants
            const variantsFromOrders = Array.from(new Set(
              orders.flatMap(o => o.items.filter(i => i.machineName === machineName).map(i => i.variant || ''))
            )).filter(v => v && !v.includes('(環保)'));

            const newDocRef = dbDoc('machines');
            batch.set(newDocRef, {
              name: machineName,
              defaultPrice: guessedPrice,
              variants: variantsFromOrders,
              variantDetails: createDefaultVariantDetails(variantsFromOrders),
              createdAt: now,
              updatedAt: now
            });
            addedCount++;
          });

      showToast(`成功初始化 ${addedCount} 個機台！`);
          await batch.commit();
        } catch (err) {
          handleLocalDataError(err, OperationType.WRITE, 'machines_batch_init');
        }
      }
    });
  };

  const saveNewMachine = async () => {
    if (!name || !price) {
      showToast('請填寫名稱與金額', 'error');
      return;
    }
    const now = new Date().toISOString();
    const data = {
      name,
      defaultPrice: parseInt(price) || 0,
      variants: variantList,
      variantDetails: createDefaultVariantDetails(variantList),
      createdAt: now,
      updatedAt: now
    };

    try {
      const existingMachine = machines.find(m => m.name === name);
      if (existingMachine) {
        showToast('此機台名稱已存在', 'error');
        return;
      }
      const newDocRef = dbDoc('machines');
      showToast('機台新增成功');
      reset();
      await setDoc(newDocRef, data);
    } catch (err: any) {
      console.error(err);
      showToast(err?.message?.includes('Missing or insufficient') ? '資料驗證失敗，請檢查權限或格式！' : '發生錯誤，請稍後再試！', 'error');
    }
  };

  const reset = () => {
    setName('');
    setPrice('');
    setVariantList([]);
    setNewVariant('');
    setEditingVariantIndex(null);
    setEditingVariantValue('');
  };

  const addVariant = () => {
    if (newVariant.trim() && !variantList.includes(newVariant.trim())) {
      setVariantList([...variantList, newVariant.trim()]);
      setNewVariant('');
    }
  };

  const removeVariant = (v: string) => {
    setVariantList(variantList.filter(item => item !== v));
  };

  const startEditingVariant = (index: number, value: string) => {
    setEditingVariantIndex(index);
    setEditingVariantValue(value);
  };

  const saveEditedVariant = () => {
    if (editingVariantIndex !== null && editingVariantValue.trim()) {
      const oldVal = variantList[editingVariantIndex];
      const newVal = editingVariantValue.trim();
      
      if (oldVal !== newVal) {
        const newList = [...variantList];
        newList[editingVariantIndex] = newVal;
        setVariantList(newList);
      }
      
      setEditingVariantIndex(null);
      setEditingVariantValue('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-card-white p-6 rounded-3xl card-shadow">
        <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4">
          新增機台
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <input 
            type="text" 
            placeholder="機台名稱" 
            className="px-4 py-4 bg-background rounded-2xl border-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input 
            type="number" 
            placeholder="預設日幣金額" 
            className="px-4 py-4 bg-background rounded-2xl border-none"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className="text-xs font-bold text-ink/40 block mb-2 uppercase tracking-widest">款式管理</label>
          <div className="flex flex-wrap gap-2 mb-3">
            {variantList.map((v, index) => (
              <div key={index} className="relative group">
                {editingVariantIndex === index ? (
                  <input
                    autoFocus
                    type="text"
                    className="px-3 py-1.5 bg-card-white border border-primary-blue rounded-xl text-sm font-bold w-32 outline-none"
                    value={editingVariantValue}
                    onChange={(e) => setEditingVariantValue(e.target.value)}
                    onBlur={saveEditedVariant}
                    onKeyDown={(e) => e.key === 'Enter' && saveEditedVariant()}
                  />
                ) : (
                  <span 
                    onClick={() => startEditingVariant(index, v)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-primary-blue/10 text-primary-blue rounded-xl text-sm font-bold cursor-pointer hover:bg-primary-blue/20 transition-colors"
                  >
                    {v}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        removeVariant(v);
                      }} 
                      className="hover:text-red-500 ml-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>
            ))}
            {variantList.length === 0 && <p className="text-xs text-ink/30 italic">尚未新增款式</p>}
          </div>
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="輸入新款式名稱..." 
              className="flex-1 px-4 py-3 bg-background rounded-xl border-none text-sm"
              value={newVariant}
              onChange={(e) => setNewVariant(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addVariant()}
            />
            <button 
              onClick={addVariant}
              className="px-4 py-3 bg-ink text-white rounded-xl text-sm font-bold"
            >
              新增
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={saveNewMachine}
            className="flex-1 py-4 bg-primary-blue text-white rounded-2xl font-bold"
          >
            儲存機台
          </button>
          {(name || price || variantList.length > 0) && (
            <button 
              onClick={reset}
              className="px-6 py-4 bg-background text-ink rounded-2xl font-bold"
            >
              重置
            </button>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-ink">機台列表</h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input 
              type="text" 
              placeholder="搜尋機台..." 
              className="pl-10 pr-4 py-2 bg-background rounded-xl border-none text-sm w-48 sm:w-64"
              value={machineSearchTerm}
              onChange={(e) => setMachineSearchTerm(e.target.value)}
            />
            <Search className="w-4 h-4 text-ink/40 absolute left-3 top-1/2 -translate-y-1/2" />
          </div>
          <div className="flex bg-background rounded-xl p-1">
            <button onClick={() => setViewMode('list')} className={cn("p-2 rounded-lg transition-colors", viewMode === 'list' ? "bg-white shadow-sm" : "text-ink/40 hover:text-ink")}>
              <List className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('grid-sm')} className={cn("p-2 rounded-lg transition-colors", viewMode === 'grid-sm' ? "bg-white shadow-sm" : "text-ink/40 hover:text-ink")}>
              <Grid2x2 className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('grid-lg')} className={cn("p-2 rounded-lg transition-colors", viewMode === 'grid-lg' ? "bg-white shadow-sm" : "text-ink/40 hover:text-ink")}>
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
          <button 
            onClick={autoInitializeUnsetMachines}
            className="px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-orange-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">一鍵初始化未設定</span>
          </button>
        </div>
      </div>

      <div className={cn(
        "grid gap-4",
        viewMode === 'list' ? "grid-cols-1 sm:grid-cols-2" : 
        viewMode === 'grid-sm' ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" : 
        "grid-cols-1 sm:grid-cols-2 md:grid-cols-3"
      )}>
        {allMachineNames.map(machineName => {
          const config = machines.find(m => m.name === machineName);
          return (
            <div 
              key={machineName} 
              onClick={() => {
                if (config) {
                  setEditingMachine(config);
                } else {
                  // Try to guess JPY price from last order
                  let guessedPrice = '';
                  const lastOrderWithMachine = orders.find(o => o.items.some(i => i.machineName === machineName));
                  if (lastOrderWithMachine) {
                    const item = lastOrderWithMachine.items.find(i => i.machineName === machineName);
                    if (item) {
                      const ntPrice = item.price;
                      const map = settings?.priceMap || DEFAULT_PRICE_MAP;
                      const guessedJpy = Object.keys(map).find(k => map[parseInt(k)] === ntPrice) || 
                                        Object.keys(map).find(k => map[parseInt(k)] === ntPrice - 10);
                      if (guessedJpy) guessedPrice = guessedJpy;
                    }
                  }

                  // Try to find variants from orders for this machine
                  const variantsFromOrders = Array.from(new Set(
                    orders.flatMap(o => o.items.filter(i => i.machineName === machineName).map(i => i.variant || ''))
                  )).filter(v => v && !v.includes('(環保)'));
                  
                  setEditingMachine({
                    id: '',
                    name: machineName,
                    defaultPrice: guessedPrice ? parseInt(guessedPrice) : 0,
                    variants: variantsFromOrders,
                    variantDetails: createDefaultVariantDetails(variantsFromOrders),
                    imageUrl: null
                  });
                }
              }}
              className={cn(
                "bg-card-white rounded-3xl card-shadow flex cursor-pointer transition-all hover:scale-[1.02] overflow-hidden relative group",
                config ? "border-l-4 border-primary-blue" : "border-l-4 border-dashed border-ink/10",
                viewMode === 'list' ? "p-6 justify-between items-start" : "flex-col"
              )}
            >
              {viewMode !== 'list' && (
                <div className={cn(
                  "w-full bg-background flex items-center justify-center overflow-hidden",
                  viewMode === 'grid-sm' ? "h-24" : "h-48"
                )}>
                  {config?.imageUrl ? (
                    <img src={config.imageUrl || undefined} alt={machineName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <Package className="w-8 h-8 text-ink/10" />
                  )}
                </div>
              )}
              
              <div className={cn("flex-1 flex", viewMode === 'list' ? "gap-4" : "p-4 flex-col gap-2")}>
                {viewMode === 'list' && (
                  <div className="w-12 h-12 bg-background rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0">
                    {config?.imageUrl ? (
                      <img src={config.imageUrl || undefined} alt={machineName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <Package className="w-6 h-6 text-ink/20" />
                    )}
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className={cn("font-bold text-ink truncate", viewMode === 'grid-sm' ? "text-xs" : "text-base")} title={machineName}>{machineName}</h4>
                    {!config && <span className="text-[10px] bg-ink/5 text-ink/40 px-1.5 py-0.5 rounded flex-shrink-0">未設定</span>}
                  </div>
                  {config ? (
                    <>
                      <p className="text-xs text-ink/40 mb-2">預設金額: ¥{config.defaultPrice}</p>
                      {viewMode !== 'grid-sm' && (
                        <div className="flex flex-wrap gap-1">
                          {(config.variants || []).map((v: string) => {
                            const detail = normalizeVariantDetails([v], config.variantDetails)[v];
                            const title = [v, detail.feature, detail.originalName, ...(detail.aliases || [])].filter(Boolean).join(' / ');
                            return (
                              <span key={v} title={title} className="px-2 py-1 bg-background rounded text-[10px] font-bold text-ink/60">
                                {detail.feature ? `${v}：${detail.feature}` : v}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    viewMode !== 'grid-sm' && <p className="text-xs text-ink/30 italic">點擊以設定預設金額與款式</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CustomerDetailView = ({ 
  customer, 
  orders, 
  machines, 
  customers,
  releases,
  settings,
  onClose, 
  showToast,
  onCopyNotification,
  setConfirmModal,
  setEditingMachine
}: { 
  customer: Customer, 
  orders: Order[], 
  machines: any[],
  customers: Customer[],
  releases: any[],
  settings: SystemSettings | null,
  onClose: () => void, 
  showToast: (m: string, t?: 'success' | 'error') => void,
  onCopyNotification: () => void,
  setConfirmModal: (m: any) => void,
  setEditingMachine: (m: any) => void
}) => {
  const customerOrders = orders.filter(o => o.customerId === customer.id);
  const [editingItem, setEditingItem] = useState<{ orderId: string, item: OrderItem } | null>(null);
  const [transferringItem, setTransferringItem] = useState<{ orderId: string, item: OrderItem } | null>(null);
  const [transferQuantity, setTransferQuantity] = useState(1);
  const [targetCustomerName, setTargetCustomerName] = useState('');
  const [exchangingItem, setExchangingItem] = useState<{ orderId: string, item: OrderItem & { rawIds?: string[] } } | null>(null);
  const [exchangeTargetCustomerName, setExchangeTargetCustomerName] = useState('');
  const [selectedExchangeItem, setSelectedExchangeItem] = useState<{ orderId: string, item: OrderItem & { rawIds?: string[] } } | null>(null);
  const [releasingItem, setReleasingItem] = useState<{ orderId: string, item: OrderItem } | null>(null);
  const [releaseQuantity, setReleaseQuantity] = useState(1);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(customer.name);
  const [newAlias, setNewAlias] = useState('');
  const [itemSortBy, setItemSortBy] = useState<'time' | 'machine'>('machine');

  const buildCurrentViewSnapshot = (): RestoreSnapshot => {
    const { id: settingsId, ...settingsPayload } = normalizeSettings('global', settings || {});
    return {
      customers,
      orders,
      machines,
      releases,
      settings: settings ? settingsPayload : null,
      createdAt: new Date().toISOString()
    };
  };

  useEffect(() => {
    setEditedName(customer.name);
  }, [customer.id, customer.name]);

  const saveCustomerAliases = async (nextAliases: string[]) => {
    const aliases = normalizeCustomerAliases(nextAliases)
      .filter(alias => normalizeCustomerNameKey(alias) !== normalizeCustomerNameKey(customer.name));
    const duplicateCustomer = customers.find(other =>
      other.id !== customer.id && aliases.some(alias => customerMatchesName(other, alias))
    );

    if (duplicateCustomer) {
      showToast(`別名已屬於顧客 ${duplicateCustomer.name}`, 'error');
      return;
    }

    try {
      const undoSnapshot = buildCurrentViewSnapshot();
      await updateDoc(dbDoc('customers', customer.id), { aliases });
      await addOperationLog('customer_alias_update', 'customer', `${customer.name} 更新別名`, customer.name, {
        undoSnapshot,
        aliases
      });
      showToast('顧客別名已更新');
    } catch (err) {
      handleLocalDataError(err, OperationType.WRITE, `customers/${customer.id}`);
    }
  };

  const addCustomerAlias = () => {
    const alias = newAlias.trim();
    if (!alias) return;
    if (normalizeCustomerNameKey(alias) === normalizeCustomerNameKey(customer.name)) {
      showToast('別名不能和顧客主名稱相同', 'error');
      return;
    }
    if ((customer.aliases || []).some(existing => normalizeCustomerNameKey(existing) === normalizeCustomerNameKey(alias))) {
      showToast('這個別名已存在', 'error');
      return;
    }
    saveCustomerAliases([...(customer.aliases || []), alias]);
    setNewAlias('');
  };

  const removeCustomerAlias = (alias: string) => {
    saveCustomerAliases((customer.aliases || []).filter(existing => existing !== alias));
  };

  const handleSaveName = async () => {
    const newName = editedName.replace(/\s+/g, '');
    if (!newName) {
      showToast('顧客名稱不能為空', 'error');
      return;
    }
    if (newName === customer.name) {
      setIsEditingName(false);
      return;
    }
    const duplicateCustomer = customers.find(other => other.id !== customer.id && customerMatchesName(other, newName));
    if (duplicateCustomer) {
      showToast(`這個名稱已屬於顧客 ${duplicateCustomer.name}`, 'error');
      return;
    }

    try {
      const undoSnapshot = buildCurrentViewSnapshot();
      const batch = writeBatch(db);
      
      // Update customer doc
      const nextAliases = normalizeCustomerAliases([...(customer.aliases || []), customer.name]).filter(alias => normalizeCustomerNameKey(alias) !== normalizeCustomerNameKey(newName));
      batch.update(dbDoc('customers', customer.id), { name: newName, aliases: nextAliases });
      
      // Update all orders for this customer
      customerOrders.forEach(order => {
        batch.update(dbDoc('orders', order.id), { customerName: newName });
      });

      // Update all releases for this customer
      const customerReleases = releases.filter(r => r.customerName === customer.name);
      customerReleases.forEach(release => {
        batch.update(dbDoc('releases', release.id), { customerName: newName });
      });

      await batch.commit();
      await addOperationLog('customer_rename', 'customer', `${customer.name} 改名為 ${newName}`, newName, {
        undoSnapshot,
        oldName: customer.name,
        newName
      });
      showToast('顧客名稱已更新');
      setIsEditingName(false);
    } catch (err) {
      handleLocalDataError(err, OperationType.WRITE, `customers/${customer.id}`);
    }
  };

  const handleRecalculateStats = async () => {
    try {
      const actualTotalSpent = customerOrders.reduce((sum, o) => sum + o.totalAmount, 0);
      const actualTotalItems = customerOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
      
      await updateDoc(dbDoc('customers', customer.id), {
        totalSpent: actualTotalSpent,
        totalItems: actualTotalItems
      });
      showToast('數據已重新計算並同步');
    } catch (err) {
      handleLocalDataError(err, OperationType.WRITE, `customers/${customer.id}`);
    }
  };

  useEffect(() => {
    // Auto-sync if stats look wrong (e.g. 0 items but has orders)
    if (customer.totalItems === 0 && customerOrders.length > 0) {
      handleRecalculateStats();
    }
  }, [customer.id, customer.totalItems, customerOrders.length]);

  const handleUpdateItem = async (orderId: string, updatedItem: OrderItem & { rawIds?: string[] }) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      const rawIds = updatedItem.rawIds || [updatedItem.id];
      const oldItems = order.items.filter(i => rawIds.includes(i.id));
      const oldQty = oldItems.reduce((sum, i) => sum + i.quantity, 0);
      const qtyDiff = updatedItem.quantity - oldQty;

      // Filter out all old raw items, then push the consolidated new item
      const newItems = order.items.filter(i => !rawIds.includes(i.id));
      const consolidatedItem = { ...updatedItem, updatedAt: new Date().toISOString() };
      delete consolidatedItem.rawIds;
      // We assign it the ID of the first raw item to keep continuity
      consolidatedItem.id = rawIds[0];
      newItems.push(consolidatedItem);
      
      const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);

      const batch = writeBatch(db);
      batch.update(dbDoc('orders', orderId), {
        items: newItems,
        totalAmount: newTotal,
        updatedAt: new Date().toISOString()
      });
      
      const diff = newTotal - order.totalAmount;
      if (diff !== 0 || qtyDiff !== 0) {
        batch.update(dbDoc('customers', customer.id), {
          totalSpent: increment(diff),
          totalItems: increment(qtyDiff)
        });
      }

      setEditingItem(null);
      showToast('儲存成功');
      await batch.commit();
    } catch (err: any) {
      if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
        showToast('儲存失敗：資料庫免費額度已滿', 'error');
      } else {
        showToast('儲存失敗', 'error');
      }
      setEditingItem(null);
      handleLocalDataError(err, OperationType.WRITE, `orders/${orderId}`);
    }
  };

  const handleTransfer = async () => {
    if (!transferringItem || transferQuantity < 1) return;
    const trimmedTarget = targetCustomerName.replace(/\s+/g, '');
    if (!trimmedTarget) {
      showToast('請輸入目標顧客名稱', 'error');
      return;
    }

    const { orderId, item } = transferringItem;
    // @ts-ignore
    const rawIds = item.rawIds || [item.id];

    const targetCust = findCustomerByName(customers, trimmedTarget);
    const targetDisplayName = targetCust?.name || trimmedTarget;

    if (customerMatchesName(customer, trimmedTarget)) {
      showToast('不能轉讓給原顧客自己！', 'error');
      return;
    }

    try {
      const undoSnapshot = buildCurrentViewSnapshot();
      const batch = writeBatch(db);
      const now = new Date().toISOString();

      // 1. Find or create target customer
      let targetId = targetCust?.id;
      let createdTargetCustomerRef: any = null;

      if (!targetCust) {
        const newCustRef = dbDoc('customers');
        createdTargetCustomerRef = newCustRef;
        targetId = newCustRef.id;
      }

      // 2. Remove or update from current order
      const currentOrder = orders.find(o => o.id === orderId);
      if (!currentOrder) {
        showToast('找不到原始訂單！', 'error');
        return;
      }

      const transferSubtotal = item.price * transferQuantity;
      
      const oldItems = currentOrder.items.filter(i => rawIds.includes(i.id));
      const oldQty = oldItems.reduce((sum, i) => sum + i.quantity, 0);
      const oldSubtotal = oldItems.reduce((sum, i) => sum + i.subtotal, 0);

      let newItems = currentOrder.items.filter(i => !rawIds.includes(i.id));
      
      if (transferQuantity < oldQty) {
        const remainingItem = {
          ...oldItems[0],
          id: rawIds[0],
          quantity: oldQty - transferQuantity,
          subtotal: oldSubtotal - transferSubtotal,
          updatedAt: now,
          transferAt: now
        };
        // @ts-ignore
        delete remainingItem.rawIds;
        newItems.push(remainingItem);
      }
      
      const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);

      if (newItems.length === 0) {
        batch.delete(dbDoc('orders', orderId));
      } else {
        batch.update(dbDoc('orders', orderId), {
          items: newItems,
          totalAmount: newTotal,
          updatedAt: now
        });
      }
      
      batch.update(dbDoc('customers', customer.id), {
        totalSpent: increment(-transferSubtotal),
        totalItems: increment(-transferQuantity)
      });

      // 3. Add to target customer's pending order or create new
      const targetOrder = orders.find(o => o.customerId === targetId && o.status === 'pending');
      const safeTransferredItem = {
        id: crypto.randomUUID(),
        machineName: item.machineName,
        price: item.price,
        quantity: transferQuantity,
        subtotal: transferSubtotal,
        createdAt: now,
        callTime: item.callTime || item.createdAt || now,
        transferAt: now,
        sourceCustomerId: customer.id,
        sourceCustomerName: customer.name,
        ...(item.variant ? { variant: item.variant } : {}),
        ...(item.machineId ? { machineId: item.machineId } : {})
      };

      if (targetOrder) {
        batch.update(dbDoc('orders', targetOrder.id), {
          items: [...targetOrder.items, safeTransferredItem],
          totalAmount: targetOrder.totalAmount + transferSubtotal,
          updatedAt: now
        });
      } else {
        const newOrderRef = dbDoc('orders');
        batch.set(newOrderRef, {
          id: newOrderRef.id,
          customerId: targetId!,
          customerName: targetDisplayName,
          items: [safeTransferredItem],
          totalAmount: transferSubtotal,
          status: 'pending',
          createdAt: now,
          updatedAt: now
        });
      }
      if (createdTargetCustomerRef) {
        batch.set(createdTargetCustomerRef, {
          name: targetDisplayName,
          aliases: targetDisplayName === trimmedTarget ? [] : [trimmedTarget],
          totalSpent: transferSubtotal,
          totalItems: transferQuantity,
          createdAt: now,
          lastOrderAt: now
        });
      } else {
        batch.update(dbDoc('customers', targetId!), {
          totalSpent: increment(transferSubtotal),
          totalItems: increment(transferQuantity),
          lastOrderAt: now
        });
      }

      setTransferringItem(null);
      setTargetCustomerName('');
      setTransferQuantity(1);
      showToast(`已成功轉讓給 ${targetDisplayName}`);
      await batch.commit();
      await addOperationLog('transfer', 'order', `${customer.name} 轉讓 ${transferQuantity} 顆給 ${targetDisplayName}`, `${customer.name} -> ${targetDisplayName}`, {
        undoSnapshot,
        machineName: item.machineName,
        variant: item.variant,
        quantity: transferQuantity,
        amount: transferSubtotal
      });
    } catch (err: any) {
      console.error("Transfer Error:", err);
      if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
        showToast('轉讓失敗：資料庫免費額度已滿', 'error');
      } else {
        showToast('轉讓失敗，請檢查網路連線或稍後重試', 'error');
      }
      setTransferringItem(null);
      setTargetCustomerName('');
      handleLocalDataError(err, OperationType.WRITE, 'transfer');
    }
  };

  const handleReleaseToggle = async (orderId: string, item: OrderItem & { rawIds?: string[] }) => {
    try {
      const rawIds = item.rawIds || [item.id];
      const existing = releases.find(r => r.orderId === orderId && rawIds.includes(r.itemId) && r.status === 'pending');
      if (existing) {
        const undoSnapshot = buildCurrentViewSnapshot();
        showToast('已取消釋出');
        const order = orders.find(o => o.id === orderId);
        if (order) {
          const batch = writeBatch(db);
          const now = new Date().toISOString();
          const updatedItems = order.items.map(orderItem => rawIds.includes(orderItem.id)
            ? { ...orderItem, isReleased: false, releaseQuantity: 0, releaseAt: undefined, updatedAt: now }
            : orderItem
          );
          batch.delete(dbDoc('releases', existing.id));
          batch.update(dbDoc('orders', orderId), {
            items: updatedItems,
            updatedAt: now
          });
          await batch.commit();
        } else {
          await deleteDoc(dbDoc('releases', existing.id));
        }
        await addOperationLog('release_cancel', 'release', `${customer.name} 取消釋出 ${item.machineName}`, customer.name, {
          undoSnapshot,
          machineName: item.machineName,
          variant: item.variant,
          quantity: existing.quantity
        });
      } else {
        setReleasingItem({ orderId, item: { ...item, id: rawIds[0] } });
        setReleaseQuantity(item.quantity);
      }
    } catch (err) {
      handleLocalDataError(err, OperationType.WRITE, 'releases');
    }
  };

  const handleConfirmRelease = async () => {
    if (!releasingItem || releaseQuantity < 1) return;
    const { orderId, item } = releasingItem;
    const confirmedReleaseQuantity = Math.max(1, Math.min(Number(releaseQuantity) || 1, item.quantity));
    try {
      const undoSnapshot = buildCurrentViewSnapshot();
      const now = new Date().toISOString();
      const releaseRef = dbDoc('releases');
      const rawIds = (item as any).rawIds || [item.id];
      const releaseData: any = {
        orderId,
        itemId: item.id,
        rawIds,
        customerName: customer.name,
        machineName: item.machineName,
        quantity: confirmedReleaseQuantity,
        price: item.price,
        status: 'pending',
        createdAt: now,
        releaseAt: now
      };
      if (item.variant) {
        releaseData.variant = item.variant;
      }
      showToast('正在釋出中');
      setReleasingItem(null);
      const order = orders.find(o => o.id === orderId);
      if (order) {
        const updatedItems = order.items.map(orderItem => rawIds.includes(orderItem.id)
          ? { ...orderItem, isReleased: true, releaseQuantity: confirmedReleaseQuantity, releaseAt: now, updatedAt: now }
          : orderItem
        );
        const batch = writeBatch(db);
        batch.set(releaseRef, releaseData);
        batch.update(dbDoc('orders', orderId), {
          items: updatedItems,
          updatedAt: now
        });
        await batch.commit();
      } else {
        await setDoc(releaseRef, releaseData);
      }
      await addOperationLog('release_create', 'release', `${customer.name} 釋出 ${confirmedReleaseQuantity} 顆 ${item.machineName}`, customer.name, {
        undoSnapshot,
        machineName: item.machineName,
        variant: item.variant,
        quantity: confirmedReleaseQuantity
      });
    } catch (err: any) {
      if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
        showToast('釋出失敗：資料庫免費額度已滿', 'error');
      } else {
        showToast('釋出失敗', 'error');
      }
      setReleasingItem(null);
      handleLocalDataError(err, OperationType.WRITE, 'releases');
    }
  };

  const groupOrderItems = (order: Order) => {
    const grouped: (OrderItem & { rawIds: string[] })[] = [];
    order.items.forEach(item => {
      const isReleased = releases.some(r => r.orderId === order.id && r.itemId === item.id && r.status === 'pending');
      
      // If it's released, do not group it, push it individually
      if (isReleased) {
        grouped.push({ ...item, rawIds: [item.id] });
        return;
      }

      // Find an existing unreleased group with the same machine, variant, price.
      const existing = grouped.find(g => 
        // Ensure the existing group we are adding to is also NOT released
        !g.rawIds.some(rawId => releases.some(r => r.orderId === order.id && r.itemId === rawId && r.status === 'pending')) &&
        g.machineName === item.machineName && 
        (g.variant || '') === (item.variant || '') && 
        g.price === item.price
      );

      if (existing) {
        existing.quantity += item.quantity;
        existing.subtotal += item.subtotal;
        existing.rawIds.push(item.id);
      } else {
        grouped.push({ ...item, rawIds: [item.id] });
      }
    });

    grouped.sort((a, b) => {
      if (itemSortBy === 'machine') {
        if (a.machineName === b.machineName) {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return aTime - bTime;
        }
        return a.machineName.localeCompare(b.machineName, 'zh-Hant');
      } else {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      }
    });

    return grouped;
  };

  const exchangeTargetCustomer = findCustomerByName(customers, exchangeTargetCustomerName);
  const exchangeTargetItems = exchangeTargetCustomer
    ? orders
        .filter(o => o.customerId === exchangeTargetCustomer.id && o.status === 'pending')
        .flatMap(order => groupOrderItems(order).map(item => ({ orderId: order.id, item })))
        .filter(({ item }) => item.quantity > 0)
    : [];

  const handleExchange = async () => {
    if (!exchangingItem) return;
    const targetCustomer = exchangeTargetCustomer;
    if (!targetCustomer) {
      showToast('請先選擇要交換的顧客', 'error');
      return;
    }
    if (targetCustomer.id === customer.id) {
      showToast('不能跟同一位顧客交換', 'error');
      return;
    }
    if (!selectedExchangeItem) {
      showToast('請選擇對方要交換的扭蛋', 'error');
      return;
    }

    const sourceRawIds = exchangingItem.item.rawIds || [exchangingItem.item.id];
    const targetRawIds = selectedExchangeItem.item.rawIds || [selectedExchangeItem.item.id];
    const sourceHasRelease = releases.some(r => r.orderId === exchangingItem.orderId && sourceRawIds.includes(r.itemId) && r.status === 'pending');
    const targetHasRelease = releases.some(r => r.orderId === selectedExchangeItem.orderId && targetRawIds.includes(r.itemId) && r.status === 'pending');
    if (sourceHasRelease || targetHasRelease) {
      showToast('交換前請先取消釋出中的品項', 'error');
      return;
    }

    const sourceOrder = orders.find(o => o.id === exchangingItem.orderId);
    const targetOrder = orders.find(o => o.id === selectedExchangeItem.orderId);
    if (!sourceOrder || !targetOrder) {
      showToast('找不到交換訂單資料', 'error');
      return;
    }

    const now = new Date().toISOString();
    const sourceSubtotal = exchangingItem.item.subtotal;
    const targetSubtotal = selectedExchangeItem.item.subtotal;
    const sourceQuantity = exchangingItem.item.quantity;
    const targetQuantity = selectedExchangeItem.item.quantity;
    const { rawIds: _sourceRawIds, ...sourceBase } = exchangingItem.item as any;
    const { rawIds: _targetRawIds, ...targetBase } = selectedExchangeItem.item as any;

    const itemForSource: OrderItem = {
      ...targetBase,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      exchangeAt: now,
      sourceCustomerId: targetCustomer.id,
      sourceCustomerName: targetCustomer.name,
      isReleased: false,
      isChecked: false
    };
    const itemForTarget: OrderItem = {
      ...sourceBase,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      exchangeAt: now,
      sourceCustomerId: customer.id,
      sourceCustomerName: customer.name,
      isReleased: false,
      isChecked: false
    };

    const nextSourceItems = [
      ...sourceOrder.items.filter(item => !sourceRawIds.includes(item.id)),
      itemForSource
    ];
    const nextTargetItems = [
      ...targetOrder.items.filter(item => !targetRawIds.includes(item.id)),
      itemForTarget
    ];
    const nextSourceTotal = nextSourceItems.reduce((sum, item) => sum + item.subtotal, 0);
    const nextTargetTotal = nextTargetItems.reduce((sum, item) => sum + item.subtotal, 0);

    try {
      const undoSnapshot = buildCurrentViewSnapshot();
      const batch = writeBatch(db);
      batch.update(dbDoc('orders', sourceOrder.id), {
        items: nextSourceItems,
        totalAmount: nextSourceTotal,
        updatedAt: now
      });
      batch.update(dbDoc('orders', targetOrder.id), {
        items: nextTargetItems,
        totalAmount: nextTargetTotal,
        updatedAt: now
      });
      batch.update(dbDoc('customers', customer.id), {
        totalSpent: increment(targetSubtotal - sourceSubtotal),
        totalItems: increment(targetQuantity - sourceQuantity),
        lastOrderAt: now
      });
      batch.update(dbDoc('customers', targetCustomer.id), {
        totalSpent: increment(sourceSubtotal - targetSubtotal),
        totalItems: increment(sourceQuantity - targetQuantity),
        lastOrderAt: now
      });
      await batch.commit();
      setExchangingItem(null);
      setExchangeTargetCustomerName('');
      setSelectedExchangeItem(null);
      showToast(`已與 ${targetCustomer.name} 完成交換`);
      await addOperationLog('exchange', 'order', `${customer.name} 與 ${targetCustomer.name} 完成交換`, `${customer.name} <-> ${targetCustomer.name}`, {
        undoSnapshot,
        sourceMachineName: exchangingItem.item.machineName,
        sourceVariant: exchangingItem.item.variant,
        targetMachineName: selectedExchangeItem.item.machineName,
        targetVariant: selectedExchangeItem.item.variant
      });
    } catch (err) {
      setExchangingItem(null);
      setSelectedExchangeItem(null);
      handleLocalDataError(err, OperationType.WRITE, 'exchange');
    }
  };

  return (
    <div className="fixed inset-0 z-0 bg-background flex flex-col">
      <header className="p-6 border-b border-divider flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 bg-card-white rounded-xl shadow-sm">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            {isEditingName ? (
              <div className="flex items-center gap-2 mb-1">
                <input 
                  type="text" 
                  value={editedName} 
                  onChange={(e) => setEditedName(e.target.value)}
                  className="px-3 py-1 border border-divider rounded-lg text-xl font-bold text-ink w-48 bg-card-white"
                  autoFocus
                />
                <button onClick={handleSaveName} className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
                  <CheckCircle2 className="w-4 h-4" />
                </button>
                <button onClick={() => { setIsEditingName(false); setEditedName(customer.name); }} className="p-1.5 bg-gray-200 text-ink rounded-lg hover:bg-gray-300 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-ink">{customer.name}</h2>
                <button 
                  onClick={() => { setIsEditingName(true); setEditedName(customer.name); }}
                  className="p-1 text-ink/40 hover:text-primary-blue transition-colors"
                  title="編輯顧客名稱"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <p className="text-xs text-ink/40">消費總額: NT${customer.totalSpent} • 總顆數: {customer.totalItems || 0}</p>
              <button 
                onClick={handleRecalculateStats}
                className="p-1 text-primary-blue/60 hover:text-primary-blue transition-colors"
                title="重新計算數據"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-background p-1 rounded-xl">
            <button 
              onClick={() => setItemSortBy('machine')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                itemSortBy === 'machine' ? "bg-card-white text-ink shadow-sm" : "text-ink/40"
              )}
            >
              依機台
            </button>
            <button 
              onClick={() => setItemSortBy('time')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                itemSortBy === 'time' ? "bg-card-white text-ink shadow-sm" : "text-ink/40"
              )}
            >
              依時間
            </button>
          </div>
          <button 
            onClick={onCopyNotification}
            className="px-4 py-2 bg-primary-blue/10 text-primary-blue rounded-xl font-bold text-sm hover:bg-primary-blue/20 transition-colors"
          >
            複製通知
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 pb-32">
        <div className="bg-card-white p-5 rounded-3xl card-shadow">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest">顧客別名</h3>
            <span className="text-[10px] font-bold text-ink/30">新增訂單、轉讓、交換會一起比對</span>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {(customer.aliases || []).length === 0 ? (
              <span className="text-xs font-medium text-ink/30">尚未設定別名</span>
            ) : (
              (customer.aliases || []).map(alias => (
                <span key={alias} className="inline-flex items-center gap-1 rounded-xl bg-primary-blue/10 px-3 py-1.5 text-xs font-bold text-primary-blue">
                  {alias}
                  <button
                    onClick={() => removeCustomerAlias(alias)}
                    className="rounded-full p-0.5 hover:bg-primary-blue/10"
                    title="移除別名"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomerAlias()}
              placeholder="加入 IG、FB、LINE 暱稱..."
              className="min-w-0 flex-1 rounded-xl border-none bg-background px-4 py-3 text-sm font-medium text-ink outline-none focus:ring-2 focus:ring-primary-blue"
            />
            <button
              onClick={addCustomerAlias}
              className="rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white"
            >
              新增別名
            </button>
          </div>
        </div>

        {customerOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package className="w-12 h-12 text-ink/20 mb-4" />
            <p className="font-bold text-ink/40">這個顧客目前沒有訂單紀錄</p>
            <p className="text-xs text-ink/30 mt-2 max-w-[200px]">若是總顆數顯示與實際不符，請點擊上方右上角的「重新計算」按鈕進行校正。</p>
          </div>
        ) : (
          customerOrders.map(order => {
            const groupedItems = groupOrderItems(order);
          return (
            <div key={order.id} className="bg-card-white p-6 rounded-3xl card-shadow border-l-4 border-primary-blue">
              <div className="flex justify-between items-center mb-4">
                <span className="text-xs font-bold text-ink/40">{order.createdAt ? format(toZonedTime(new Date(order.createdAt), TAIWAN_TZ), 'yyyy/MM/dd HH:mm') : '無日期'}</span>
                <button 
                  onClick={() => {
                    setConfirmModal({
                      show: true,
                      title: '刪除訂單',
                      message: `確定要刪除這筆訂單嗎？`,
                      type: 'danger',
                      onConfirm: async () => {
                        try {
                          const undoSnapshot = buildCurrentViewSnapshot();
                          await deleteDoc(dbDoc('orders', order.id));
                          
                          // Update customer stats
                          await updateDoc(dbDoc('customers', order.customerId), {
                            totalSpent: increment(-order.totalAmount),
                            totalItems: increment(-order.items.reduce((sum, i) => sum + i.quantity, 0))
                          });
                          await addOperationLog('order_delete', 'order', `已刪除 ${order.customerName} 的訂單`, order.customerName, {
                            undoSnapshot,
                            orderId: order.id,
                            amount: order.totalAmount,
                            itemCount: order.items.reduce((sum, i) => sum + i.quantity, 0)
                          });
                          showToast('訂單已刪除');
                        } catch (err) {
                          handleLocalDataError(err, OperationType.DELETE, `orders/${order.id}`);
                        }
                      }
                    });
                  }}
                  className="p-2 text-red-400 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                {groupedItems.length === 0 ? (
                  <p className="text-center py-4 text-ink/30 font-medium text-sm">訂單內無項目</p>
                ) : (
                  groupedItems.map((item, idx) => {
                  // For grouped items, we just check if ANY of their raw items has a pending release.
                  // Since all raw items in the group have the same machine & variant, it's safe to visually track the first one
                  const isReleased = item.rawIds.some(rawId => releases.some(r => r.orderId === order.id && r.itemId === rawId && r.status === 'pending'));
                  const machine = machines.find(m => m.name === item.machineName);
                  return (
                    <div key={`${item.id}-${idx}`} className="flex flex-col gap-2 p-4 bg-background rounded-2xl relative group">
                    <div className="flex justify-between items-start">
                      <div className="flex gap-3">
                        <div 
                          className="w-10 h-10 bg-card-white rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => {
                            if (machine) {
                              setEditingMachine(machine);
                            } else {
                              setEditingMachine({
                                id: '',
                                name: item.machineName,
                                defaultPrice: 0,
                                variants: [],
                                imageUrl: null
                              });
                            }
                          }}
                        >
                          {machine?.imageUrl ? (
                            <img src={machine.imageUrl || undefined} alt={item.machineName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <Package className="w-5 h-5 text-ink/20" />
                          )}
                        </div>
                        <div>
                          <p 
                            className="font-bold text-ink cursor-pointer hover:text-primary-blue transition-colors"
                            onClick={() => {
                              if (machine) {
                                setEditingMachine(machine);
                              } else {
                                setEditingMachine({
                                  id: '',
                                  name: item.machineName,
                                  defaultPrice: 0,
                                  variants: [],
                                  imageUrl: null
                                });
                              }
                            }}
                          >
                            {item.machineName}
                          </p>
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-ink/40">{item.variant || '無款式'}</p>
                            <span className="text-[10px] text-ink/20">•</span>
                            <p className="text-[10px] text-ink/30">喊單 {formatDateTime(item.callTime || item.createdAt)}</p>
                          </div>
                          <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1">
                            <p className="text-[10px] text-ink/30">建立 {formatDateTime(order.createdAt)}</p>
                            {item.releaseAt && <p className="text-[10px] text-orange-500">釋出 {formatDateTime(item.releaseAt)}</p>}
                            {item.transferAt && <p className="text-[10px] text-primary-blue">轉讓 {formatDateTime(item.transferAt)}</p>}
                            {item.exchangeAt && <p className="text-[10px] text-green-600">交換 {formatDateTime(item.exchangeAt)}</p>}
                            {item.sourceCustomerName && <p className="text-[10px] text-ink/30">來源 {item.sourceCustomerName}</p>}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-ink">NT${item.price} x {item.quantity}</p>
                        <p className="text-xs font-bold text-primary-blue">NT${item.subtotal}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button 
                        onClick={() => setEditingItem({ orderId: order.id, item })}
                        className="flex-1 py-2 bg-card-white text-ink/60 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1"
                      >
                        <Save className="w-3 h-3" /> 編輯
                      </button>
                      <button 
                        onClick={() => {
                          setTransferringItem({ orderId: order.id, item });
                          setTransferQuantity(item.quantity);
                        }}
                        className="flex-1 py-2 bg-card-white text-ink/60 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1"
                      >
                        <ArrowRight className="w-3 h-3" /> 轉讓
                      </button>
                      <button
                        onClick={() => {
                          setExchangingItem({ orderId: order.id, item });
                          setExchangeTargetCustomerName('');
                          setSelectedExchangeItem(null);
                        }}
                        disabled={isReleased}
                        className="flex-1 py-2 bg-card-white text-ink/60 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ArrowRightLeft className="w-3 h-3" /> 交換
                      </button>
                      <button 
                        onClick={() => handleReleaseToggle(order.id, item)}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1 transition-colors",
                          isReleased ? "bg-orange-500 text-white" : "bg-card-white text-ink/60"
                        )}
                      >
                        <LogOut className="w-3 h-3" /> {isReleased ? `取消釋出 (${releases.find(r => r.orderId === order.id && item.rawIds.includes(r.itemId) && r.status === 'pending')?.quantity})` : '釋出'}
                      </button>
                    </div>
                  </div>
                );
              }))}
            </div>
          </div>
          );
        }))}
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingItem && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              className="bg-card-white w-full max-w-md p-6 rounded-t-3xl sm:rounded-3xl shadow-2xl"
            >
              <h3 className="text-lg font-bold text-ink mb-4">編輯項目</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-ink/40 block mb-1">款式</label>
                  {machines.find(m => m.name === editingItem.item.machineName) ? (
                    <select 
                      className="w-full p-4 bg-background rounded-2xl border-none"
                      value={editingItem.item.variant || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, variant: e.target.value } })}
                    >
                      <option value="">選擇款式</option>
                      {(machines.find(m => m.name === editingItem.item.machineName)?.variants || []).map((v: string) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  ) : (
                    <input 
                      className="w-full p-4 bg-background rounded-2xl border-none"
                      value={editingItem.item.variant || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, variant: e.target.value } })}
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-ink/40 block mb-1">單價</label>
                    <input 
                      type="number" className="w-full p-4 bg-background rounded-2xl border-none"
                      value={isNaN(editingItem.item.price) ? '' : editingItem.item.price}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        const newPrice = isNaN(val) ? 0 : val;
                        setEditingItem({ ...editingItem, item: { ...editingItem.item, price: newPrice, subtotal: newPrice * editingItem.item.quantity } })
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-ink/40 block mb-1">數量</label>
                    <input 
                      type="number" className="w-full p-4 bg-background rounded-2xl border-none"
                      value={isNaN(editingItem.item.quantity) ? '' : editingItem.item.quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        const newQty = isNaN(val) ? 0 : val;
                        setEditingItem({ ...editingItem, item: { ...editingItem.item, quantity: newQty, subtotal: editingItem.item.price * newQty } })
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-ink/40 block mb-1">喊單時間</label>
                  <input
                    type="datetime-local"
                    className="w-full p-4 bg-background rounded-2xl border-none"
                    value={toDateTimeInputValue(editingItem.item.callTime || editingItem.item.createdAt)}
                    onChange={(e) => setEditingItem({
                      ...editingItem,
                      item: {
                        ...editingItem.item,
                        callTime: fromDateTimeInputValue(e.target.value, editingItem.item.createdAt || new Date().toISOString())
                      }
                    })}
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <button onClick={() => setEditingItem(null)} className="flex-1 py-4 bg-background text-ink rounded-2xl font-bold">取消</button>
                  <button 
                    onClick={() => {
                      setConfirmModal({
                        show: true,
                        title: '刪除項目',
                        message: `確定要從訂單中刪除 ${editingItem.item.machineName} 嗎？`,
                        type: 'danger',
                        onConfirm: async () => {
                          setEditingItem(null);
                          const order = orders.find(o => o.id === editingItem.orderId);
                          if (!order) return;
                          
                          const rawIds = (editingItem.item as any).rawIds || [editingItem.item.id];
                          const newItems = order.items.filter(i => !rawIds.includes(i.id));
                          
                          const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);
                          
                          try {
                            const undoSnapshot = buildCurrentViewSnapshot();
                            const batch = writeBatch(db);
                            if (newItems.length === 0) {
                              batch.delete(dbDoc('orders', order.id));
                            } else {
                              batch.update(dbDoc('orders', order.id), {
                                items: newItems,
                                totalAmount: newTotal,
                                updatedAt: new Date().toISOString()
                              });
                            }
                            
                            // Update customer stats
                            batch.update(dbDoc('customers', order.customerId), {
                              totalSpent: increment(-editingItem.item.subtotal),
                              totalItems: increment(-editingItem.item.quantity)
                            });
                            
                            await batch.commit();
                            await addOperationLog('order_item_delete', 'order', `已刪除項目：${editingItem.item.machineName}`, order.customerName, {
                              undoSnapshot,
                              orderId: order.id,
                              machineName: editingItem.item.machineName,
                              variant: editingItem.item.variant,
                              quantity: editingItem.item.quantity,
                              amount: editingItem.item.subtotal
                            });

                            showToast('項目已刪除');
                          } catch (err: any) {
                            if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
                              showToast('刪除失敗：資料庫免費額度已滿', 'error');
                            } else {
                              showToast('刪除失敗', 'error');
                            }
                            handleLocalDataError(err, OperationType.WRITE, `orders/${order.id}`);
                          }
                        }
                      });
                    }}
                    className="p-4 bg-red-50 text-red-500 rounded-2xl"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <button onClick={() => handleUpdateItem(editingItem.orderId, editingItem.item)} className="flex-[2] py-4 bg-primary-blue text-white rounded-2xl font-bold">儲存</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Exchange Modal */}
      <AnimatePresence>
        {exchangingItem && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              className="bg-card-white w-full max-w-lg p-6 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88vh] overflow-y-auto"
            >
              <h3 className="text-lg font-bold text-ink mb-2">交換扭蛋</h3>
              <p className="text-sm text-ink/60 mb-4">
                用 {exchangingItem.item.machineName}{exchangingItem.item.variant ? `（${exchangingItem.item.variant}）` : ''} 與其他顧客交換。
              </p>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-ink/40 block mb-2">交換對象</label>
                  <SuggestiveInput
                    value={exchangeTargetCustomerName}
                    onChange={(value) => {
                      setExchangeTargetCustomerName(value);
                      setSelectedExchangeItem(null);
                    }}
                    placeholder="輸入或選擇顧客名稱..."
                    suggestions={getCustomerNameSuggestions(customers.filter(c => c.id !== customer.id))}
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-ink/40 block mb-2">選擇對方要交換的扭蛋</label>
                  {!exchangeTargetCustomerName ? (
                    <p className="text-sm text-ink/30 bg-background rounded-2xl p-4">請先選擇交換對象。</p>
                  ) : !exchangeTargetCustomer ? (
                    <p className="text-sm text-red-400 bg-red-50 rounded-2xl p-4">交換需要選擇已有扭蛋的顧客；若只是要轉給新顧客，請使用「轉讓」。</p>
                  ) : exchangeTargetItems.length === 0 ? (
                    <p className="text-sm text-ink/30 bg-background rounded-2xl p-4">這位顧客目前沒有可交換的扭蛋。</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {exchangeTargetItems.map(({ orderId, item }) => {
                        const selected = selectedExchangeItem?.orderId === orderId && selectedExchangeItem.item.id === item.id;
                        return (
                          <button
                            key={`${orderId}-${item.id}`}
                            onClick={() => setSelectedExchangeItem({ orderId, item })}
                            className={cn(
                              "w-full text-left p-4 rounded-2xl border transition-colors",
                              selected ? "bg-primary-blue/10 border-primary-blue" : "bg-background border-transparent hover:bg-ink/5"
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-bold text-ink">{item.machineName}</p>
                                <p className="text-xs text-ink/40">{item.variant || '無款式'} • {item.quantity} 顆 • NT${item.subtotal}</p>
                              </div>
                              {selected && <CheckCircle2 className="w-5 h-5 text-primary-blue flex-shrink-0" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2 pt-6">
                <button
                  onClick={() => {
                    setExchangingItem(null);
                    setExchangeTargetCustomerName('');
                    setSelectedExchangeItem(null);
                  }}
                  className="flex-1 py-4 bg-background text-ink rounded-2xl font-bold"
                >
                  取消
                </button>
                <button onClick={handleExchange} className="flex-1 py-4 bg-green-600 text-white rounded-2xl font-bold">
                  確認交換
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Transfer Modal */}
      <AnimatePresence>
        {transferringItem && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              className="bg-card-white w-full max-w-md p-6 rounded-t-3xl sm:rounded-3xl shadow-2xl"
            >
              <h3 className="text-lg font-bold text-ink mb-4">轉讓項目</h3>
              <p className="text-sm text-ink/60 mb-4">將 {transferringItem.item.machineName} 轉讓給：</p>
              
              <div className="mb-4">
                <label className="text-xs font-bold text-ink/40 block mb-2">轉讓數量</label>
                <div className="flex items-center gap-4">
                  <button onClick={() => setTransferQuantity(Math.max(1, transferQuantity - 1))} className="w-10 h-10 bg-background rounded-full flex items-center justify-center shadow-sm">-</button>
                  <span className="text-xl font-bold w-8 text-center">{transferQuantity}</span>
                  <button onClick={() => setTransferQuantity(Math.min(transferringItem.item.quantity, transferQuantity + 1))} className="w-10 h-10 bg-background rounded-full flex items-center justify-center shadow-sm">+</button>
                </div>
              </div>

              <SuggestiveInput 
                value={targetCustomerName}
                onChange={setTargetCustomerName}
                placeholder="輸入顧客名稱..."
                suggestions={getCustomerNameSuggestions(customers)}
              />
              <div className="flex gap-2 pt-6">
                <button onClick={() => setTransferringItem(null)} className="flex-1 py-4 bg-background text-ink rounded-2xl font-bold">取消</button>
                <button onClick={handleTransfer} className="flex-1 py-4 bg-primary-blue text-white rounded-2xl font-bold">確認轉讓</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Release Modal */}
      <AnimatePresence>
        {releasingItem && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              className="bg-card-white w-full max-w-md p-6 rounded-t-3xl sm:rounded-3xl shadow-2xl"
            >
              <h3 className="text-lg font-bold text-ink mb-4">釋出項目</h3>
              <p className="text-sm text-ink/60 mb-4">釋出 {releasingItem.item.machineName} {releasingItem.item.variant && `(${releasingItem.item.variant})`}</p>
              <p className="text-xs text-ink/40 mb-4 bg-background rounded-2xl p-3">
                釋出只會放進釋出池，成功轉讓給其他顧客前，數量與金額仍保留在原顧客帳上。
              </p>
              
              <div className="mb-4">
                <label className="text-xs font-bold text-ink/40 block mb-2">釋出數量</label>
                <div className="flex items-center gap-4">
                  <button onClick={() => setReleaseQuantity(prev => Math.max(1, prev - 1))} className="w-10 h-10 bg-background rounded-full flex items-center justify-center shadow-sm">-</button>
                  <input
                    type="number"
                    min={1}
                    max={releasingItem.item.quantity}
                    value={releaseQuantity}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      setReleaseQuantity(Number.isNaN(value) ? 1 : Math.max(1, Math.min(releasingItem.item.quantity, value)));
                    }}
                    className="w-20 px-3 py-2 bg-background rounded-xl border-none text-center text-xl font-bold text-ink focus:ring-2 focus:ring-primary-blue"
                  />
                  <button onClick={() => setReleaseQuantity(prev => Math.min(releasingItem.item.quantity, prev + 1))} className="w-10 h-10 bg-background rounded-full flex items-center justify-center shadow-sm">+</button>
                </div>
                <p className="text-[10px] text-ink/30 mt-2">可釋出數量：{releasingItem.item.quantity}</p>
              </div>

              <div className="flex gap-2 pt-6">
                <button onClick={() => setReleasingItem(null)} className="flex-1 py-4 bg-background text-ink rounded-2xl font-bold">取消</button>
                <button onClick={handleConfirmRelease} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-bold shadow-lg shadow-orange-500/20">確認釋出</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

type PrintCustomerBlock = {
  customer: Customer;
  items: OrderItem[];
  isContinuation: boolean;
  isLastSegment: boolean;
  totalAmount: number;
};

type PrintPage = {
  blocks: PrintCustomerBlock[];
};

type PrintSortMode = 'quantity' | 'name' | 'amount';
type PrintDensityMode = 'compact' | 'normal' | 'large';

const PRINT_HEADER_UNITS = 4.6;
const PRINT_FOOTER_UNITS = 2.2;
const PRINT_BLOCK_GAP_UNITS = 0.8;
const PRINT_DENSITY_CONFIG: Record<PrintDensityMode, { label: string; capacity: number; scale: number; rowClass: string; textClass: string }> = {
  compact: { label: '緊湊', capacity: 43, scale: 0.82, rowClass: 'print-density-compact', textClass: 'text-xs' },
  normal: { label: '一般', capacity: 35, scale: 1, rowClass: 'print-density-normal', textClass: 'text-sm' },
  large: { label: '大字', capacity: 27, scale: 1.18, rowClass: 'print-density-large', textClass: 'text-base' }
};

const estimatePrintItemUnits = (item: OrderItem, densityMode: PrintDensityMode) => {
  const machineLines = Math.ceil((item.machineName || '').length / 12);
  const variantLines = Math.ceil((item.variant || '').length / 13);
  return Math.max(1.35, Math.max(machineLines, variantLines) * 0.95 + 0.45) * PRINT_DENSITY_CONFIG[densityMode].scale;
};

const sortPrintItems = (items: OrderItem[]) => {
  return [...items].sort((a, b) => {
    if (a.machineName === b.machineName) {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aTime - bTime;
    }
    return a.machineName.localeCompare(b.machineName, 'zh-Hant');
  });
};

const sortPrintCustomers = (selectedCustomers: Customer[], orders: Order[], sortMode: PrintSortMode) => {
  return [...selectedCustomers].sort((a, b) => {
    const aOrders = orders.filter(o => o.customerId === a.id);
    const bOrders = orders.filter(o => o.customerId === b.id);
    const aAmount = aOrders.reduce((sum, order) => sum + order.totalAmount, 0) || a.totalSpent;
    const bAmount = bOrders.reduce((sum, order) => sum + order.totalAmount, 0) || b.totalSpent;
    const aQuantity = aOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0) || a.totalItems;
    const bQuantity = bOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0) || b.totalItems;

    if (sortMode === 'quantity') {
      return aQuantity - bQuantity || a.name.localeCompare(b.name, 'zh-Hant');
    }
    if (sortMode === 'amount') {
      return bAmount - aAmount || a.name.localeCompare(b.name, 'zh-Hant');
    }
    return a.name.localeCompare(b.name, 'zh-Hant');
  });
};

const buildPrintPages = (selectedCustomers: Customer[], orders: Order[], sortMode: PrintSortMode, densityMode: PrintDensityMode): PrintPage[] => {
  const pages: PrintPage[] = [{ blocks: [] }];
  let remaining = PRINT_DENSITY_CONFIG[densityMode].capacity;

  const currentPage = () => pages[pages.length - 1];
  const newPage = () => {
    pages.push({ blocks: [] });
    remaining = PRINT_DENSITY_CONFIG[densityMode].capacity;
  };

  sortPrintCustomers(selectedCustomers, orders, sortMode).forEach((customer) => {
    const customerOrders = orders.filter(o => o.customerId === customer.id);
    const allItems = sortPrintItems(customerOrders.flatMap(o => o.items));
    const totalAmount = customerOrders.reduce((sum, order) => sum + order.totalAmount, 0) || customer.totalSpent;

    if (allItems.length === 0) {
      const needed = PRINT_HEADER_UNITS + PRINT_FOOTER_UNITS + PRINT_BLOCK_GAP_UNITS;
      if (currentPage().blocks.length > 0 && remaining < needed) newPage();
      currentPage().blocks.push({ customer, items: [], isContinuation: false, isLastSegment: true, totalAmount });
      remaining -= needed;
      return;
    }

    let index = 0;
    let isFirstSegment = true;

    while (index < allItems.length) {
      const firstItemUnits = estimatePrintItemUnits(allItems[index], densityMode);
      if (remaining < PRINT_HEADER_UNITS + firstItemUnits + PRINT_BLOCK_GAP_UNITS) {
        newPage();
      }

      const availableUnits = Math.max(firstItemUnits, remaining - PRINT_HEADER_UNITS - PRINT_BLOCK_GAP_UNITS);
      const availableUnitsIfLast = Math.max(firstItemUnits, availableUnits - PRINT_FOOTER_UNITS);
      const remainingUnits = allItems.slice(index).reduce((sum, item) => sum + estimatePrintItemUnits(item, densityMode), 0);
      const shouldFinishHere = remainingUnits <= availableUnitsIfLast;
      const rowBudget = shouldFinishHere ? availableUnitsIfLast : availableUnits;
      const pageItems: OrderItem[] = [];
      let usedItemUnits = 0;

      while (index + pageItems.length < allItems.length) {
        const item = allItems[index + pageItems.length];
        const itemUnits = estimatePrintItemUnits(item, densityMode);
        if (pageItems.length > 0 && usedItemUnits + itemUnits > rowBudget) break;
        pageItems.push(item);
        usedItemUnits += itemUnits;
      }

      const isLastSegment = index + pageItems.length >= allItems.length;

      currentPage().blocks.push({
        customer,
        items: pageItems,
        isContinuation: !isFirstSegment,
        isLastSegment,
        totalAmount
      });

      remaining -= PRINT_HEADER_UNITS + usedItemUnits + PRINT_BLOCK_GAP_UNITS + (isLastSegment ? PRINT_FOOTER_UNITS : 0);
      index += pageItems.length;
      isFirstSegment = false;
    }
  });

  return pages.filter(page => page.blocks.length > 0);
};

const PrintCustomerTable = ({ block, densityMode }: { block: PrintCustomerBlock; densityMode: PrintDensityMode }) => (
  <section className={cn("print-customer-block", PRINT_DENSITY_CONFIG[densityMode].rowClass)}>
    <table className={cn("w-full text-left", PRINT_DENSITY_CONFIG[densityMode].textClass)}>
      <thead>
        <tr>
          <th colSpan={6} className="pb-2">
            <div className="border-b-2 border-ink pb-2 text-center">
              <h1 className={cn("font-bold text-ink", densityMode === 'compact' ? 'text-lg' : densityMode === 'large' ? 'text-2xl' : 'text-xl')}>
                {block.customer.name}{block.isContinuation ? '（續）' : ''} 訂單明細
              </h1>
              <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-ink/60">
                <span>列印日期：{format(toZonedTime(new Date(), TAIWAN_TZ), 'yyyy/MM/dd')}</span>
                <span>顧客：{block.customer.name}</span>
              </div>
            </div>
          </th>
        </tr>
        <tr className="border-b-2 border-ink bg-ink/5 text-xs print:bg-transparent">
          <th className="w-[8%] px-2 py-1.5 text-center"></th>
          <th className="w-[32%] px-2 py-1.5">機台名稱</th>
          <th className="w-[28%] px-2 py-1.5">款式</th>
          <th className="w-[10%] px-2 py-1.5">單價</th>
          <th className="w-[8%] px-2 py-1.5">數量</th>
          <th className="w-[14%] px-2 py-1.5 text-right">小計</th>
        </tr>
      </thead>
      <tbody>
        {block.items.length === 0 ? (
          <tr className="border-b border-divider print:border-ink/10">
            <td colSpan={6} className="px-2 py-3 text-center text-ink/40">沒有明細</td>
          </tr>
        ) : (
          block.items.map((item, idx) => (
            <tr key={item.id || idx} className="print-row border-b border-divider print:border-ink/10">
              <td className="px-2 py-1 text-center align-middle">
                <div className="mx-auto h-4 w-4 rounded-sm border-2 border-ink/40 print:border-black"></div>
              </td>
              <td className="px-2 py-1">
                <div className="font-medium leading-tight">{item.machineName}</div>
                <div className="text-[10px] text-ink/30 print:text-ink/50">{formatDateTime(item.createdAt)}</div>
              </td>
              <td className="px-2 py-1 leading-snug">{item.variant || '-'}</td>
              <td className="px-2 py-1">NT${item.price}</td>
              <td className="px-2 py-1">{item.quantity}</td>
              <td className="px-2 py-1 text-right font-bold">NT${item.subtotal}</td>
            </tr>
          ))
        )}
      </tbody>
      {block.isLastSegment && (
        <tfoot>
          <tr>
            <td colSpan={5} className="px-2 py-2 text-right text-sm font-bold">總計：</td>
            <td className="px-2 py-2 text-right text-lg font-bold text-primary-blue print:text-ink">NT${block.totalAmount}</td>
          </tr>
        </tfoot>
      )}
    </table>
  </section>
);

const PrintPreview = ({ 
  customers, 
  orders, 
  onClose 
}: { 
  customers: Customer[], 
  orders: Order[], 
  onClose: () => void 
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<PrintSortMode>('quantity');
  const [densityMode, setDensityMode] = useState<PrintDensityMode>('compact');
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef });

  const toggleAll = () => {
    if (selectedIds.length === customers.length) setSelectedIds([]);
    else setSelectedIds(customers.map(c => c.id));
  };

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) setSelectedIds(selectedIds.filter(i => i !== id));
    else setSelectedIds([...selectedIds, id]);
  };

  const selectedCustomers = customers.filter(c => selectedIds.includes(c.id));
  const printPages = buildPrintPages(selectedCustomers, orders, sortMode, densityMode);
  const selectedItemCount = selectedCustomers.reduce((sum, customer) => (
    sum + orders
      .filter(order => order.customerId === customer.id)
      .reduce((orderSum, order) => orderSum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0)
  ), 0);

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between bg-card-white p-4 rounded-2xl card-shadow">
        <div>
          <h2 className="text-xl font-bold text-ink">列印預覽</h2>
          <p className="text-xs font-medium text-ink/40">
            預估 {printPages.length} 頁，{selectedCustomers.length} 位顧客，{selectedItemCount} 顆。模式：{PRINT_DENSITY_CONFIG[densityMode].label}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex rounded-xl bg-background p-1">
            {(['compact', 'normal', 'large'] as PrintDensityMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setDensityMode(mode)}
                className={cn('px-3 py-2 rounded-lg text-xs font-bold', densityMode === mode ? 'bg-card-white text-ink shadow-sm' : 'text-ink/40')}
              >
                {PRINT_DENSITY_CONFIG[mode].label}
              </button>
            ))}
          </div>
          <div className="hidden sm:flex rounded-xl bg-background p-1">
            <button
              onClick={() => setSortMode('quantity')}
              className={cn('px-3 py-2 rounded-lg text-xs font-bold', sortMode === 'quantity' ? 'bg-card-white text-ink shadow-sm' : 'text-ink/40')}
            >
              依顆數
            </button>
            <button
              onClick={() => setSortMode('name')}
              className={cn('px-3 py-2 rounded-lg text-xs font-bold', sortMode === 'name' ? 'bg-card-white text-ink shadow-sm' : 'text-ink/40')}
            >
              依名稱
            </button>
            <button
              onClick={() => setSortMode('amount')}
              className={cn('px-3 py-2 rounded-lg text-xs font-bold', sortMode === 'amount' ? 'bg-card-white text-ink shadow-sm' : 'text-ink/40')}
            >
              依金額
            </button>
          </div>
          <button 
            onClick={() => handlePrint()}
            disabled={selectedIds.length === 0}
            className="px-4 sm:px-6 py-2 bg-primary-blue text-white rounded-xl font-bold flex items-center gap-2 disabled:opacity-40"
          >
            <Printer className="w-4 h-4" /> 列印所選 ({selectedIds.length})
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-1/3 space-y-2">
          <div className="flex sm:hidden rounded-xl bg-card-white p-1 card-shadow">
            {(['compact', 'normal', 'large'] as PrintDensityMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setDensityMode(mode)}
                className={cn('flex-1 px-3 py-2 rounded-lg text-xs font-bold', densityMode === mode ? 'bg-background text-ink' : 'text-ink/40')}
              >
                {PRINT_DENSITY_CONFIG[mode].label}
              </button>
            ))}
          </div>
          <div className="flex sm:hidden rounded-xl bg-card-white p-1 card-shadow">
            <button
              onClick={() => setSortMode('quantity')}
              className={cn('flex-1 px-3 py-2 rounded-lg text-xs font-bold', sortMode === 'quantity' ? 'bg-background text-ink' : 'text-ink/40')}
            >
              依顆數
            </button>
            <button
              onClick={() => setSortMode('name')}
              className={cn('flex-1 px-3 py-2 rounded-lg text-xs font-bold', sortMode === 'name' ? 'bg-background text-ink' : 'text-ink/40')}
            >
              依名稱
            </button>
            <button
              onClick={() => setSortMode('amount')}
              className={cn('flex-1 px-3 py-2 rounded-lg text-xs font-bold', sortMode === 'amount' ? 'bg-background text-ink' : 'text-ink/40')}
            >
              依金額
            </button>
          </div>
          <button 
            onClick={toggleAll}
            className="w-full py-3 bg-card-white rounded-xl font-bold text-ink text-sm border border-divider mb-4 card-shadow"
          >
            {selectedIds.length === customers.length ? '取消全選' : '全選顧客'}
          </button>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
            {customers.map(c => (
              <div 
                key={c.id} 
                onClick={() => toggleOne(c.id)}
                className={cn(
                  "p-4 rounded-2xl cursor-pointer transition-all border-2 card-shadow",
                  selectedIds.includes(c.id) ? "bg-primary-blue/5 border-primary-blue" : "bg-card-white border-transparent"
                )}
              >
                <p className="font-bold text-ink text-sm">{c.name}</p>
                <p className="text-[10px] text-ink/40">NT${c.totalSpent}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="w-full lg:w-2/3 bg-ink/5 rounded-3xl p-3 sm:p-8 overflow-y-auto max-h-[70vh]">
          <div ref={printRef} className="space-y-6 print:space-y-0">
            <style>{`
              @media print {
                @page {
                  size: A4;
                  margin: 7mm;
                }
                html,
                body {
                  -webkit-print-color-adjust: exact;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                table {
                  width: 100%;
                  border-collapse: collapse;
                  table-layout: fixed;
                }
                thead {
                  display: table-header-group;
                }
                tr, .print-customer-block {
                  break-inside: avoid;
                }
                .print-page {
                  width: 100%;
                  height: auto !important;
                  min-height: 0 !important;
                  page-break-after: always;
                  break-after: always;
                  box-shadow: none !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  overflow: visible !important;
                }
                .print-page:last-child {
                  page-break-after: auto;
                  break-after: auto;
                }
                .print-page-inner {
                  gap: 3mm !important;
                }
                .print-customer-block th,
                .print-customer-block td {
                  padding-top: 1.1mm !important;
                  padding-bottom: 1.1mm !important;
                }
                .print-density-compact th,
                .print-density-compact td {
                  padding-top: 0.7mm !important;
                  padding-bottom: 0.7mm !important;
                  font-size: 10px !important;
                  line-height: 1.12 !important;
                }
                .print-density-normal th,
                .print-density-normal td {
                  font-size: 12px !important;
                  line-height: 1.2 !important;
                }
                .print-density-large th,
                .print-density-large td {
                  padding-top: 1.8mm !important;
                  padding-bottom: 1.8mm !important;
                  font-size: 14px !important;
                  line-height: 1.28 !important;
                }
              }
            `}</style>
            {printPages.length === 0 ? (
              <div className="bg-white w-full max-w-[210mm] min-h-[297mm] mx-auto p-10 shadow-2xl text-center text-ink/40">
                請先選擇要列印的顧客
              </div>
            ) : (
              printPages.map((page, pageIndex) => (
                <div key={pageIndex} className="print-page bg-white w-[210mm] max-w-full min-h-[297mm] mx-auto p-6 sm:p-8 shadow-2xl">
                  <div className="print-page-inner space-y-3">
                    {page.blocks.map((block, blockIndex) => (
                      <React.Fragment key={`${block.customer.id}-${pageIndex}-${blockIndex}`}>
                        <PrintCustomerTable block={block} densityMode={densityMode} />
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
const Dashboard = ({ 
  orders, 
  customers, 
  machines,
  releases, 
  settings,
  showToast 
}: { 
  orders: Order[], 
  customers: Customer[], 
  machines: any[],
  releases: any[], 
  settings: SystemSettings | null,
  showToast: (m: string, t?: 'success' | 'error') => void 
}) => {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [dashboardDateType, setDashboardDateType] = useState<TimelineFilterType>('createdAt');

  const filteredOrders = orders.map(o => {
    if (!startDate && !endDate) return o;
    
    const filteredItems = o.items.filter(item => {
      const itemTime = getItemTimelineValue(item, o, dashboardDateType);
      if (!itemTime) return false;
      const itemDateStr = format(toZonedTime(new Date(itemTime), TAIWAN_TZ), 'yyyy-MM-dd');
      if (startDate && itemDateStr < startDate) return false;
      if (endDate && itemDateStr > endDate) return false;
      return true;
    });

    return {
      ...o,
      items: filteredItems,
      totalAmount: filteredItems.reduce((sum, i) => sum + i.subtotal, 0)
    };
  }).filter(o => o.items.length > 0);

  const totalRevenue = filteredOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalItems = filteredOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
  const activeCustomersCount = startDate || endDate 
    ? new Set(filteredOrders.map(o => o.customerId)).size
    : customers.length;

  const totalJpySpent = filteredOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => {
    const baseTwdPrice = i.price - (i.variant?.includes('(環保)') ? 10 : 0);
    const currentPriceMap = settings?.priceMap || DEFAULT_PRICE_MAP;
    const jpyPriceStr = Object.keys(currentPriceMap).find(key => currentPriceMap[parseInt(key)] === baseTwdPrice);
    const jpyPrice = jpyPriceStr ? parseInt(jpyPriceStr) : 0;
    return s + (jpyPrice * i.quantity);
  }, 0), 0);

  const pendingReleases = releases.filter(r => r.status === 'pending');
  const pendingReleaseGroups = Array.from(
    pendingReleases.reduce((map, release) => {
      const key = [
        release.customerName.replace(/\s+/g, ''),
        release.machineName,
        release.variant || '',
        release.price
      ].join('|');
      const existing = map.get(key);
      if (existing) {
        existing.quantity += Number(release.quantity) || 0;
        existing.entries.push(release);
        existing.releaseAt = existing.releaseAt && release.releaseAt
          ? (new Date(existing.releaseAt).getTime() <= new Date(release.releaseAt).getTime() ? existing.releaseAt : release.releaseAt)
          : (existing.releaseAt || release.releaseAt);
      } else {
        map.set(key, {
          ...release,
          id: key,
          quantity: Number(release.quantity) || 0,
          entries: [release]
        });
      }
      return map;
    }, new Map<string, any>()).values()
  ) as any[];

  const [transferringRelease, setTransferringRelease] = useState<any | null>(null);
  const [targetCustomerName, setTargetCustomerName] = useState('');

  const buildDashboardSnapshot = (): RestoreSnapshot => {
    const { id: settingsId, ...settingsPayload } = normalizeSettings('global', settings || {});
    return {
      customers,
      orders,
      machines,
      releases,
      settings: settings ? settingsPayload : null,
      createdAt: new Date().toISOString()
    };
  };

  const handleReleaseTransfer = async () => {
    if (!transferringRelease) return;
    const trimmedTarget = targetCustomerName.replace(/\s+/g, '');
    if (!trimmedTarget) {
      showToast('請輸入目標顧客名稱', 'error');
      return;
    }
    const release = transferringRelease;
    const releaseEntries = Array.isArray(release.entries) ? release.entries : [release];

    const targetCust = findCustomerByName(customers, trimmedTarget);
    const targetDisplayName = targetCust?.name || trimmedTarget;
    const sourceCustomer = findCustomerByName(customers, release.customerName);

    if ((sourceCustomer && targetCust?.id === sourceCustomer.id) || normalizeCustomerNameKey(trimmedTarget) === normalizeCustomerNameKey(release.customerName)) {
      showToast('不能轉讓給原顧客自己！', 'error');
      return;
    }

    try {
      const undoSnapshot = buildDashboardSnapshot();
      const batch = writeBatch(db);
      const now = new Date().toISOString();

      // 1. Find or create target customer
      let targetId = targetCust?.id;
      let createdTargetCustomerRef: any = null;

      if (!targetCust) {
        const newCustRef = dbDoc('customers');
        createdTargetCustomerRef = newCustRef;
        targetId = newCustRef.id;
      }

      // 2. Update release status
      releaseEntries.forEach((entry: any) => batch.update(dbDoc('releases', entry.id), {
        status: 'completed',
        transferredAt: now,
        transferTargetCustomerId: targetId,
        transferTargetCustomerName: targetDisplayName
      }));
      
      // 3. Update the original order item and customer
      const entriesByOrder = releaseEntries.reduce((map: Map<string, any[]>, entry: any) => {
        const group = map.get(entry.orderId) || [];
        group.push(entry);
        map.set(entry.orderId, group);
        return map;
      }, new Map<string, any[]>());
      let totalTransferQuantity = 0;
      let totalTransferSubtotal = 0;
      let firstTransferredItem: any = null;

      for (const [orderId, entries] of entriesByOrder) {
        const orderRef = dbDoc('orders', orderId);
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) continue;

        const orderData = orderSnap.data() as Order;
        let newItems = [...orderData.items];
        let orderTransferQuantity = 0;
        let orderTransferSubtotal = 0;

        for (const entry of entries) {
          const rawIds = entry.rawIds || [entry.itemId];
          const oldItems = newItems.filter(i => rawIds.includes(i.id));
          const oldQty = oldItems.reduce((sum, i) => sum + i.quantity, 0);
          const oldSubtotal = oldItems.reduce((sum, i) => sum + i.subtotal, 0);
          const transferQuantity = Math.max(0, Math.min(Number(entry.quantity) || 0, oldQty));
          const transferSubtotal = transferQuantity * entry.price;

          if (oldItems.length === 0 || transferQuantity < 1) {
            continue;
          }

          if (!firstTransferredItem) {
            firstTransferredItem = {
              machineName: entry.machineName,
              variant: entry.variant,
              price: entry.price,
              callTime: oldItems[0]?.callTime || oldItems[0]?.createdAt,
              transferAt: now,
              sourceCustomerName: entry.customerName
            };
          }

          newItems = newItems.filter(i => !rawIds.includes(i.id));
          const remainingQuantity = Math.max(0, oldQty - transferQuantity);
          const remainingItem = {
            ...oldItems[0],
            id: rawIds[0],
            quantity: remainingQuantity,
            subtotal: Math.max(0, oldSubtotal - transferSubtotal),
            isReleased: false,
            releaseQuantity: 0,
            releaseAt: undefined,
            updatedAt: now,
            transferAt: now
          };
          // @ts-ignore
          delete remainingItem.rawIds;
          newItems.push(remainingItem);

          orderTransferQuantity += transferQuantity;
          orderTransferSubtotal += transferSubtotal;
        }

        if (orderTransferQuantity > 0) {
          const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);
          batch.update(orderRef, {
            items: newItems,
            totalAmount: newTotal,
            updatedAt: now
          });
          batch.update(dbDoc('customers', orderData.customerId), {
            totalSpent: increment(-orderTransferSubtotal),
            totalItems: increment(-orderTransferQuantity)
          });
          totalTransferQuantity += orderTransferQuantity;
          totalTransferSubtotal += orderTransferSubtotal;
        }
      }

      // 4. Add to target customer's pending order or create new
      if (firstTransferredItem && totalTransferQuantity > 0) {
        const transferredItem = {
          ...firstTransferredItem,
          id: crypto.randomUUID(),
          quantity: totalTransferQuantity,
          subtotal: totalTransferSubtotal,
          createdAt: now,
          updatedAt: now,
          transferAt: now,
          isReleased: false
        };

        const targetOrder = orders.find(o => o.customerId === targetId && o.status === 'pending');
        if (targetOrder) {
          const updatedItems = [...targetOrder.items, { ...transferredItem, createdAt: now, updatedAt: now, transferAt: now }];

          batch.update(dbDoc('orders', targetOrder.id), {
            items: updatedItems,
            totalAmount: targetOrder.totalAmount + transferredItem.subtotal,
            updatedAt: now
          });
        } else {
          const newOrderRef = dbDoc('orders');
          batch.set(newOrderRef, {
            id: newOrderRef.id,
            customerId: targetId!,
            customerName: targetDisplayName,
            items: [{ ...transferredItem, createdAt: now, updatedAt: now, transferAt: now }],
            totalAmount: transferredItem.subtotal,
            status: 'pending',
            createdAt: now,
            updatedAt: now
          });
        }
        if (createdTargetCustomerRef) {
          batch.set(createdTargetCustomerRef, {
            name: targetDisplayName,
            aliases: targetDisplayName === trimmedTarget ? [] : [trimmedTarget],
            totalSpent: totalTransferSubtotal,
            totalItems: totalTransferQuantity,
            createdAt: now,
            lastOrderAt: now
          });
        } else {
          batch.update(dbDoc('customers', targetId!), {
            totalSpent: increment(totalTransferSubtotal),
            totalItems: increment(totalTransferQuantity),
            lastOrderAt: now
          });
        }
      } else {
        showToast('原顧客帳上已沒有可轉讓數量', 'error');
        return;
      }

      showToast('釋出轉移成功！');
      setTransferringRelease(null);
      setTargetCustomerName('');
      await batch.commit();
      await addOperationLog('release_transfer', 'release', `${release.customerName} 釋出成交轉讓 ${totalTransferQuantity} 顆給 ${targetDisplayName}`, `${release.customerName} -> ${targetDisplayName}`, {
        undoSnapshot,
        machineName: release.machineName,
        variant: release.variant,
        quantity: totalTransferQuantity,
        amount: totalTransferSubtotal
      });
    } catch (err: any) {
      if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
        showToast('轉移失敗：資料庫免費額度已滿', 'error');
      } else {
        showToast('轉移失敗', 'error');
      }
      setTransferringRelease(null);
      setTargetCustomerName('');
      handleLocalDataError(err, OperationType.WRITE, `releases/${release.id}`);
    }
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-card-white p-4 rounded-2xl card-shadow">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-ink/40" />
          <span className="font-bold text-ink text-sm">日期區間篩選</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <select
            value={dashboardDateType}
            onChange={(e) => setDashboardDateType(e.target.value as TimelineFilterType)}
            className="px-3 py-2 bg-background rounded-xl border-none text-sm font-bold text-ink flex-1 sm:flex-none"
          >
            <option value="createdAt">建立</option>
            <option value="callTime">喊單</option>
            <option value="updatedAt">編輯</option>
            <option value="releaseAt">釋出</option>
            <option value="transferAt">轉讓</option>
            <option value="exchangeAt">交換</option>
          </select>
          <input 
            type="date" 
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 bg-background rounded-xl border-none text-sm font-bold text-ink flex-1 sm:flex-none"
          />
          <span className="text-ink/40">-</span>
          <input 
            type="date" 
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 bg-background rounded-xl border-none text-sm font-bold text-ink flex-1 sm:flex-none"
          />
          {(startDate || endDate) && (
            <button 
              onClick={() => { setStartDate(''); setEndDate(''); }}
              className="p-2 text-ink/40 hover:text-red-500 transition-colors"
              title="清除篩選"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-orange-400 p-6 rounded-3xl text-white card-shadow">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">預估營收</p>
          <p className="text-3xl font-bold">NT${totalRevenue}</p>
        </div>
        <div className="bg-red-400 p-6 rounded-3xl text-white card-shadow">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">日幣總花費</p>
          <p className="text-3xl font-bold">¥{totalJpySpent}</p>
        </div>
        <div className="bg-ink/40 p-6 rounded-3xl text-white card-shadow">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">總顆數</p>
          <p className="text-3xl font-bold">{totalItems}</p>
        </div>
        <div className="bg-primary-blue p-6 rounded-3xl text-white card-shadow">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">
            {startDate || endDate ? '活躍顧客' : '顧客總數'}
          </p>
          <p className="text-3xl font-bold">{activeCustomersCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card-white p-6 rounded-3xl card-shadow">
          <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest mb-6 flex items-center justify-between">
            <span>釋出池</span>
            <div className="flex items-center gap-2">
              <span className="bg-primary-blue/10 text-primary-blue px-2 py-1 rounded text-[10px]">{pendingReleaseGroups.length} 組待處理</span>
              <span className="bg-orange-500/10 text-orange-500 px-2 py-1 rounded text-[10px]">共 {pendingReleaseGroups.reduce((sum, r) => sum + r.quantity, 0)} 顆</span>
            </div>
          </h3>
          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
            {pendingReleaseGroups.length === 0 ? (
              <p className="text-center py-8 text-ink/30 text-sm">目前沒有釋出中的扭蛋</p>
            ) : (
              pendingReleaseGroups.map(r => (
                <div key={r.id} className="p-4 bg-background rounded-2xl flex items-center justify-between group">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-ink">{r.machineName}</span>
                      {r.variant && <span className="text-[10px] bg-ink/5 px-1.5 py-0.5 rounded text-ink/60">{r.variant}</span>}
                      {r.entries?.length > 1 && <span className="text-[10px] bg-primary-blue/10 px-1.5 py-0.5 rounded text-primary-blue">合併 {r.entries.length} 筆</span>}
                    </div>
                    <p className="text-xs text-ink/40">
                      來自 <span className="font-bold text-ink/60">{r.customerName}</span> • {r.quantity} 顆 • NT${r.price}/顆 • 釋出 {formatDateTime(r.releaseAt || r.createdAt)}
                    </p>
                  </div>
                  <button 
                    onClick={() => setTransferringRelease(r)}
                    className="p-2 bg-primary-blue text-white rounded-xl shadow-sm opacity-0 group-hover:opacity-100 transition-all"
                    title="成交轉讓給顧客"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-card-white p-6 rounded-3xl card-shadow">
          <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest mb-6">熱門機台</h3>
          <div className="space-y-4">
            {Array.from(new Set(filteredOrders.flatMap(o => o.items.map(i => i.machineName))))
              .map(name => ({
                name,
                count: filteredOrders.flatMap(o => o.items).filter(i => i.machineName === name).reduce((s, i) => s + i.quantity, 0)
              }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 8)
              .map(({ name, count }) => {
                const machine = machines.find(m => m.name === name);
                return (
                  <div key={name} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-background rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                        <Package className="w-4 h-4 text-ink/20" />
                      </div>
                      <span className="font-bold text-ink">{name}</span>
                    </div>
                    <span className="text-sm font-bold text-primary-blue">{count} 個</span>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Transfer Modal */}
      <AnimatePresence>
        {transferringRelease && (
          <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              className="bg-card-white w-full max-w-md p-6 rounded-t-3xl sm:rounded-3xl shadow-2xl"
            >
              <h3 className="text-lg font-bold text-ink mb-4">成交轉讓釋出扭蛋</h3>
              <p className="text-sm text-ink/60 mb-4">將 {transferringRelease.machineName} 轉讓給：</p>
              <SuggestiveInput 
                value={targetCustomerName}
                onChange={setTargetCustomerName}
                placeholder="輸入顧客名稱..."
                suggestions={getCustomerNameSuggestions(customers)}
              />
              <div className="flex gap-2 pt-6">
                <button onClick={() => {
                  setTransferringRelease(null);
                  setTargetCustomerName('');
                }} className="flex-1 py-4 bg-background text-ink rounded-2xl font-bold">取消</button>
                <button onClick={handleReleaseTransfer} className="flex-1 py-4 bg-primary-blue text-white rounded-2xl font-bold flex items-center justify-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  確認轉讓
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const SettingsView = ({ 
  settings, 
  showToast,
  setConfirmModal,
  exportData,
  importData,
  importPreview,
  confirmImport,
  clearImportPreview,
  importInProgress,
  driveStatus,
  operationLogs,
  restoreFromLog,
  googleClientId,
  connectGoogleDrive,
  logoutGoogleDrive,
  uploadDriveData,
  downloadDriveData,
  refreshDriveBackups
}: { 
  settings: SystemSettings | null, 
  showToast: (m: string, t?: 'success' | 'error') => void,
  setConfirmModal: (m: any) => void,
  exportData: () => Promise<void>,
  importData: (e: React.ChangeEvent<HTMLInputElement>) => void,
  importPreview: PreparedImport | null,
  confirmImport: () => void,
  clearImportPreview: () => void,
  importInProgress: boolean,
  driveStatus: DriveBackupStatus,
  operationLogs: OperationLog[],
  restoreFromLog: (log: OperationLog, mode?: 'restore' | 'undo') => void,
  googleClientId: string,
  connectGoogleDrive: () => void,
  logoutGoogleDrive: () => void,
  uploadDriveData: (force?: boolean) => Promise<void>,
  downloadDriveData: () => void,
  refreshDriveBackups: () => void
}) => {
  const [template, setTemplate] = useState(settings?.notificationTemplate || '');
  const [priceMap, setPriceMap] = useState<Record<number, any>>(settings?.priceMap || DEFAULT_PRICE_MAP);
  const [newJpy, setNewJpy] = useState('');
  const [newTwd, setNewTwd] = useState('');
  const [operationLogQuery, setOperationLogQuery] = useState('');
  const [operationLogType, setOperationLogType] = useState('all');

  useEffect(() => {
    if (settings) {
      setTemplate(settings.notificationTemplate || '');
      setPriceMap(settings.priceMap || DEFAULT_PRICE_MAP);
    }
  }, [settings]);

  useEffect(() => {
    if (googleClientId) {
      loadGoogleIdentityScript().catch(() => {});
    }
  }, [googleClientId]);

  const saveSettings = async () => {
    try {
      const cleanedPriceMap: Record<number, number> = {};
      Object.entries(priceMap).forEach(([k, v]) => {
        const numV = parseInt(v as string);
        if (!isNaN(numV)) cleanedPriceMap[parseInt(k)] = numV;
      });

      showToast('設定已儲存');
      await setDoc(dbDoc('settings', 'global'), {
        notificationTemplate: template,
        priceMap: cleanedPriceMap
      }, { merge: true });
      await addOperationLog('settings_update', 'settings', '設定已更新');
    } catch (err) {
      handleLocalDataError(err, OperationType.WRITE, 'settings/global');
    }
  };

  const addPriceMapping = () => {
    const jpy = parseInt(newJpy);
    const twd = parseInt(newTwd);
    if (isNaN(jpy) || isNaN(twd)) return;
    setPriceMap({ ...priceMap, [jpy]: twd });
    setNewJpy('');
    setNewTwd('');
  };

  const removePriceMapping = (jpy: number) => {
    const newMap = { ...priceMap };
    delete newMap[jpy];
    setPriceMap(newMap);
  };

  const clearAllData = async () => {
    setConfirmModal({
      show: true,
      title: '刪除全部資料',
      message: '確定要刪除所有訂單、機台、顧客與釋出資料嗎？系統會先建立本機 JSON 安全備份；若已登入 Google Drive，也會先嘗試建立雲端安全備份。通知範本、價格設定與操作紀錄會保留，可從操作紀錄復原。',
      type: 'danger',
      checkboxLabel: '我確認已理解：刪除前會建立安全備份，但仍要清空目前資料',
      onConfirm: async (checked?: boolean) => {
        if (!checked) {
          showToast('已取消刪除：需要勾選確認才會清空資料', 'error');
          return;
        }
        try {
          const undoSnapshot = await createRestoreSnapshot();
          await exportData();
          if (googleClientId && driveStatus.connected) {
            await uploadDriveData(false);
          }
          const collections = ['orders', 'machines', 'customers', 'releases'];
          for (const colName of collections) {
            const snapshot = await getDocs(col(colName));
            let currentPromises: Promise<void>[] = [];
            for (const doc of snapshot.docs) {
              currentPromises.push(deleteDoc(doc.ref));
              if (currentPromises.length >= 100) {
                await Promise.all(currentPromises);
                currentPromises = [];
              }
            }
            if (currentPromises.length > 0) {
              await Promise.all(currentPromises);
            }
          }
          window.dispatchEvent(new CustomEvent('cuibo-clear-local-data'));
          await addOperationLog('clear_data', 'system', '已刪除全部資料，刪除前已建立安全備份', undefined, {
            undoSnapshot,
            safetyBackup: true,
            driveBackupAttempted: Boolean(googleClientId && driveStatus.connected)
          });
          showToast('全部資料已清除，刪除前已建立安全備份');
        } catch (err: any) {
          showToast(`清除失敗：${getActionableErrorMessage(err)}`, 'error');
          handleLocalDataError(err, OperationType.DELETE, 'multiple_collections');
        }
      }
    });
  };

  const filteredOperationLogs = operationLogs.filter(log => {
    const typeMatched = operationLogType === 'all' || log.action === operationLogType || log.targetType === operationLogType;
    const keyword = operationLogQuery.trim().toLowerCase();
    const keywordMatched = !keyword || [
      log.message,
      log.action,
      log.targetType,
      log.targetName,
      JSON.stringify(log.details || {})
    ].some(value => String(value || '').toLowerCase().includes(keyword));
    return typeMatched && keywordMatched;
  });

  const operationLogLabelMap: Record<string, string> = {
    restore: '還原資料',
    undo: '復原操作',
    import: '匯入備份',
    backup: '備份',
    backup_export: '匯出本機備份',
    backup_upload: '上傳雲端備份',
    local_file: '本機檔案',
    google_drive: 'Google 雲端',
    operationLog: '操作紀錄',
    order_create: '新增訂單',
    order_delete: '刪除訂單',
    order_item_delete: '刪除訂單項目',
    order: '訂單',
    machine_create: '建立機台',
    machine_update: '修改機台',
    machine_delete: '刪除機台',
    machine: '機台',
    customer_delete: '刪除顧客',
    customer_alias_update: '修改顧客別名',
    customer_rename: '顧客改名',
    customer: '顧客',
    release_create: '建立釋出',
    release_cancel: '取消釋出',
    release_transfer: '釋出成交轉讓',
    release: '釋出',
    transfer: '轉讓',
    exchange: '交換',
    settings_update: '修改設定',
    settings: '設定',
    clear_data: '清空資料',
    system: '系統'
  };
  const getOperationLogLabel = (value?: string) => value ? (operationLogLabelMap[value] || value) : '';
  const operationTypes = Array.from(new Set(operationLogs.flatMap(log => [log.action, log.targetType]).filter(Boolean)));

  return (
    <div className="space-y-6 pb-20">
      <div className="bg-card-white p-6 rounded-3xl card-shadow">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest flex items-center gap-2">
            <MessageSquare className="w-4 h-4" /> 通知範本設定
          </h3>
          <button onClick={saveSettings} className="px-3 py-1 bg-primary-blue text-white rounded-lg text-sm font-bold shadow-sm">儲存</button>
        </div>
        <textarea 
          className="w-full h-40 p-4 bg-background rounded-2xl border-none focus:ring-2 focus:ring-primary-blue text-sm font-medium leading-relaxed"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          onBlur={saveSettings}
          placeholder="輸入通知範本..."
        />
        <div className="mt-4 p-4 bg-background rounded-xl">
          <p className="text-[10px] font-bold text-ink/30 uppercase mb-2">可用變數</p>
          <div className="flex flex-wrap gap-2">
            {['{orderId}', '{customerName}', '{items}', '{totalAmount}'].map(v => (
              <code key={v} className="px-2 py-1 bg-card-white rounded text-[10px] font-bold text-primary-blue">{v}</code>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-card-white p-6 rounded-3xl card-shadow">
        <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Coins className="w-4 h-4" /> 價格對照表 (JPY → TWD)
        </h3>
        <div className="space-y-3 mb-6">
          {Object.entries(priceMap).sort(([a], [b]) => parseInt(a) - parseInt(b)).map(([jpy, twd]) => (
            <div key={jpy} className="flex items-center justify-between p-3 bg-background rounded-xl">
              <div className="flex items-center gap-4 flex-1">
                <span className="text-sm font-bold text-ink/40 w-12 text-right">¥{jpy}</span>
                <ArrowRight className="w-4 h-4 text-ink/20" />
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-ink">NT$</span>
                  <input 
                    type="number" 
                    value={twd}
                    onChange={(e) => setPriceMap({ ...priceMap, [parseInt(jpy)]: e.target.value })}
                    className="w-20 px-2 py-1 bg-card-white rounded-lg border-none text-sm font-bold text-ink focus:ring-2 focus:ring-primary-blue"
                  />
                </div>
              </div>
              <button onClick={() => removePriceMapping(parseInt(jpy))} className="text-ink/20 hover:text-red-500 ml-4">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input 
            type="number" 
            placeholder="日幣 (¥)" 
            value={newJpy}
            onChange={(e) => setNewJpy(e.target.value)}
            className="flex-1 px-4 py-3 bg-background rounded-xl border-none text-sm font-bold"
          />
          <input 
            type="number" 
            placeholder="台幣 ($)" 
            value={newTwd}
            onChange={(e) => setNewTwd(e.target.value)}
            className="flex-1 px-4 py-3 bg-background rounded-xl border-none text-sm font-bold"
          />
          <button 
            onClick={addPriceMapping}
            className="px-4 py-3 bg-ink text-white rounded-xl font-bold text-sm"
          >
            新增
          </button>
        </div>
      </div>

      <button 
        onClick={saveSettings}
        className="w-full py-4 bg-primary-blue text-white rounded-2xl font-bold shadow-lg shadow-primary-blue/20"
      >
        儲存所有設定
      </button>

      <div className="bg-card-white p-6 rounded-3xl card-shadow">
        <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4">系統維護</h3>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={exportData} className="p-4 bg-background rounded-2xl flex flex-col items-center gap-2 text-ink/60 hover:bg-ink/5 transition-colors">
            <Download className="w-5 h-5" />
            <span className="text-[10px] font-bold">匯出資料</span>
          </button>
          
          <label className="p-4 bg-background rounded-2xl flex flex-col items-center gap-2 text-ink/60 hover:bg-ink/5 transition-colors cursor-pointer">
            <Upload className="w-5 h-5" />
            <span className="text-[10px] font-bold">匯入資料</span>
            <input type="file" accept=".json" className="hidden" onChange={importData} />
          </label>
          <button 
            onClick={clearAllData}
            className="p-4 bg-background rounded-2xl flex flex-col items-center gap-2 text-red-500/60 hover:bg-red-500/5 transition-colors"
          >
            <Database className="w-5 h-5" />
            <span className="text-[10px] font-bold">刪除全部資料</span>
          </button>
        </div>
        {importPreview && (
          <div className="mt-4 rounded-2xl bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-all text-sm font-bold text-ink">{importPreview.fileName}</p>
                <p className="mt-1 text-xs text-ink/50">{formatFileSize(importPreview.fileSize)}</p>
              </div>
              <button
                onClick={clearImportPreview}
                className="rounded-xl bg-card-white px-3 py-2 text-xs font-bold text-ink/60"
              >
                清除
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <div className="rounded-xl bg-card-white p-3"><p className="text-[10px] font-bold text-ink/40">顧客</p><p className="text-sm font-bold text-ink">{importPreview.counts.customers}</p></div>
              <div className="rounded-xl bg-card-white p-3"><p className="text-[10px] font-bold text-ink/40">訂單</p><p className="text-sm font-bold text-ink">{importPreview.counts.orders}</p></div>
              <div className="rounded-xl bg-card-white p-3"><p className="text-[10px] font-bold text-ink/40">機台</p><p className="text-sm font-bold text-ink">{importPreview.counts.machines}</p></div>
              <div className="rounded-xl bg-card-white p-3"><p className="text-[10px] font-bold text-ink/40">釋出</p><p className="text-sm font-bold text-ink">{importPreview.counts.releases}</p></div>
              <div className="rounded-xl bg-card-white p-3"><p className="text-[10px] font-bold text-ink/40">圖片</p><p className="text-sm font-bold text-ink">{importPreview.counts.images}</p></div>
            </div>
            {importPreview.warnings.length > 0 && (
              <div className="mt-4 space-y-2">
                {importPreview.warnings.map((warning) => (
                  <div key={warning} className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                    {warning}
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={confirmImport}
              disabled={importInProgress}
              className="mt-4 w-full rounded-2xl bg-primary-blue py-4 font-bold text-white shadow-lg shadow-primary-blue/20 disabled:opacity-60"
            >
              {importInProgress ? '匯入中...' : '開始匯入'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-card-white p-6 rounded-3xl card-shadow">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest">Google Drive 備份</h3>
            <p className="mt-1 text-xs font-medium text-ink/45">
              上傳會建立新版本，不會覆蓋舊備份；下載會先讀取成匯入預覽，確認後才會覆蓋本地資料。
            </p>
          </div>
          <button
            onClick={refreshDriveBackups}
            disabled={driveStatus.loading}
            className="rounded-xl bg-background p-3 text-ink/50 hover:text-ink disabled:opacity-50"
            title="重新讀取雲端備份"
          >
            <RefreshCw className={cn('w-4 h-4', driveStatus.loading && 'animate-spin')} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={connectGoogleDrive}
            disabled={driveStatus.loading || !googleClientId}
            className="p-4 bg-background rounded-2xl flex flex-col items-center gap-2 text-ink/60 hover:bg-ink/5 transition-colors disabled:opacity-50"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-[10px] font-bold">{driveStatus.connected ? '已連線雲端' : '登入雲端'}</span>
          </button>
          <button
            onClick={logoutGoogleDrive}
            disabled={driveStatus.loading || !driveStatus.connected}
            className="p-4 bg-background rounded-2xl flex flex-col items-center gap-2 text-red-500/60 hover:bg-red-500/5 transition-colors disabled:opacity-50"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-[10px] font-bold">登出雲端</span>
          </button>
          <button
            onClick={() => uploadDriveData(false)}
            disabled={driveStatus.loading || !googleClientId}
            className="p-4 bg-background rounded-2xl flex flex-col items-center gap-2 text-ink/60 hover:bg-ink/5 transition-colors disabled:opacity-50"
          >
            <Upload className="w-5 h-5" />
            <span className="text-[10px] font-bold">上傳雲端備份</span>
          </button>
          <button
            onClick={downloadDriveData}
            disabled={driveStatus.loading || !googleClientId}
            className="p-4 bg-background rounded-2xl flex flex-col items-center gap-2 text-ink/60 hover:bg-ink/5 transition-colors disabled:opacity-50"
          >
            <Download className="w-5 h-5" />
            <span className="text-[10px] font-bold">下載雲端備份</span>
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-background p-4">
          <p className="text-[10px] font-bold text-ink/35 uppercase">雲端狀態</p>
          <p className="mt-1 text-sm font-bold text-ink">
            {driveStatus.loading ? '處理中...' : driveStatus.message}
          </p>
          {driveStatus.latest && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <div className="rounded-xl bg-card-white p-3"><p className="text-[10px] font-bold text-ink/40">顧客</p><p className="text-sm font-bold text-ink">{parseCounts(driveStatus.latest)?.customers ?? '-'}</p></div>
              <div className="rounded-xl bg-card-white p-3"><p className="text-[10px] font-bold text-ink/40">訂單</p><p className="text-sm font-bold text-ink">{parseCounts(driveStatus.latest)?.orders ?? '-'}</p></div>
              <div className="rounded-xl bg-card-white p-3"><p className="text-[10px] font-bold text-ink/40">機台</p><p className="text-sm font-bold text-ink">{parseCounts(driveStatus.latest)?.machines ?? '-'}</p></div>
              <div className="rounded-xl bg-card-white p-3"><p className="text-[10px] font-bold text-ink/40">釋出</p><p className="text-sm font-bold text-ink">{parseCounts(driveStatus.latest)?.releases ?? '-'}</p></div>
              <div className="rounded-xl bg-card-white p-3"><p className="text-[10px] font-bold text-ink/40">圖片</p><p className="text-sm font-bold text-ink">{parseCounts(driveStatus.latest)?.images ?? '-'}</p></div>
            </div>
          )}
          {driveStatus.latest?.createdTime && (
            <p className="mt-3 text-xs font-medium text-ink/45">最新雲端備份：{formatDateTime(driveStatus.latest.createdTime)}</p>
          )}
        </div>
      </div>

      <div className="bg-card-white p-6 rounded-3xl card-shadow">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest">操作紀錄</h3>
          <span className="rounded-lg bg-background px-2 py-1 text-[10px] font-bold text-ink/40">
            顯示 {Math.min(filteredOperationLogs.length, 50)} / {operationLogs.length} 筆
          </span>
        </div>
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
            <input
              value={operationLogQuery}
              onChange={(e) => setOperationLogQuery(e.target.value)}
              placeholder="搜尋顧客、機台、款式、操作內容..."
              className="w-full rounded-2xl border-none bg-background py-3 pl-10 pr-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary-blue"
            />
          </div>
          <select
            value={operationLogType}
            onChange={(e) => setOperationLogType(e.target.value)}
            className="rounded-2xl border-none bg-background px-4 py-3 text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-primary-blue"
          >
            <option value="all">全部操作</option>
            {operationTypes.map(type => (
              <option key={type} value={type}>{getOperationLogLabel(type)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {operationLogs.length === 0 ? (
            <p className="rounded-2xl bg-background p-4 text-center text-sm font-medium text-ink/30">目前沒有操作紀錄</p>
          ) : filteredOperationLogs.length === 0 ? (
            <p className="rounded-2xl bg-background p-4 text-center text-sm font-medium text-ink/30">找不到符合條件的操作紀錄</p>
          ) : (
            filteredOperationLogs.slice(0, 50).map(log => (
              <div key={log.id} className="rounded-2xl bg-background p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-bold text-ink">{log.message}</p>
                    <p className="mt-1 text-[10px] font-bold tracking-wide text-ink/35">
                      {getOperationLogLabel(log.action)} / {getOperationLogLabel(log.targetType)}
                      {log.details?.restorePointExpired ? ' / 還原點已過期' : ''}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-2">
                    <span className="text-xs font-bold text-ink/40">{formatDateTime(log.createdAt)}</span>
                    {log.details?.undoSnapshot && (
                      <button
                        onClick={() => restoreFromLog(log, 'undo')}
                        className="rounded-lg bg-orange-500 px-3 py-1.5 text-[10px] font-bold text-white"
                      >
                        復原此操作
                      </button>
                    )}
                    {log.details?.restoreSnapshot ? (
                      <button
                        onClick={() => restoreFromLog(log, 'restore')}
                        className="rounded-lg bg-primary-blue px-3 py-1.5 text-[10px] font-bold text-white"
                      >
                        還原到這裡
                      </button>
                    ) : !log.details?.undoSnapshot ? (
                      <span className="rounded-lg bg-card-white px-3 py-1.5 text-[10px] font-bold text-ink/30">不可還原</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

const formatDateTime = (dateStr?: string) => {
  if (!dateStr) return '未知時間';
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('create');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editingMachine, setEditingMachine] = useState<any | null>(null);
  
  // Data State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [releases, setReleases] = useState<any[]>([]);
  const [operationLogs, setOperationLogs] = useState<OperationLog[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [importPreview, setImportPreview] = useState<PreparedImport | null>(null);
  const [importInProgress, setImportInProgress] = useState(false);
  const [driveStatus, setDriveStatus] = useState<DriveBackupStatus>({
    connected: false,
    loading: false,
    latest: null,
    files: [],
    message: getGoogleClientId() ? '尚未連線 Google Drive' : '尚未設定 Google OAuth Client ID'
  });
  const [googleClientId, setGoogleClientId] = useState(() => getGoogleClientId());
  
  // UI State
  const [isPrinting, setIsPrinting] = useState(false);

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    checkboxLabel?: string;
    onConfirm: (checked?: boolean) => void;
    type: 'danger' | 'info';
  }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'info'
  });
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success'
  });
  const printRef = useRef<HTMLDivElement>(null);

  const handleSaveEditedMachine = async (data: any, oldName: string, variantMapping: Record<string, string>, syncWithOrders: boolean = true) => {
    const now = new Date().toISOString();
    const updateData = {
      name: data.name,
      defaultPrice: data.defaultPrice,
      variants: data.variants,
      variantDetails: normalizeVariantDetails(data.variants || [], data.variantDetails),
      imageUrl: data.imageUrl,
      updatedAt: now
    };

    try {
      const undoSnapshot = await createRestoreSnapshot();
      const batch = writeBatch(db);
      
      if (data.id) {
        batch.update(dbDoc('machines', data.id), updateData);
      } else {
        const newDocRef = dbDoc('machines');
        batch.set(newDocRef, { ...updateData, createdAt: now });
      }

      if (syncWithOrders) {
        const nameToMatch = oldName || data.name;
        const affectedOrders = orders.filter(o => o.items.some(i => i.machineName === nameToMatch));
        
        const customerDiffs: Record<string, number> = {};

        affectedOrders.forEach(order => {
          let changed = false;
          const newItems = order.items.map(item => {
            if (item.machineName === nameToMatch) {
              changed = true;
              const itemPrice = (settings?.priceMap?.[data.defaultPrice] || DEFAULT_PRICE_MAP[data.defaultPrice] || 0) + (item.variant?.includes('(環保)') ? 10 : 0);
              
              let newVariantName = item.variant;
              if (item.variant) {
                const isEco = item.variant.includes('(環保)');
                const baseVariant = item.variant.replace(' (環保)', '').replace('(環保)', '').trim();
                if (variantMapping[baseVariant]) {
                  newVariantName = variantMapping[baseVariant] + (isEco ? ' (環保)' : '');
                }
              }

              return { 
                ...item, 
                machineName: data.name,
                price: itemPrice,
                variant: newVariantName,
                subtotal: itemPrice * item.quantity
              };
            }
            return item;
          });
          
          if (changed) {
            const newTotalAmount = newItems.reduce((sum, i) => sum + i.subtotal, 0);
            const diff = newTotalAmount - order.totalAmount;
            if (diff !== 0) {
              customerDiffs[order.customerId] = (customerDiffs[order.customerId] || 0) + diff;
            }
            batch.update(dbDoc('orders', order.id), { 
              items: newItems,
              totalAmount: newTotalAmount,
              customerName: order.customerName,
              updatedAt: now
            });
          }
        });

        Object.entries(customerDiffs).forEach(([customerId, diff]) => {
          batch.update(dbDoc('customers', customerId), {
            totalSpent: increment(diff)
          });
        });
      }

      await batch.commit();
      await addOperationLog('machine_update', 'machine', `${oldName || data.name} 機台設定已更新`, data.name, {
        undoSnapshot,
        oldName,
        newName: data.name,
        variants: data.variants,
        syncWithOrders
      });
      showToast(syncWithOrders ? '機台設定與訂單已同步更新' : '機台設定已儲存');
      setEditingMachine(null);
    } catch (err: any) {
      if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
        showToast('儲存失敗：資料庫免費額度已滿', 'error');
      } else {
        showToast('儲存失敗', 'error');
      }
      setEditingMachine(null);
      handleLocalDataError(err, OperationType.WRITE, 'machines_sync');
    }
  };

  const handleDeleteMachine = (machineId: string, machineName: string) => {
    setConfirmModal({
      show: true,
      title: '刪除機台',
      message: `確定要刪除「${machineName}」嗎？`,
      checkboxLabel: '同時刪除包含此機台的所有訂單',
      type: 'danger',
      onConfirm: async (checked?: boolean) => {
        try {
          const undoSnapshot = await createRestoreSnapshot();
          const batch = writeBatch(db);
          batch.delete(dbDoc('machines', machineId));

          if (checked) {
            const affectedOrders = orders.filter(o => o.items.some(i => i.machineName === machineName));
            const customerDiffs: Record<string, { spent: number, items: number }> = {};

            affectedOrders.forEach(order => {
              const isOnlyItem = order.items.every(i => i.machineName === machineName);
              if (isOnlyItem) {
                batch.delete(dbDoc('orders', order.id));
                customerDiffs[order.customerId] = customerDiffs[order.customerId] || { spent: 0, items: 0 };
                customerDiffs[order.customerId].spent -= order.totalAmount;
                customerDiffs[order.customerId].items -= order.items.reduce((s, i) => s + i.quantity, 0);
              } else {
                const newItems = order.items.filter(i => i.machineName !== machineName);
                const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);
                const diffSpent = newTotal - order.totalAmount;
                const diffItems = newItems.reduce((s, i) => s + i.quantity, 0) - order.items.reduce((s, i) => s + i.quantity, 0);
                
                batch.update(dbDoc('orders', order.id), {
                  items: newItems,
                  totalAmount: newTotal
                });

                customerDiffs[order.customerId] = customerDiffs[order.customerId] || { spent: 0, items: 0 };
                customerDiffs[order.customerId].spent += diffSpent;
                customerDiffs[order.customerId].items += diffItems;
              }
            });

            Object.entries(customerDiffs).forEach(([customerId, diffs]) => {
              batch.update(dbDoc('customers', customerId), {
                totalSpent: increment(diffs.spent),
                totalItems: increment(diffs.items)
              });
            });
          }

          await batch.commit();
          await addOperationLog('machine_delete', 'machine', `已刪除機台：${machineName}`, machineName, {
            undoSnapshot,
            deleteRelatedOrders: Boolean(checked)
          });
          showToast('機台已刪除');
          setEditingMachine(null);
        } catch (err: any) {
          if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
            showToast('刪除失敗：資料庫免費額度已滿', 'error');
          } else {
            showToast('刪除失敗', 'error');
          }
          setEditingMachine(null);
          handleLocalDataError(err, OperationType.DELETE, `machines/${machineId}`);
        }
      }
    });
  };

  useEffect(() => {
    if (selectedCustomer) {
      const updated = customers.find(c => c.id === selectedCustomer.id);
      if (updated) setSelectedCustomer(updated);
    }
  }, [customers]);

  useEffect(() => {
    const clearLocalDataState = () => {
      setCustomers([]);
      setOrders([]);
      setMachines([]);
      setReleases([]);
      setSelectedCustomer(null);
      setSelectedOrder(null);
      setEditingMachine(null);
    };
    window.addEventListener('cuibo-clear-local-data', clearLocalDataState);
    return () => window.removeEventListener('cuibo-clear-local-data', clearLocalDataState);
  }, []);

  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ show: true, message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(t => ({ ...t, show: false })), 3000);
  }, []);

  useEffect(() => {
    if (googleClientId) {
      loadGoogleIdentityScript().catch(() => {});
      const token = getStoredDriveToken();
      if (token) {
        setDriveStatus(prev => ({ ...prev, connected: true, message: 'Google Drive 已登入，可直接備份' }));
      }
    }
  }, [googleClientId]);

  const connectGoogleDrive = useCallback(async () => {
    if (!googleClientId) {
      showToast('尚未設定 Google OAuth Client ID', 'error');
      return;
    }
    setDriveStatus(prev => ({ ...prev, loading: true, message: '正在登入 Google Drive...' }));
    try {
      const token = getStoredDriveToken() || await requestGoogleDriveToken();
      await validateDriveToken(token);
      setDriveStatus(prev => ({ ...prev, connected: true, loading: false, message: 'Google Drive 已登入，可直接備份' }));
      showToast('Google Drive 已登入');
    } catch (err) {
      if (isDrivePopupError(err)) {
        startGoogleDriveRedirect('refresh');
        return;
      }
      clearDriveToken();
      const message = getDriveErrorMessage(err);
      setDriveStatus(prev => ({ ...prev, connected: false, loading: false, message }));
      showToast(`Google Drive 登入失敗：${message}`, 'error');
    }
  }, [googleClientId, showToast]);

  const logoutGoogleDrive = useCallback(() => {
    clearDriveToken();
    setDriveStatus(prev => ({
      ...prev,
      connected: false,
      latest: null,
      files: [],
      message: 'Google Drive 已登出'
    }));
    showToast('Google Drive 已登出');
  }, [showToast]);

  // --- Auth & Data Sync ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const safeDocs = (snap: any) => Array.isArray(snap?.docs) ? snap.docs : [];

    const unsubCustomers = onSnapshot(query(col('customers'), orderBy('createdAt', 'desc')), (snap) => {
      setCustomers(safeDocs(snap).map(d => normalizeCustomer(d.id, d.data())));
    }, (err) => handleLocalDataError(err, OperationType.LIST, 'customers'));

    const unsubOrders = onSnapshot(query(col('orders'), orderBy('createdAt', 'desc')), (snap) => {
      setOrders(safeDocs(snap).map(d => normalizeOrder(d.id, d.data())));
    }, (err) => handleLocalDataError(err, OperationType.LIST, 'orders'));

    const unsubMachines = onSnapshot(query(col('machines'), orderBy('name', 'asc')), (snap) => {
      setMachines(safeDocs(snap).map(d => normalizeMachine(d.id, d.data())));
    }, (err) => handleLocalDataError(err, OperationType.LIST, 'machines'));

    const unsubReleases = onSnapshot(query(col('releases'), orderBy('createdAt', 'desc')), (snap) => {
      setReleases(safeDocs(snap).map(d => normalizeRelease(d.id, d.data())));
    }, (err) => handleLocalDataError(err, OperationType.LIST, 'releases'));

    const unsubOperationLogs = onSnapshot(query(col('operationLogs'), orderBy('createdAt', 'desc')), (snap) => {
      setOperationLogs(safeDocs(snap).map(d => normalizeOperationLog(d.id, d.data())).slice(0, 100));
    }, (err) => handleLocalDataError(err, OperationType.LIST, 'operationLogs'));

    const unsubSettings = onSnapshot(dbDoc('settings', 'global'), (snap) => {
      if (snap.exists()) {
        setSettings(normalizeSettings(snap.id, snap.data()));
      } else {
        // Initialize default settings
        const defaultSettings: Omit<SystemSettings, 'id'> = {
          notificationTemplate: DEFAULT_NOTIFICATION_TEMPLATE,
          priceMap: DEFAULT_PRICE_MAP,
          lastBackupAt: new Date().toISOString()
        };
        setDoc(dbDoc('settings', 'global'), defaultSettings).catch(err => handleLocalDataError(err, OperationType.WRITE, 'settings/global'));
      }
    }, (err) => handleLocalDataError(err, OperationType.GET, 'settings/global'));

    return () => {
      unsubCustomers();
      unsubOrders();
      unsubMachines();
      unsubReleases();
      unsubOperationLogs();
      unsubSettings();
    };
  }, [user]);

  // --- Handlers ---
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    onBeforePrint: async () => setIsPrinting(true),
    onAfterPrint: () => setIsPrinting(false),
  });

  const groupItemsHelper = (items: OrderItem[]) => {
    const grouped: OrderItem[] = [];
    items.forEach(item => {
      const existing = grouped.find(g => 
        g.machineName === item.machineName && 
        (g.variant || '') === (item.variant || '') && 
        g.price === item.price
      );
      if (existing) {
        existing.quantity += item.quantity;
        existing.subtotal += item.subtotal;
      } else {
        grouped.push({ ...item });
      }
    });

    // 按照同樣名稱的機台排序 然後按照時間由舊到新排序
    grouped.sort((a, b) => {
      if (a.machineName === b.machineName) {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      }
      return a.machineName.localeCompare(b.machineName, 'zh-Hant');
    });

    return grouped;
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  const copyCustomerNotification = async (customer: Customer) => {
    const notificationTemplate = settings?.notificationTemplate || DEFAULT_NOTIFICATION_TEMPLATE;
    
    const customerOrders = orders.filter(o => o.customerId === customer.id);
    const allItems = groupItemsHelper(customerOrders.flatMap(o => o.items));
    
    const itemsText = allItems.map(i => `${i.machineName} ${i.variant ? `(${i.variant})` : ''} x ${i.quantity} $${i.subtotal}`).join('\n');
    
    let text = notificationTemplate;
    if (text && (text.includes('{customerName}') || text.includes('{items}') || text.includes('{totalAmount}'))) {
      text = text.replace(/{customerName}/g, customer.name);
      text = text.replace(/{items}/g, itemsText);
      text = text.replace(/{totalAmount}/g, customer.totalSpent.toLocaleString());
      text = text.replace(/{orderId}/g, customerOrders.map(o => o.id).join(', '));
    } else {
      const upperPart = `親愛的 ${customer.name} 您好，\n您本次的連線購物明細如下：\n\n${itemsText}\n----------------\n消費總額：$${customer.totalSpent.toLocaleString()}`;
      text = text ? `${upperPart}\n\n${text}` : upperPart;
    }
    
    await copyText(text);
    showToast('已複製通知文字！');
  };

  const copyNotification = async (order: Order) => {
    const notificationTemplate = settings?.notificationTemplate || DEFAULT_NOTIFICATION_TEMPLATE;
    
    const groupedItems = groupItemsHelper(order.items);
    const itemsText = groupedItems.map(i => `${i.machineName} ${i.variant ? `(${i.variant})` : ''} x ${i.quantity} $${i.subtotal}`).join('\n');
    
    let text = notificationTemplate;
    if (text && (text.includes('{customerName}') || text.includes('{items}') || text.includes('{totalAmount}'))) {
      text = text.replace(/{customerName}/g, order.customerName);
      text = text.replace(/{items}/g, itemsText);
      text = text.replace(/{totalAmount}/g, order.totalAmount.toLocaleString());
      text = text.replace(/{orderId}/g, order.id);
    } else {
      const upperPart = `親愛的 ${order.customerName} 您好，\n您本次的連線購物明細如下：\n\n${itemsText}\n----------------\n消費總額：$${order.totalAmount.toLocaleString()}`;
      text = text ? `${upperPart}\n\n${text}` : upperPart;
    }
    
    await copyText(text);
    showToast('已複製通知文字！');
  };

  const buildBackupData = async (): Promise<BackupPayload> => {
    const exportedAt = new Date().toISOString();
    const basePayload = { customers, orders, settings, machines, releases, operationLogs, exportedAt };
    const dataHash = await sha256(buildHashInput(basePayload));
    return {
      ...basePayload,
      backupMeta: {
        app: 'cuibo-gasha',
        backupVersion: 1,
        deviceId: getDeviceId(),
        dataHash,
        counts: getBackupCounts(customers, orders, machines, releases, operationLogs)
      }
    };
  };

  const exportData = async () => {
    const data = await buildBackupData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cuibo_gasha_backup_${format(toZonedTime(new Date(), TAIWAN_TZ), 'yyyyMMdd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const now = new Date().toISOString();
    await setDoc(dbDoc('settings', 'global'), { lastBackupAt: now }, { merge: true });
    await addOperationLog('backup_export', 'local_file', '已匯出本機 JSON 備份', a.download, data.backupMeta.counts);
  };

  const refreshDriveBackups = useCallback(async (tokenOverride?: string, allowRedirectRetry = true) => {
    if (!googleClientId) {
      setDriveStatus(prev => ({ ...prev, message: '尚未設定 Google OAuth Client ID' }));
      return;
    }
    setDriveStatus(prev => ({ ...prev, loading: true, message: '正在讀取 Google Drive 備份...' }));
    try {
      const token = tokenOverride || getStoredDriveToken() || await requestGoogleDriveToken();
      await validateDriveToken(token);
      storeDriveToken(token);
      const files = await listDriveBackups(token);
      setDriveStatus({
        connected: true,
        loading: false,
        latest: files[0] || null,
        files,
        message: files[0] ? `已找到 ${files.length} 份雲端備份` : 'Google Drive 尚無備份'
      });
    } catch (err) {
      if (isDrivePopupError(err)) {
        startGoogleDriveRedirect('refresh');
        return;
      }
      if (allowRedirectRetry && isDriveAuthError(err)) {
        clearDriveToken();
        showToast('Google 授權已失效，正在重新授權', 'error');
        startGoogleDriveRedirect('refresh');
        return;
      }
      const message = getDriveErrorMessage(err);
      setDriveStatus(prev => ({ ...prev, loading: false, message }));
      showToast(`雲端備份讀取失敗：${message}`, 'error');
    }
  }, [googleClientId]);

  const uploadDriveData = useCallback(async (force = false, tokenOverride?: string, allowRedirectRetry = true) => {
    if (!googleClientId) {
      showToast('尚未設定 Google OAuth Client ID', 'error');
      return;
    }

    const localCounts = getBackupCounts(customers, orders, machines, releases, operationLogs);
    const cloudCounts = parseCounts(driveStatus.latest);
    if (!force && localCounts.totalRecords === 0 && (cloudCounts?.totalRecords || 0) > 0) {
      setConfirmModal({
        show: true,
        title: '阻擋空白備份上傳',
        message: '目前本地資料是空的，但 Google Drive 已經有非空白備份。為了避免新裝置誤把空資料當成最新備份，請確認你真的要上傳空白備份。',
        type: 'danger',
        checkboxLabel: '我確認要上傳空白備份',
        onConfirm: (checked) => {
          if (checked) uploadDriveData(true);
          else showToast('已取消空白備份上傳', 'error');
        }
      });
      return;
    }

    setDriveStatus(prev => ({ ...prev, loading: true, message: '正在上傳 Google Drive 備份...' }));
    try {
      const token = tokenOverride || getStoredDriveToken() || await requestGoogleDriveToken();
      await validateDriveToken(token);
      storeDriveToken(token);
      const payload = await buildBackupData();
      const uploaded = await uploadDriveBackup(token, payload);
      const files = await listDriveBackups(token);
      const now = new Date().toISOString();
      await setDoc(dbDoc('settings', 'global'), { lastBackupAt: now, lastDriveBackupAt: now }, { merge: true });
      await addOperationLog('backup_upload', 'google_drive', 'Google Drive 備份已上傳', uploaded.name, payload.backupMeta.counts);
      setDriveStatus({
        connected: true,
        loading: false,
        latest: files[0] || uploaded,
        files,
        message: 'Google Drive 備份已上傳'
      });
      showToast('Google Drive 備份已上傳');
    } catch (err) {
      if (isDrivePopupError(err)) {
        startGoogleDriveRedirect('upload');
        return;
      }
      if (allowRedirectRetry && isDriveAuthError(err)) {
        clearDriveToken();
        showToast('Google 授權已失效，正在重新授權', 'error');
        startGoogleDriveRedirect('upload');
        return;
      }
      const message = getDriveErrorMessage(err);
      setDriveStatus(prev => ({ ...prev, loading: false, message }));
      showToast(`雲端備份上傳失敗：${message}`, 'error');
    }
  }, [customers, orders, machines, releases, operationLogs, settings, driveStatus.latest, googleClientId]);

  const downloadDriveData = useCallback(async (tokenOverride?: string, allowRedirectRetry = true) => {
    if (!googleClientId) {
      showToast('尚未設定 Google OAuth Client ID', 'error');
      return;
    }

    setDriveStatus(prev => ({ ...prev, loading: true, message: '正在讀取 Google Drive 備份...' }));
    try {
      const token = tokenOverride || getStoredDriveToken() || await requestGoogleDriveToken();
      await validateDriveToken(token);
      storeDriveToken(token);
      const files = driveStatus.files.length > 0 ? driveStatus.files : await listDriveBackups(token);
      const latest = files[0];
      if (!latest) {
        setDriveStatus({ connected: true, loading: false, latest: null, files: [], message: 'Google Drive 尚無備份' });
        showToast('Google Drive 尚無備份', 'error');
        return;
      }

      const cloudCounts = parseCounts(latest);
      const localCounts = getBackupCounts(customers, orders, machines, releases, operationLogs);
      const localLatestAt = getLatestDataTime(customers, orders, machines, releases);
      const cloudBackupAt = latest.createdTime || latest.modifiedTime;
      const proceed = async () => {
        setDriveStatus(prev => ({ ...prev, loading: true, message: '正在下載最新雲端備份...' }));
        const data = await downloadDriveBackup(token, latest.id);
        const prepared = prepareImportPayload(data, latest.name, Number(latest.size) || JSON.stringify(data).length);
        setImportPreview(prepared);
        setDriveStatus({ connected: true, loading: false, latest, files, message: '雲端備份已下載，請確認匯入預覽' });
        showToast('雲端備份已下載，請確認後開始匯入');
      };

      if (localCounts.totalRecords > 0) {
        setDriveStatus(prev => ({ ...prev, loading: false, latest, files, message: '雲端備份已讀取，等待確認下載' }));
        setConfirmModal({
          show: true,
          title: '下載雲端備份',
          message: [
            `本地資料：${formatBackupCounts(localCounts)}。最後修改：${localLatestAt ? formatDateTime(localLatestAt) : '尚無'}。`,
            `雲端備份：${formatBackupCounts(cloudCounts)}。備份時間：${cloudBackupAt ? formatDateTime(cloudBackupAt) : '未知'}。`,
            getBackupFreshness(localLatestAt, cloudBackupAt),
            '下載後只會顯示匯入預覽，不會立刻覆蓋；按「開始匯入」才會取代目前本地資料。'
          ].join('\n'),
          type: 'info',
          onConfirm: proceed
        });
        return;
      }

      await proceed();
    } catch (err) {
      if (isDrivePopupError(err)) {
        startGoogleDriveRedirect('download');
        return;
      }
      if (allowRedirectRetry && isDriveAuthError(err)) {
        clearDriveToken();
        showToast('Google 授權已失效，正在重新授權', 'error');
        startGoogleDriveRedirect('download');
        return;
      }
      const message = getDriveErrorMessage(err);
      setDriveStatus(prev => ({ ...prev, loading: false, message }));
      showToast(`雲端備份下載失敗：${message}`, 'error');
    }
  }, [customers, orders, machines, releases, operationLogs, driveStatus.files, googleClientId]);

  const applyPreparedImport = async (prepared: PreparedImport) => {
    try {
      setImportInProgress(true);
      const undoSnapshot = await createRestoreSnapshot();
      let currentBatch = writeBatch(db);
      let operationCount = 0;

      const checkBatchLimit = async () => {
        if (operationCount >= 400) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          operationCount = 0;
        }
      };

      for (const { key, path } of IMPORT_COLLECTIONS) {
        for (const item of prepared.payload[key]) {
          const { id, ...rest } = item;
          currentBatch.set(dbDoc(path, id), rest);
          operationCount++;
          await checkBatchLimit();
        }
      }

      if (prepared.payload.settings) {
        currentBatch.set(dbDoc('settings', 'global'), prepared.payload.settings);
        operationCount++;
        await checkBatchLimit();
      }

      if (operationCount > 0) {
        await currentBatch.commit();
      }

      setCustomers(prepared.payload.customers);
      setOrders(prepared.payload.orders);
      setMachines(prepared.payload.machines);
      setReleases(prepared.payload.releases);
      setOperationLogs(prepared.payload.operationLogs);
      if (prepared.payload.settings) {
        setSettings({ id: 'global', ...prepared.payload.settings });
      }
      setImportPreview(null);
      await addOperationLog('import', 'backup', `匯入備份：${prepared.fileName}`, prepared.fileName, {
        undoSnapshot,
        ...prepared.counts
      });
      showToast('備份資料已匯入');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('quota')) {
        showToast(`匯入失敗：${getActionableErrorMessage(err)}`, 'error');
      } else {
        showToast(`匯入失敗：${getActionableErrorMessage(err)}`, 'error');
      }
      handleLocalDataError(err, OperationType.WRITE, 'batch_import');
    } finally {
      setImportInProgress(false);
    }
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        const prepared = prepareImportPayload(data, file.name, file.size);
        setImportPreview(prepared);
        showToast('備份檔已讀取，請確認後開始匯入');
      } catch (err) {
        console.error(err);
        showToast(`備份檔格式不正確：${getActionableErrorMessage(err)}`, 'error');
      }
    };
    reader.readAsText(file);
  };

  const confirmImport = () => {
    if (!importPreview) return;
    applyPreparedImport(importPreview);
  };

  const clearImportPreview = () => setImportPreview(null);

  const applyRestoreSnapshot = async (snapshot: RestoreSnapshot) => {
    let currentBatch = writeBatch(db);
    let operationCount = 0;

    const checkBatchLimit = async () => {
      if (operationCount >= 400) {
        await currentBatch.commit();
        currentBatch = writeBatch(db);
        operationCount = 0;
      }
    };

    for (const collectionName of ['customers', 'orders', 'machines', 'releases']) {
      const currentDocs = await getDocs(col(collectionName));
      for (const item of currentDocs.docs) {
        currentBatch.delete(item.ref);
        operationCount++;
        await checkBatchLimit();
      }
    }

    for (const customer of snapshot.customers || []) {
      const { id, ...rest } = customer;
      currentBatch.set(dbDoc('customers', id), rest);
      operationCount++;
      await checkBatchLimit();
    }

    for (const order of snapshot.orders || []) {
      const { id, ...rest } = order;
      currentBatch.set(dbDoc('orders', id), rest);
      operationCount++;
      await checkBatchLimit();
    }

    for (const machine of snapshot.machines || []) {
      const { id, ...rest } = machine;
      currentBatch.set(dbDoc('machines', id), rest);
      operationCount++;
      await checkBatchLimit();
    }

    for (const release of snapshot.releases || []) {
      const { id, ...rest } = release;
      currentBatch.set(dbDoc('releases', id), rest);
      operationCount++;
      await checkBatchLimit();
    }

    if (snapshot.settings) {
      currentBatch.set(dbDoc('settings', 'global'), snapshot.settings, { merge: true });
      operationCount++;
      await checkBatchLimit();
    }

    if (operationCount > 0) {
      await currentBatch.commit();
    }

    setCustomers(snapshot.customers || []);
    setOrders(snapshot.orders || []);
    setMachines(snapshot.machines || []);
    setReleases(snapshot.releases || []);
    if (snapshot.settings) {
      setSettings({ id: 'global', ...snapshot.settings });
    }
  };

  const restoreFromLog = (log: OperationLog, mode: 'restore' | 'undo' = 'restore') => {
    const snapshot = (mode === 'undo' ? log.details?.undoSnapshot : log.details?.restoreSnapshot) as RestoreSnapshot | undefined;
    if (!snapshot) {
      showToast('這筆操作紀錄沒有可用還原點', 'error');
      return;
    }

    const counts = getBackupCounts(
      snapshot.customers || [],
      snapshot.orders || [],
      snapshot.machines || [],
      snapshot.releases || []
    );

    setConfirmModal({
      show: true,
      title: mode === 'undo' ? '復原此操作' : '還原資料',
      message: `確定要${mode === 'undo' ? '復原' : '把資料還原到'}「${log.message}」${mode === 'undo' ? '這個操作之前' : '這一步'}嗎？目前資料會先自動匯出一份本機備份。還原後會變成：顧客 ${counts.customers}、訂單 ${counts.orders}、機台 ${counts.machines}、釋出 ${counts.releases}。`,
      type: 'danger',
      checkboxLabel: mode === 'undo' ? '我確認要復原此操作' : '我確認要還原到這個操作紀錄',
      onConfirm: async (checked) => {
        if (!checked) {
          showToast('已取消還原', 'error');
          return;
        }
        try {
          await exportData();
          await applyRestoreSnapshot(snapshot);
          await addOperationLog(mode === 'undo' ? 'undo' : 'restore', 'operationLog', `${mode === 'undo' ? '已復原操作' : '已還原到'}：${log.message}`, log.targetName, {
            restoredLogId: log.id,
            restoredAt: log.createdAt,
            restoreMode: mode,
            counts
          });
          showToast(mode === 'undo' ? '操作已復原' : '資料已還原');
        } catch (err) {
          console.error(err);
          showToast('還原失敗，請先檢查本機儲存空間', 'error');
        }
      }
    });
  };

  useEffect(() => {
    const redirectResult = consumeGoogleDriveRedirect();
    if (!redirectResult) return;

    showToast('Google 授權完成，正在接續雲端備份操作');
    if (redirectResult.action === 'upload') {
      uploadDriveData(false, redirectResult.token, false);
    } else if (redirectResult.action === 'download') {
      downloadDriveData(redirectResult.token, false);
    } else {
      refreshDriveBackups(redirectResult.token, false);
    }
  }, [uploadDriveData, downloadDriveData, refreshDriveBackups, showToast]);

  const clearData = async () => {
    setConfirmModal({
      show: true,
      title: '清空資料',
      message: '警告：這將清空所有顧客與訂單資料！此操作不可逆。',
      type: 'danger',
      onConfirm: async () => {
        try {
          let currentBatch = writeBatch(db);
          let operationCount = 0;

          const checkBatchLimit = async () => {
            if (operationCount >= 400) {
              await currentBatch.commit();
              currentBatch = writeBatch(db);
              operationCount = 0;
            }
          };

          for (const c of customers) {
            currentBatch.delete(dbDoc('customers', c.id));
            operationCount++;
            await checkBatchLimit();
          }
          
          for (const o of orders) {
            currentBatch.delete(dbDoc('orders', o.id));
            operationCount++;
            await checkBatchLimit();
          }
          
          if (operationCount > 0) {
            await currentBatch.commit();
          }
          showToast('資料已清空。');
        } catch (err: any) {
          if (err?.message?.toLowerCase().includes('quota') || String(err).toLowerCase().includes('quota')) {
            showToast('清空失敗：資料庫免費額度已滿', 'error');
          } else {
            showToast('清空失敗', 'error');
          }
          handleLocalDataError(err, OperationType.DELETE, 'batch_clear');
        }
      }
    });
  };

  // --- Tab Content ---
  const latestLocalAt = getLatestDataTime(customers, orders, machines, releases);
  const localBackupCounts = getBackupCounts(customers, orders, machines, releases, operationLogs);

  // --- Render Helpers ---
  if (loading) return <LoadingScreen />;
  if (!user) return <LoginScreen />;

  return (
    <ErrorBoundary>
      <div className="min-h-[100dvh] pb-24 lg:pb-0">
        <Header user={user} activeTab={activeTab} />
        
        <main className="max-w-4xl mx-auto px-6 py-8">
          <BackupStatusBanner
            latestLocalAt={latestLocalAt}
            lastBackupAt={settings?.lastBackupAt}
            lastDriveBackupAt={settings?.lastDriveBackupAt}
            localCounts={localBackupCounts}
            latestCloud={driveStatus.latest}
            driveEnabled={Boolean(googleClientId)}
            driveLoading={driveStatus.loading}
            onUpload={() => uploadDriveData(false)}
            onOpenSettings={() => setActiveTab('settings')}
          />
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'create' && (
                <CreateOrder 
                  customers={customers} 
                  orders={orders}
                  machines={machines}
                  settings={settings} 
                  setActiveTab={setActiveTab}
                  showToast={showToast}
                />
              )}
              {activeTab === 'orders' && (
                <OrdersList 
                  orders={orders} 
                  machines={machines}
                  setConfirmModal={setConfirmModal} 
                  showToast={showToast} 
                  setEditingMachine={setEditingMachine}
                />
              )}
              {activeTab === 'customers' && (
                <CustomersList 
                  customers={customers}
                  setConfirmModal={setConfirmModal}
                  showToast={showToast}
                  onSelectCustomer={setSelectedCustomer}
                  onCopyNotification={copyCustomerNotification}
                  orders={orders}
                />
              )}
              {activeTab === 'machines' && (
                <MachineManagement 
                  machines={machines} 
                  orders={orders}
                  customers={customers}
                  settings={settings}
                  showToast={showToast} 
                  setConfirmModal={setConfirmModal}
                  setEditingMachine={setEditingMachine}
                />
              )}
              {activeTab === 'print' && (
                <PrintPreview 
                  customers={customers} 
                  orders={orders} 
                  onClose={() => setActiveTab('orders')} 
                />
              )}
              {activeTab === 'dashboard' && (
                <Dashboard 
                  orders={orders} 
                  customers={customers} 
                  machines={machines}
                  releases={releases}
                  settings={settings}
                  showToast={showToast}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsView 
                  settings={settings} 
                  showToast={showToast}
                  setConfirmModal={setConfirmModal}
                  exportData={exportData}
                  importData={importData}
                  importPreview={importPreview}
                  confirmImport={confirmImport}
                  clearImportPreview={clearImportPreview}
                  importInProgress={importInProgress}
                  driveStatus={driveStatus}
                  operationLogs={operationLogs}
                  restoreFromLog={restoreFromLog}
                  googleClientId={googleClientId}
                  connectGoogleDrive={connectGoogleDrive}
                  logoutGoogleDrive={logoutGoogleDrive}
                  uploadDriveData={uploadDriveData}
                  downloadDriveData={downloadDriveData}
                  refreshDriveBackups={refreshDriveBackups}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />

        {/* Customer Detail View */}
        <AnimatePresence>
          {selectedCustomer && (
            <motion.div
              initial={{ opacity: 0, x: '100%' }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-0 z-[100]"
            >
              <CustomerDetailView 
                customer={selectedCustomer}
                orders={orders}
                machines={machines}
                customers={customers}
                releases={releases}
                settings={settings}
                onClose={() => setSelectedCustomer(null)}
                showToast={showToast}
                onCopyNotification={() => copyCustomerNotification(selectedCustomer)}
                setConfirmModal={setConfirmModal}
                setEditingMachine={setEditingMachine}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Machine Edit Modal */}
        <AnimatePresence>
          {editingMachine && (
            <MachineEditModal 
              machine={editingMachine}
              onClose={() => setEditingMachine(null)}
              onSave={handleSaveEditedMachine}
              onDelete={handleDeleteMachine}
              orders={orders}
              customers={customers}
              settings={settings}
              showToast={showToast}
              setConfirmModal={setConfirmModal}
            />
          )}
        </AnimatePresence>


        {/* Confirmation Modal */}
        <AnimatePresence>
          {confirmModal.show && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-ink/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-card-white w-full max-w-sm p-8 rounded-3xl card-shadow"
              >
                <h3 className="text-xl font-bold text-ink mb-4">{confirmModal.title}</h3>
                <p className="text-ink/60 mb-6 whitespace-pre-line leading-relaxed">{confirmModal.message}</p>
                
                {confirmModal.checkboxLabel && (
                  <label className="flex items-center gap-3 mb-8 cursor-pointer group">
                    <div className="relative flex items-center justify-center w-6 h-6 rounded-lg border-2 border-ink/20 group-hover:border-primary-blue transition-colors">
                      <input 
                        type="checkbox" 
                        className="absolute opacity-0 w-full h-full cursor-pointer peer"
                        id="confirm-checkbox"
                      />
                      <CheckCircle2 className="w-4 h-4 text-primary-blue opacity-0 peer-checked:opacity-100 transition-opacity" />
                    </div>
                    <span className="text-sm font-bold text-ink/70 group-hover:text-ink transition-colors">{confirmModal.checkboxLabel}</span>
                  </label>
                )}

                <div className="flex gap-3">
                  <button 
                    onClick={() => setConfirmModal(m => ({ ...m, show: false }))}
                    className="flex-1 py-4 bg-background text-ink rounded-2xl font-bold"
                  >
                    取消
                  </button>
                  <button 
                    onClick={() => {
                      const checkbox = document.getElementById('confirm-checkbox') as HTMLInputElement;
                      confirmModal.onConfirm(checkbox?.checked);
                      setConfirmModal(m => ({ ...m, show: false }));
                    }}
                    className={cn(
                      "flex-1 py-4 text-white rounded-2xl font-bold",
                      confirmModal.type === 'danger' ? "bg-red-500 shadow-lg shadow-red-500/30" : "bg-primary-blue shadow-lg shadow-primary-blue/30"
                    )}
                  >
                    確定
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Toast Notification */}
        <AnimatePresence>
          {toast.show && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className={cn(
                "fixed bottom-28 left-1/2 -translate-x-1/2 z-[9999] px-6 py-3 rounded-full font-bold text-white shadow-xl flex items-center gap-2",
                toast.type === 'success' ? "bg-green-500" : "bg-red-500"
              )}
            >
              {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              {toast.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hidden Print Content */}
        <div className="hidden">
          <div ref={printRef} className="p-10 text-black font-sans">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold">Cuibo Gasha 收據</h1>
              <p className="text-sm">{format(toZonedTime(new Date(), TAIWAN_TZ), 'yyyy/MM/dd HH:mm')}</p>
            </div>
            {selectedOrder && (
              <>
                <div className="mb-6">
                  <p><strong>顧客：</strong>{selectedOrder.customerName}</p>
                  <p><strong>訂單編號：</strong>{selectedOrder.id}</p>
                </div>
                <table className="w-full border-collapse mb-8" style={{ tableLayout: 'fixed' }}>
                  <thead>
                    <tr className="border-b-2 border-black">
                      <th className="w-[10%] text-center py-2"></th>
                      <th className="w-[50%] text-left py-2">項目</th>
                      <th className="w-[20%] text-center py-2">數量</th>
                      <th className="w-[20%] text-right py-2">小計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedOrder.items && groupItemsHelper(selectedOrder.items).map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-200">
                        <td className="text-center py-2 align-middle">
                          <div className="w-4 h-4 border-2 border-black rounded-sm mx-auto"></div>
                        </td>
                        <td className="py-2">
                          <div>{item.machineName} {item.variant && `(${item.variant})`}</div>
                          <div className="text-[10px] text-gray-400">{formatDateTime(item.createdAt)}</div>
                        </td>
                        <td className="text-center py-2">{item.quantity}</td>
                        <td className="text-right py-2">NT${item.subtotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-right">
                  <p className="text-xl font-bold">總計：NT${selectedOrder.totalAmount}</p>
                </div>
                <div className="mt-12 text-center text-sm italic">
                  <p>感謝您的購買，歡迎再次光臨！</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}



