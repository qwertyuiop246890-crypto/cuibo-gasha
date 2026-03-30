import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { 
  Plus, List, Package, Users, LayoutDashboard, Settings, 
  Search, Printer, Copy, Download, Upload, Trash2, 
  LogOut, ChevronRight, CheckCircle2, AlertCircle, X,
  ArrowLeft, Save, RefreshCw, TrendingUp, MessageSquare,
  Coins, ArrowRight, Database, Home, ArrowRightLeft, UserPlus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User
} from 'firebase/auth';
import { 
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, 
  query, orderBy, serverTimestamp, getDoc, getDocs, writeBatch,
  getDocFromServer
} from 'firebase/firestore';
import { useReactToPrint } from 'react-to-print';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { auth, db } from './firebase';
import { cn } from './lib/utils';
import { Customer, Order, OrderItem, SystemSettings } from './types';

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
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

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
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
      try {
        const parsed = JSON.parse(this.state.errorInfo || "");
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          displayMessage = `權限不足：無法執行 ${parsed.operationType} 操作於 ${parsed.path}。請確認您是否為管理員。`;
        }
      } catch (e) {
        displayMessage = this.state.errorInfo || "發生未知錯誤。";
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="max-w-md w-full bg-card-white p-8 rounded-3xl card-shadow text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-ink mb-4">糟糕！出錯了</h2>
            <p className="text-ink/60 mb-8">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-primary-blue text-white rounded-2xl font-bold shadow-lg shadow-primary-blue/30"
            >
              重新整理頁面
            </button>
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
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s !== value).slice(0, 5);

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
            className="absolute left-0 right-0 top-full mt-2 bg-card-white rounded-2xl shadow-xl z-50 overflow-hidden border border-divider"
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
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/layout/google.svg" className="w-6 h-6" alt="Google" />
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
        <img src={user.photoURL || ''} className="w-10 h-10 rounded-full border-2 border-card-white shadow-sm" alt="User" />
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
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-card-white border-t border-divider pb-safe shadow-2xl">
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
  const [quantity, setQuantity] = useState(1);
  const [variant, setVariant] = useState('');
  const [isEco, setIsEco] = useState(false);

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
    const trimmedName = customerName.trim();
    if (!trimmedName || !machineName) {
      showToast('請填寫顧客名稱與機台名稱', 'error');
      return;
    }
    
    const now = new Date().toISOString();
    const itemPrice = (settings?.priceMap?.[price] || DEFAULT_PRICE_MAP[price] || 0) + (isEco ? 10 : 0);
    const subtotal = itemPrice * quantity;
    const finalVariant = variant + (isEco ? ' (環保)' : '');
    
    try {
      // 1. Find or Create Customer
      let customer = customers.find(c => c.name.trim() === trimmedName);
      let customerId = customer?.id;

      if (!customer) {
        const newCustRef = doc(collection(db, 'customers'));
        const newCust: Omit<Customer, 'id'> = {
          name: trimmedName,
          totalSpent: 0,
          orderCount: 0,
          createdAt: now,
          lastOrderAt: now
        };
        await setDoc(newCustRef, newCust);
        customerId = newCustRef.id;
        customer = { id: customerId, ...newCust };
      }

      // 2. Find existing pending order for this customer to consolidate
      const existingOrder = orders.find(o => o.customerId === customerId && o.status === 'pending');
      
      if (existingOrder) {
        // Check if same item exists in this order
        const existingItemIdx = existingOrder.items.findIndex(i => 
          i.machineName === machineName && 
          (i.variant || '') === finalVariant && 
          i.price === itemPrice
        );

        let updatedItems = [...existingOrder.items];
        if (existingItemIdx > -1) {
          // Consolidate
          const item = updatedItems[existingItemIdx];
          updatedItems[existingItemIdx] = {
            ...item,
            quantity: item.quantity + quantity,
            subtotal: item.subtotal + subtotal
          };
        } else {
          // Add new item
          updatedItems.push({
            id: Math.random().toString(36).substr(2, 9),
            machineName,
            price: itemPrice,
            quantity,
            variant: finalVariant,
            subtotal
          });
        }

        await updateDoc(doc(db, 'orders', existingOrder.id), {
          items: updatedItems,
          totalAmount: existingOrder.totalAmount + subtotal,
          updatedAt: now
        });
      } else {
        // Create new order
        const orderRef = doc(collection(db, 'orders'));
        const newOrder: Omit<Order, 'id'> = {
          customerId: customerId!,
          customerName: trimmedName,
          items: [{
            id: Math.random().toString(36).substr(2, 9),
            machineName,
            price: itemPrice,
            quantity,
            variant: finalVariant,
            subtotal
          }],
          totalAmount: subtotal,
          status: 'pending',
          createdAt: now,
          updatedAt: now
        };
        await setDoc(orderRef, newOrder);
      }
      
      // 3. Update customer stats
      await updateDoc(doc(db, 'customers', customerId!), {
        totalSpent: (customer?.totalSpent || 0) + subtotal,
        orderCount: (customer?.orderCount || 0) + (existingOrder ? 0 : 1),
        lastOrderAt: now
      });

      // 4. Update Machine Variants
      const machine = machines.find(m => m.name === machineName);
      const cleanVariant = variant.trim();
      if (machine) {
        if (cleanVariant && !machine.variants.includes(cleanVariant)) {
          await updateDoc(doc(db, 'machines', machine.id), {
            variants: [...machine.variants, cleanVariant],
            updatedAt: now
          });
        }
      } else {
        const machineRef = doc(collection(db, 'machines'));
        await setDoc(machineRef, {
          name: machineName,
          defaultPrice: price,
          variants: cleanVariant ? [cleanVariant] : [],
          createdAt: now,
          updatedAt: now
        });
      }

      showToast('訂單已更新/建立！');

      // Handle Modes
      if (mode === 'same_cust') {
        // Clear items, keep customer
        setMachineName('');
        setVariant('');
        setQuantity(1);
        setIsEco(false);
      } else if (mode === 'same_item') {
        // Keep items, clear customer
        setCustomerName('');
      } else if (mode === 'same_both') {
        // Keep all - just stay here
      } else {
        // New - clear all
        setCustomerName('');
        setMachineName('');
        setVariant('');
        setQuantity(1);
        setIsEco(false);
        setActiveTab('orders');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'orders/customers');
    }
  };

  const customerSuggestions = Array.from(new Set(customers.map(c => c.name)));
  const machineSuggestions = Array.from(new Set([
    ...machines.map(m => m.name),
    ...orders.flatMap(o => o.items.map(i => i.machineName))
  ]));
  
  const selectedMachine = machines.find(m => m.name === machineName);
  const variantSuggestions = selectedMachine 
    ? selectedMachine.variants 
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
      </div>

      <div className="bg-card-white p-6 rounded-3xl card-shadow">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 bg-background rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
            <Package className="w-6 h-6 text-ink/20" />
          </div>
          <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest">機台與款式</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <SuggestiveInput 
            value={machineName}
            onChange={setMachineName}
            placeholder="輸入機台名稱 (例: 吉伊卡哇)"
            suggestions={machineSuggestions}
          />
          <div className="relative">
            <SuggestiveInput 
              value={variant}
              onChange={setVariant}
              placeholder="輸入款式 (選填)"
              suggestions={variantSuggestions}
            />
          </div>
        </div>
        
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
            <div className="flex items-center gap-4">
              <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="w-10 h-10 bg-card-white rounded-full flex items-center justify-center shadow-sm">-</button>
              <span className="text-xl font-bold w-8 text-center">{quantity}</span>
              <button onClick={() => setQuantity(quantity + 1)} className="w-10 h-10 bg-card-white rounded-full flex items-center justify-center shadow-sm">+</button>
            </div>
            <label className="flex items-center gap-2 cursor-pointer mt-2">
              <input 
                type="checkbox" 
                checked={isEco} 
                onChange={(e) => setIsEco(e.target.checked)}
                className="w-4 h-4 rounded text-primary-blue focus:ring-primary-blue"
              />
              <span className="text-xs font-bold text-ink/60">環保費 (+$10)</span>
            </label>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink/50 font-bold">單價</p>
            <p className="text-xl font-bold text-ink">
              NT${(settings?.priceMap?.[price] || DEFAULT_PRICE_MAP[price] || 0) + (isEco ? 10 : 0)}
            </p>
            <p className="text-[10px] text-ink/30">總計: NT${((settings?.priceMap?.[price] || DEFAULT_PRICE_MAP[price] || 0) + (isEco ? 10 : 0)) * quantity}</p>
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
            <p className="text-[10px] opacity-80">(清空全部/返回清單)</p>
          </button>
        </div>
      </div>
    </div>
  );
};

const OrdersList = ({ 
  orders, 
  machines,
  setConfirmModal,
  showToast
}: { 
  orders: Order[], 
  machines: any[],
  setConfirmModal: (m: any) => void,
  showToast: (m: string, t?: 'success' | 'error') => void
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [editingItem, setEditingItem] = useState<{ orderId: string, item: OrderItem } | null>(null);

  const handleUpdateItem = async (orderId: string, updatedItem: OrderItem) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      const newItems = order.items.map(i => i.id === updatedItem.id ? updatedItem : i);
      const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);

      await updateDoc(doc(db, 'orders', orderId), {
        items: newItems,
        totalAmount: newTotal,
        updatedAt: new Date().toISOString()
      });
      
      // Update customer total spent
      const diff = newTotal - order.totalAmount;
      const customerSnap = await getDoc(doc(db, 'customers', order.customerId));
      if (customerSnap.exists()) {
        await updateDoc(doc(db, 'customers', order.customerId), {
          totalSpent: customerSnap.data().totalSpent + diff
        });
      }

      setEditingItem(null);
      showToast('更新成功');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink/30" />
        <input 
          type="text" 
          placeholder="搜尋顧客、商品名稱或款式..." 
          className="w-full pl-12 pr-4 py-4 bg-card-white rounded-2xl border-none card-shadow"
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      
      {orders.filter(o => {
        const lowerSearch = searchTerm.toLowerCase();
        return o.customerName.toLowerCase().includes(lowerSearch) ||
               o.items.some(item => 
                 item.machineName.toLowerCase().includes(lowerSearch) || 
                 (item.variant && item.variant.toLowerCase().includes(lowerSearch))
               );
      }).map(order => (
        <motion.div 
          layout
          key={order.id} 
          className="bg-card-white p-6 rounded-3xl card-shadow border-l-4 border-primary-blue"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="font-bold text-lg text-ink">{order.customerName}</h4>
              <p className="text-xs text-ink/40">{order.createdAt ? format(toZonedTime(new Date(order.createdAt), TAIWAN_TZ), 'yyyy/MM/dd HH:mm') : '無日期'}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xl font-bold text-ink">NT${order.totalAmount}</p>
              </div>
              <button 
                onClick={() => {
                  setConfirmModal({
                    show: true,
                    title: '刪除訂單',
                    message: `確定要刪除 ${order.customerName} 的這筆訂單嗎？`,
                    type: 'danger',
                    onConfirm: async () => {
                      try {
                        await deleteDoc(doc(db, 'orders', order.id));
                        
                        // Update customer stats
                        const customerSnap = await getDoc(doc(db, 'customers', order.customerId));
                        if (customerSnap.exists()) {
                          const customerData = customerSnap.data() as Customer;
                          await updateDoc(doc(db, 'customers', order.customerId), {
                            totalSpent: Math.max(0, customerData.totalSpent - order.totalAmount),
                            orderCount: Math.max(0, customerData.orderCount - 1)
                          });
                        }

                        showToast('訂單已刪除');
                      } catch (err) {
                        handleFirestoreError(err, OperationType.DELETE, `orders/${order.id}`);
                      }
                    }
                  });
                }}
                className="p-2 text-red-400 hover:bg-red-50 rounded-xl transition-colors"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="space-y-2 mb-4">
            {order.items.map((item, idx) => {
              const machine = machines.find(m => m.name === item.machineName);
              return (
                <div 
                  key={idx} 
                  onClick={() => setEditingItem({ orderId: order.id, item })}
                  className="flex items-center justify-between text-sm p-2 hover:bg-background rounded-xl cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-background rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                      <Package className="w-4 h-4 text-ink/20" />
                    </div>
                    <span className="text-ink/70">{item.machineName} {item.variant && `(${item.variant})`}</span>
                  </div>
                  <span className="font-medium text-ink/40">NT${item.price} x {item.quantity}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      ))}

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
                      {machines.find(m => m.name === editingItem.item.machineName).variants.map((v: string) => (
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
                      value={editingItem.item.price}
                      onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, price: parseInt(e.target.value), subtotal: parseInt(e.target.value) * editingItem.item.quantity } })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-ink/40 block mb-1">數量</label>
                    <input 
                      type="number" className="w-full p-4 bg-background rounded-2xl border-none"
                      value={editingItem.item.quantity}
                      onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, quantity: parseInt(e.target.value), subtotal: editingItem.item.price * parseInt(e.target.value) } })}
                    />
                  </div>
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
                          const order = orders.find(o => o.id === editingItem.orderId);
                          if (!order) return;
                          const newItems = order.items.filter(i => i.id !== editingItem.item.id);
                          const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);
                          
                          try {
                            if (newItems.length === 0) {
                              await deleteDoc(doc(db, 'orders', order.id));
                            } else {
                              await updateDoc(doc(db, 'orders', order.id), {
                                items: newItems,
                                totalAmount: newTotal,
                                updatedAt: new Date().toISOString()
                              });
                            }
                            
                            // Update customer stats
                            const customerSnap = await getDoc(doc(db, 'customers', order.customerId));
                            if (customerSnap.exists()) {
                              const customerData = customerSnap.data() as Customer;
                              await updateDoc(doc(db, 'customers', order.customerId), {
                                totalSpent: Math.max(0, customerData.totalSpent - editingItem.item.subtotal),
                                orderCount: newItems.length === 0 ? Math.max(0, customerData.orderCount - 1) : customerData.orderCount
                              });
                            }
                            
                            setEditingItem(null);
                            showToast('項目已刪除');
                          } catch (err) {
                            handleFirestoreError(err, OperationType.WRITE, `orders/${order.id}`);
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
  onCopyNotification
}: { 
  customers: Customer[],
  setConfirmModal: (m: any) => void,
  showToast: (m: string, t?: 'success' | 'error') => void,
  onSelectCustomer: (c: Customer) => void,
  onCopyNotification: (c: Customer) => void
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'spent'>('spent');

  const sortedCustomers = [...customers]
    .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, 'zh-Hant');
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
        <div className="flex bg-card-white p-1 rounded-2xl card-shadow">
          <button 
            onClick={() => setSortBy('spent')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-bold transition-all",
              sortBy === 'spent' ? "bg-ink text-white" : "text-ink/40"
            )}
          >
            金額排序
          </button>
          <button 
            onClick={() => setSortBy('name')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-bold transition-all",
              sortBy === 'name' ? "bg-ink text-white" : "text-ink/40"
            )}
          >
            名稱排序
          </button>
        </div>
      </div>

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
                <p className="text-xs text-ink/40">共 {customer.orderCount} 筆訂單</p>
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
                      message: `確定要刪除顧客 ${customer.name} 嗎？這將不會刪除其訂單紀錄。`,
                      type: 'danger',
                      onConfirm: async () => {
                        try {
                          await deleteDoc(doc(db, 'customers', customer.id));
                          showToast('顧客已刪除');
                        } catch (err) {
                          handleFirestoreError(err, OperationType.DELETE, `customers/${customer.id}`);
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
    </div>
  );
};

const MachineManagement = ({ 
  machines, 
  orders,
  customers,
  settings,
  showToast,
  setConfirmModal
}: { 
  machines: any[], 
  orders: Order[],
  customers: Customer[],
  settings: SystemSettings | null,
  showToast: (m: string, t?: 'success' | 'error') => void,
  setConfirmModal: (m: any) => void
}) => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [variantList, setVariantList] = useState<string[]>([]);
  const [newVariant, setNewVariant] = useState('');
  const [editingVariantIndex, setEditingVariantIndex] = useState<number | null>(null);
  const [editingVariantValue, setEditingVariantValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [oldName, setOldName] = useState<string | null>(null);
  const [variantMapping, setVariantMapping] = useState<Record<string, string>>({});

  // Derive all unique machine names from orders
  const machineNamesFromOrders = Array.from(new Set(orders.flatMap(o => o.items.map(i => i.machineName))));
  
  // Combine with existing configured machines
  const allMachineNames = Array.from(new Set([
    ...machineNamesFromOrders,
    ...machines.map(m => m.name)
  ])).sort();

  const saveMachine = async () => {
    if (!name || !price) {
      showToast('請填寫名稱與金額', 'error');
      return;
    }
    const now = new Date().toISOString();
    const data = {
      name,
      defaultPrice: parseInt(price),
      variants: variantList,
      updatedAt: now
    };

    try {
      const batch = writeBatch(db);
      
      // Find if we already have a doc for this name
      const existingMachine = machines.find(m => m.name === name);
      const docId = editingId || existingMachine?.id;

      if (docId) {
        batch.update(doc(db, 'machines', docId), data);
      } else {
        const newDocRef = doc(collection(db, 'machines'));
        batch.set(newDocRef, { ...data, createdAt: now });
      }

      // Sync with orders if name changed or if explicitly requested (implied by user)
      // We'll update all orders that have the oldName (if it was an edit) or the current name
      const nameToMatch = oldName || name;
      const affectedOrders = orders.filter(o => o.items.some(i => i.machineName === nameToMatch));
      
      const customerDiffs: Record<string, number> = {};

      affectedOrders.forEach(order => {
        let changed = false;
        const newItems = order.items.map(item => {
          if (item.machineName === nameToMatch) {
            changed = true;
            const itemPrice = (settings?.priceMap?.[data.defaultPrice] || DEFAULT_PRICE_MAP[data.defaultPrice] || 0) + (item.variant?.includes('(環保)') ? 10 : 0);
            
            // Handle variant renaming
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
              machineName: name,
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
          batch.update(doc(db, 'orders', order.id), { 
            items: newItems,
            totalAmount: newTotalAmount,
            customerName: order.customerName, // Keep snapshot consistent
            updatedAt: now
          });
        }
      });

      // Update customers
      Object.entries(customerDiffs).forEach(([customerId, diff]) => {
        const customer = customers.find(c => c.id === customerId);
        if (customer) {
          batch.update(doc(db, 'customers', customerId), {
            totalSpent: customer.totalSpent + diff
          });
        }
      });

      await batch.commit();
      showToast(docId ? '機台設定與訂單已同步更新' : '機台設定已儲存');
      reset();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'machines_sync');
    }
  };

  const reset = () => {
    setName('');
    setPrice('');
    setVariantList([]);
    setNewVariant('');
    setEditingVariantIndex(null);
    setEditingVariantValue('');
    setEditingId(null);
    setOldName(null);
    setVariantMapping({});
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
        
        // Track the rename for syncing later
        // If we already had a mapping for this oldVal (e.g. A -> B), and now we do B -> C
        // We want to update the original mapping to A -> C
        const originalName = Object.keys(variantMapping).find(key => variantMapping[key] === oldVal) || oldVal;
        setVariantMapping(prev => ({ ...prev, [originalName]: newVal }));
      }
      
      setEditingVariantIndex(null);
      setEditingVariantValue('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-card-white p-6 rounded-3xl card-shadow">
        <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4">
          {editingId ? `編輯機台: ${name}` : '機台設定'}
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
            onClick={saveMachine}
            className="flex-1 py-4 bg-primary-blue text-white rounded-2xl font-bold"
          >
            儲存並同步訂單
          </button>
          {(editingId || name || price || variantList.length > 0) && (
            <button 
              onClick={reset}
              className="px-6 py-4 bg-background text-ink rounded-2xl font-bold"
            >
              重置
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {allMachineNames.map(machineName => {
          const config = machines.find(m => m.name === machineName);
          return (
            <div 
              key={machineName} 
              onClick={() => {
                setName(machineName);
                setOldName(machineName);
                if (config) {
                  setEditingId(config.id);
                  setPrice(config.defaultPrice.toString());
                  setVariantList(config.variants);
                } else {
                  setEditingId(null);
                  
                  // Try to guess JPY price from last order
                  const lastOrderWithMachine = orders.find(o => o.items.some(i => i.machineName === machineName));
                  if (lastOrderWithMachine) {
                    const item = lastOrderWithMachine.items.find(i => i.machineName === machineName);
                    if (item) {
                      const ntPrice = item.price;
                      const map = settings?.priceMap || DEFAULT_PRICE_MAP;
                      // Try exact match or match minus eco fee
                      const guessedJpy = Object.keys(map).find(k => map[parseInt(k)] === ntPrice) || 
                                        Object.keys(map).find(k => map[parseInt(k)] === ntPrice - 10);
                      if (guessedJpy) setPrice(guessedJpy);
                      else setPrice('');
                    } else {
                      setPrice('');
                    }
                  } else {
                    setPrice('');
                  }

                  // Try to find variants from orders for this machine
                  const variantsFromOrders = Array.from(new Set(
                    orders.flatMap(o => o.items.filter(i => i.machineName === machineName).map(i => i.variant || ''))
                  )).filter(v => v && !v.includes('(環保)'));
                  setVariantList(variantsFromOrders);
                }
              }}
              className={cn(
                "bg-card-white p-6 rounded-3xl card-shadow flex justify-between items-start cursor-pointer transition-all hover:scale-[1.02]",
                config ? "border-l-4 border-primary-blue" : "border-l-4 border-dashed border-ink/10"
              )}
            >
              <div className="flex-1 flex gap-4">
                <div className="w-12 h-12 bg-background rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0">
                  <Package className="w-6 h-6 text-ink/20" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-bold text-ink">{machineName}</h4>
                    {!config && <span className="text-[10px] bg-ink/5 text-ink/40 px-1.5 py-0.5 rounded">未設定</span>}
                  </div>
                  {config ? (
                    <>
                      <p className="text-xs text-ink/40 mb-2">預設金額: ¥{config.defaultPrice}</p>
                      <div className="flex flex-wrap gap-1">
                        {config.variants.map((v: string) => (
                          <span key={v} className="px-2 py-1 bg-background rounded text-[10px] font-bold text-ink/60">{v}</span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-ink/30 italic">點擊以設定預設金額與款式</p>
                  )}
                </div>
              </div>
              {config && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmModal({
                      show: true,
                      title: '刪除機台',
                      message: `確定要刪除機台 ${machineName} 的設定嗎？`,
                      type: 'danger',
                      onConfirm: async () => {
                        try {
                          await deleteDoc(doc(db, 'machines', config.id));
                          showToast('機台設定已刪除');
                        } catch (err) {
                          handleFirestoreError(err, OperationType.DELETE, `machines/${config.id}`);
                        }
                      }
                    });
                  }}
                  className="p-2 text-ink/20 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
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
  setConfirmModal
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
  setConfirmModal: (m: any) => void
}) => {
  const customerOrders = orders.filter(o => o.customerId === customer.id);
  const [editingItem, setEditingItem] = useState<{ orderId: string, item: OrderItem } | null>(null);
  const [transferringItem, setTransferringItem] = useState<{ orderId: string, item: OrderItem } | null>(null);
  const [targetCustomerName, setTargetCustomerName] = useState('');

  const handleUpdateItem = async (orderId: string, updatedItem: OrderItem) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      const newItems = order.items.map(i => i.id === updatedItem.id ? updatedItem : i);
      const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);

      await updateDoc(doc(db, 'orders', orderId), {
        items: newItems,
        totalAmount: newTotal,
        updatedAt: new Date().toISOString()
      });
      
      // Update customer total spent
      const diff = newTotal - order.totalAmount;
      await updateDoc(doc(db, 'customers', customer.id), {
        totalSpent: customer.totalSpent + diff
      });

      setEditingItem(null);
      showToast('更新成功');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
    }
  };

  const handleTransfer = async () => {
    if (!transferringItem || !targetCustomerName.trim()) return;
    const { orderId, item } = transferringItem;
    const trimmedTarget = targetCustomerName.trim();

    if (trimmedTarget === customer.name) {
      showToast('不能轉讓給原顧客自己！', 'error');
      return;
    }

    try {
      // 1. Find or create target customer
      let targetCust = customers.find(c => c.name.trim() === trimmedTarget);
      let targetId = targetCust?.id;

      if (!targetCust) {
        const newCustRef = doc(collection(db, 'customers'));
        const newCust = {
          name: trimmedTarget,
          totalSpent: 0,
          orderCount: 0,
          createdAt: new Date().toISOString(),
          lastOrderAt: new Date().toISOString()
        };
        await setDoc(newCustRef, newCust);
        targetId = newCustRef.id;
        targetCust = { id: targetId, ...newCust } as Customer;
      }

      // 2. Remove from current order
      const currentOrder = orders.find(o => o.id === orderId);
      if (!currentOrder) return;

      const newItems = currentOrder.items.filter(i => i.id !== item.id);
      const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);
      await updateDoc(doc(db, 'orders', orderId), {
        items: newItems,
        totalAmount: newTotal,
        updatedAt: new Date().toISOString()
      });
      await updateDoc(doc(db, 'customers', customer.id), {
        totalSpent: customer.totalSpent - item.subtotal
      });

      // 3. Add to target customer's pending order or create new
      const targetOrder = orders.find(o => o.customerId === targetId && o.status === 'pending');
      if (targetOrder) {
        const updatedItems = [...targetOrder.items, item];
        await updateDoc(doc(db, 'orders', targetOrder.id), {
          items: updatedItems,
          totalAmount: targetOrder.totalAmount + item.subtotal,
          updatedAt: new Date().toISOString()
        });
      } else {
        await setDoc(doc(collection(db, 'orders')), {
          customerId: targetId,
          customerName: trimmedTarget,
          items: [item],
          totalAmount: item.subtotal,
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      await updateDoc(doc(db, 'customers', targetId!), {
        totalSpent: targetCust.totalSpent + item.subtotal,
        orderCount: targetCust.orderCount + (targetOrder ? 0 : 1),
        lastOrderAt: new Date().toISOString()
      });

      setTransferringItem(null);
      setTargetCustomerName('');
      showToast(`已轉讓給 ${trimmedTarget}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'transfer');
    }
  };

  const handleReleaseToggle = async (orderId: string, item: OrderItem) => {
    try {
      const existing = releases.find(r => r.orderId === orderId && r.itemId === item.id && r.status === 'pending');
      if (existing) {
        await deleteDoc(doc(db, 'releases', existing.id));
        showToast('已取消釋出');
      } else {
        const releaseRef = doc(collection(db, 'releases'));
        const releaseData: any = {
          orderId,
          itemId: item.id,
          customerName: customer.name,
          machineName: item.machineName,
          quantity: item.quantity,
          price: item.price,
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        if (item.variant) {
          releaseData.variant = item.variant;
        }
        await setDoc(releaseRef, releaseData);
        showToast('正在釋出中');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'releases');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <header className="p-6 border-b border-divider flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 bg-card-white rounded-xl shadow-sm">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-ink">{customer.name}</h2>
            <p className="text-xs text-ink/40">消費總額: NT${customer.totalSpent} • 訂單數: {customer.orderCount}</p>
          </div>
        </div>
        <button 
          onClick={onCopyNotification}
          className="px-4 py-2 bg-primary-blue/10 text-primary-blue rounded-xl font-bold text-sm hover:bg-primary-blue/20 transition-colors"
        >
          複製通知
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 pb-32">
        {customerOrders.map(order => (
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
                        await deleteDoc(doc(db, 'orders', order.id));
                        
                        // Update customer stats
                        const customerSnap = await getDoc(doc(db, 'customers', order.customerId));
                        if (customerSnap.exists()) {
                          const customerData = customerSnap.data() as Customer;
                          await updateDoc(doc(db, 'customers', order.customerId), {
                            totalSpent: Math.max(0, customerData.totalSpent - order.totalAmount),
                            orderCount: Math.max(0, customerData.orderCount - 1)
                          });
                        }

                        showToast('訂單已刪除');
                      } catch (err) {
                        handleFirestoreError(err, OperationType.DELETE, `orders/${order.id}`);
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
              {order.items.map(item => {
                const isReleased = releases.some(r => r.orderId === order.id && r.itemId === item.id && r.status === 'pending');
                const machine = machines.find(m => m.name === item.machineName);
                return (
                  <div key={item.id} className="flex flex-col gap-2 p-4 bg-background rounded-2xl relative group">
                    <div className="flex justify-between items-start">
                      <div className="flex gap-3">
                        <div className="w-10 h-10 bg-card-white rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
                          <Package className="w-5 h-5 text-ink/20" />
                        </div>
                        <div>
                          <p className="font-bold text-ink">{item.machineName}</p>
                          <p className="text-xs text-ink/40">{item.variant || '無款式'}</p>
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
                        onClick={() => setTransferringItem({ orderId: order.id, item })}
                        className="flex-1 py-2 bg-card-white text-ink/60 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1"
                      >
                        <ArrowRight className="w-3 h-3" /> 轉讓
                      </button>
                      <button 
                        onClick={() => handleReleaseToggle(order.id, item)}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1 transition-colors",
                          isReleased ? "bg-orange-500 text-white" : "bg-card-white text-ink/60"
                        )}
                      >
                        <LogOut className="w-3 h-3" /> {isReleased ? '正在釋出中' : '釋出'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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
                      {machines.find(m => m.name === editingItem.item.machineName).variants.map((v: string) => (
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
                      value={editingItem.item.price}
                      onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, price: parseInt(e.target.value), subtotal: parseInt(e.target.value) * editingItem.item.quantity } })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-ink/40 block mb-1">數量</label>
                    <input 
                      type="number" className="w-full p-4 bg-background rounded-2xl border-none"
                      value={editingItem.item.quantity}
                      onChange={(e) => setEditingItem({ ...editingItem, item: { ...editingItem.item, quantity: parseInt(e.target.value), subtotal: editingItem.item.price * parseInt(e.target.value) } })}
                    />
                  </div>
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
                          const order = orders.find(o => o.id === editingItem.orderId);
                          if (!order) return;
                          const newItems = order.items.filter(i => i.id !== editingItem.item.id);
                          const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);
                          
                          try {
                            if (newItems.length === 0) {
                              await deleteDoc(doc(db, 'orders', order.id));
                            } else {
                              await updateDoc(doc(db, 'orders', order.id), {
                                items: newItems,
                                totalAmount: newTotal,
                                updatedAt: new Date().toISOString()
                              });
                            }
                            
                            // Update customer stats
                            const customerSnap = await getDoc(doc(db, 'customers', order.customerId));
                            if (customerSnap.exists()) {
                              const customerData = customerSnap.data() as Customer;
                              await updateDoc(doc(db, 'customers', order.customerId), {
                                totalSpent: Math.max(0, customerData.totalSpent - editingItem.item.subtotal),
                                orderCount: newItems.length === 0 ? Math.max(0, customerData.orderCount - 1) : customerData.orderCount
                              });
                            }
                            
                            setEditingItem(null);
                            showToast('項目已刪除');
                          } catch (err) {
                            handleFirestoreError(err, OperationType.WRITE, `orders/${order.id}`);
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
              <SuggestiveInput 
                value={targetCustomerName}
                onChange={setTargetCustomerName}
                placeholder="輸入顧客名稱..."
                suggestions={customers.map(c => c.name)}
              />
              <div className="flex gap-2 pt-6">
                <button onClick={() => setTransferringItem(null)} className="flex-1 py-4 bg-background text-ink rounded-2xl font-bold">取消</button>
                <button onClick={handleTransfer} className="flex-1 py-4 bg-primary-blue text-white rounded-2xl font-bold">確認轉讓</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

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

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <header className="p-6 border-b border-divider flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 bg-card-white rounded-xl shadow-sm">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-ink">列印預覽</h2>
        </div>
        <button 
          onClick={() => handlePrint()}
          className="px-6 py-2 bg-primary-blue text-white rounded-xl font-bold flex items-center gap-2"
        >
          <Printer className="w-4 h-4" /> 列印所選 ({selectedIds.length})
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-full sm:w-1/3 border-r border-divider overflow-y-auto p-4 space-y-2">
          <button 
            onClick={toggleAll}
            className="w-full py-3 bg-card-white rounded-xl font-bold text-ink text-sm border border-divider mb-4"
          >
            {selectedIds.length === customers.length ? '取消全選' : '全選顧客'}
          </button>
          {customers.map(c => (
            <div 
              key={c.id} 
              onClick={() => toggleOne(c.id)}
              className={cn(
                "p-4 rounded-2xl cursor-pointer transition-all border-2",
                selectedIds.includes(c.id) ? "bg-primary-blue/5 border-primary-blue" : "bg-card-white border-transparent"
              )}
            >
              <p className="font-bold text-ink text-sm">{c.name}</p>
              <p className="text-[10px] text-ink/40">NT${c.totalSpent}</p>
            </div>
          ))}
        </div>

        <div className="hidden sm:block flex-1 bg-ink/5 overflow-y-auto p-8">
          <div ref={printRef} className="bg-white w-[210mm] min-h-[297mm] mx-auto p-12 shadow-2xl print:shadow-none print:m-0 print:w-full print:p-0">
            <style>{`
              @media print {
                @page {
                  size: A4;
                  margin: 15mm;
                }
                .customer-section {
                  break-inside: avoid;
                  margin-bottom: 4rem;
                }
                .customer-section.long-order {
                  break-inside: auto;
                }
                table {
                  width: 100%;
                  border-collapse: collapse;
                }
                thead {
                  display: table-header-group;
                }
                tfoot {
                  display: table-footer-group;
                }
                tr {
                  break-inside: avoid;
                  break-after: auto;
                }
              }
            `}</style>
            <div className="space-y-12 print:space-y-0">
              {customers.filter(c => selectedIds.includes(c.id)).map(customer => {
                const custOrders = orders.filter(o => o.customerId === customer.id);
                const allItems = custOrders.flatMap(o => o.items);
                const isLongOrder = allItems.length > 15;

                return (
                  <div 
                    key={customer.id} 
                    className={cn(
                      "customer-section border-b-2 border-divider pb-8 last:border-none print:border-ink print:pb-12",
                      isLongOrder && "long-order"
                    )}
                  >
                    <table className="w-full text-left">
                      <thead>
                        <tr>
                          <th colSpan={5} className="pb-8">
                            <div className="text-center">
                              <h1 className="text-3xl font-bold text-ink border-b-4 border-ink pb-2 inline-block">
                                {customer.name} 扭蛋訂單明細
                              </h1>
                              <p className="text-xs font-bold text-ink/60 mt-2">
                                列印日期：{format(toZonedTime(new Date(), TAIWAN_TZ), 'yyyy/MM/dd')}
                              </p>
                            </div>
                          </th>
                        </tr>
                        <tr className="border-b-2 border-ink text-sm">
                          <th className="py-2">機台名稱</th>
                          <th className="py-2">款式</th>
                          <th className="py-2">單價</th>
                          <th className="py-2">數量</th>
                          <th className="py-2 text-right">小計</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allItems.map((item, idx) => (
                          <tr key={idx} className="border-b border-divider text-sm print:border-ink/20">
                            <td className="py-3">{item.machineName}</td>
                            <td className="py-3">{item.variant || '-'}</td>
                            <td className="py-3">NT${item.price}</td>
                            <td className="py-3">{item.quantity}</td>
                            <td className="py-3 text-right font-bold">NT${item.subtotal}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} className="py-6 text-right font-bold text-lg">總計金額：</td>
                          <td className="py-6 text-right font-bold text-2xl text-primary-blue print:text-ink">NT${customer.totalSpent}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              })}
            </div>
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
  showToast 
}: { 
  orders: Order[], 
  customers: Customer[], 
  machines: any[],
  releases: any[], 
  showToast: (m: string, t?: 'success' | 'error') => void 
}) => {
  const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalItems = orders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
  const pendingReleases = releases.filter(r => r.status === 'pending');

  const [transferringRelease, setTransferringRelease] = useState<any | null>(null);
  const [targetCustomerName, setTargetCustomerName] = useState('');

  const handleReleaseTransfer = async () => {
    if (!transferringRelease || !targetCustomerName.trim()) return;
    const release = transferringRelease;
    const trimmedTarget = targetCustomerName.trim();

    if (trimmedTarget === release.customerName) {
      showToast('不能轉讓給原顧客自己！', 'error');
      return;
    }

    try {
      // 1. Find or create target customer
      let targetCust = customers.find(c => c.name.trim() === trimmedTarget);
      let targetId = targetCust?.id;

      if (!targetCust) {
        const newCustRef = doc(collection(db, 'customers'));
        const newCust = {
          name: trimmedTarget,
          totalSpent: 0,
          orderCount: 0,
          createdAt: new Date().toISOString(),
          lastOrderAt: new Date().toISOString()
        };
        await setDoc(newCustRef, newCust);
        targetId = newCustRef.id;
        targetCust = { id: targetId, ...newCust } as Customer;
      }

      // 2. Update release status
      await updateDoc(doc(db, 'releases', release.id), { status: 'completed' });
      
      // 3. Update the original order item and customer
      const orderRef = doc(db, 'orders', release.orderId);
      const orderSnap = await getDoc(orderRef);
      let itemToTransfer: any = null;
      
      if (orderSnap.exists()) {
        const orderData = orderSnap.data() as Order;
        const updatedItems = orderData.items.map(item => {
          if (item.id === release.itemId) {
            itemToTransfer = { ...item, quantity: release.quantity, subtotal: release.quantity * item.price };
            const newQty = Math.max(0, item.quantity - release.quantity);
            return {
              ...item,
              quantity: newQty,
              subtotal: newQty * item.price,
              isReleased: newQty === 0
            };
          }
          return item;
        }).filter(item => item.quantity > 0);
        
        const newTotal = updatedItems.reduce((sum, i) => sum + i.subtotal, 0);
        
        if (updatedItems.length === 0) {
          await deleteDoc(orderRef);
          
          // Update original customer's orderCount
          const originalCustomer = customers.find(c => c.id === orderData.customerId);
          if (originalCustomer) {
            await updateDoc(doc(db, 'customers', originalCustomer.id), {
              orderCount: Math.max(0, originalCustomer.orderCount - 1)
            });
          }
        } else {
          await updateDoc(orderRef, {
            items: updatedItems,
            totalAmount: newTotal,
            updatedAt: new Date().toISOString()
          });
        }

        // Update original customer's totalSpent
        const originalCustomer = customers.find(c => c.id === orderData.customerId);
        if (originalCustomer && itemToTransfer) {
          await updateDoc(doc(db, 'customers', originalCustomer.id), {
            totalSpent: Math.max(0, originalCustomer.totalSpent - itemToTransfer.subtotal)
          });
        }
      }

      // 4. Add to target customer's pending order or create new
      if (itemToTransfer) {
        const transferredItem = {
          ...itemToTransfer,
          id: crypto.randomUUID(),
          isReleased: false
        };

        const targetOrder = orders.find(o => o.customerId === targetId && o.status === 'pending');
        if (targetOrder) {
          const updatedItems = [...targetOrder.items, transferredItem];
          await updateDoc(doc(db, 'orders', targetOrder.id), {
            items: updatedItems,
            totalAmount: targetOrder.totalAmount + transferredItem.subtotal,
            updatedAt: new Date().toISOString()
          });
        } else {
          await setDoc(doc(collection(db, 'orders')), {
            customerId: targetId,
            customerName: trimmedTarget,
            items: [transferredItem],
            totalAmount: transferredItem.subtotal,
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
        await updateDoc(doc(db, 'customers', targetId!), {
          totalSpent: targetCust.totalSpent + transferredItem.subtotal,
          lastOrderAt: new Date().toISOString()
        });
      }

      showToast('釋出轉移成功！');
      setTransferringRelease(null);
      setTargetCustomerName('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `releases/${release.id}`);
    }
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-orange-400 p-6 rounded-3xl text-white card-shadow">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">預估營收</p>
          <p className="text-3xl font-bold">NT${totalRevenue}</p>
        </div>
        <div className="bg-ink/40 p-6 rounded-3xl text-white card-shadow">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">總顆數</p>
          <p className="text-3xl font-bold">{totalItems}</p>
        </div>
        <div className="bg-primary-blue p-6 rounded-3xl text-white card-shadow">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest mb-1">顧客總數</p>
          <p className="text-3xl font-bold">{customers.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card-white p-6 rounded-3xl card-shadow">
          <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest mb-6 flex items-center justify-between">
            <span>釋出池</span>
            <span className="bg-primary-blue/10 text-primary-blue px-2 py-1 rounded text-[10px]">{pendingReleases.length} 筆待處理</span>
          </h3>
          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
            {pendingReleases.length === 0 ? (
              <p className="text-center py-8 text-ink/30 text-sm">目前沒有釋出中的扭蛋</p>
            ) : (
              pendingReleases.map(r => (
                <div key={r.id} className="p-4 bg-background rounded-2xl flex items-center justify-between group">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-ink">{r.machineName}</span>
                      {r.variant && <span className="text-[10px] bg-ink/5 px-1.5 py-0.5 rounded text-ink/60">{r.variant}</span>}
                    </div>
                    <p className="text-xs text-ink/40">
                      來自 <span className="font-bold text-ink/60">{r.customerName}</span> • {r.quantity} 顆 • NT${r.price}/顆
                    </p>
                  </div>
                  <button 
                    onClick={() => setTransferringRelease(r)}
                    className="p-2 bg-primary-blue text-white rounded-xl shadow-sm opacity-0 group-hover:opacity-100 transition-all"
                    title="轉讓給顧客"
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
            {Array.from(new Set(orders.flatMap(o => o.items.map(i => i.machineName))))
              .map(name => ({
                name,
                count: orders.flatMap(o => o.items).filter(i => i.machineName === name).reduce((s, i) => s + i.quantity, 0)
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
              <h3 className="text-lg font-bold text-ink mb-4">轉讓釋出扭蛋</h3>
              <p className="text-sm text-ink/60 mb-4">將 {transferringRelease.machineName} 轉讓給：</p>
              <SuggestiveInput 
                value={targetCustomerName}
                onChange={setTargetCustomerName}
                placeholder="輸入顧客名稱..."
                suggestions={customers.map(c => c.name)}
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
  onLogout,
  showToast,
  setConfirmModal
}: { 
  settings: SystemSettings | null, 
  onLogout: () => void,
  showToast: (m: string, t?: 'success' | 'error') => void,
  setConfirmModal: (m: any) => void
}) => {
  const [template, setTemplate] = useState(settings?.notificationTemplate || '');
  const [priceMap, setPriceMap] = useState<Record<number, any>>(settings?.priceMap || DEFAULT_PRICE_MAP);
  const [newJpy, setNewJpy] = useState('');
  const [newTwd, setNewTwd] = useState('');

  const saveSettings = async () => {
    try {
      const cleanedPriceMap: Record<number, number> = {};
      Object.entries(priceMap).forEach(([k, v]) => {
        const numV = parseInt(v as string);
        if (!isNaN(numV)) cleanedPriceMap[parseInt(k)] = numV;
      });

      await updateDoc(doc(db, 'settings', 'global'), {
        notificationTemplate: template,
        priceMap: cleanedPriceMap
      });
      showToast('設定已儲存');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
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
      message: '確定要刪除所有訂單、機台與顧客資料嗎？此操作無法復原！',
      type: 'danger',
      onConfirm: async () => {
        try {
          const collections = ['orders', 'machines', 'customers'];
          for (const colName of collections) {
            const snapshot = await getDocs(collection(db, colName));
            const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
            await Promise.all(deletePromises);
          }
          showToast('全部資料已清除');
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, 'multiple_collections');
        }
      }
    });
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="bg-card-white p-6 rounded-3xl card-shadow">
        <h3 className="text-sm font-bold text-ink/40 uppercase tracking-widest mb-4 flex items-center gap-2">
          <MessageSquare className="w-4 h-4" /> 通知範本設定
        </h3>
        <textarea 
          className="w-full h-40 p-4 bg-background rounded-2xl border-none focus:ring-2 focus:ring-primary-blue text-sm font-medium leading-relaxed"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
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
          <button className="p-4 bg-background rounded-2xl flex flex-col items-center gap-2 text-ink/60 hover:bg-ink/5 transition-colors">
            <Download className="w-5 h-5" />
            <span className="text-[10px] font-bold">匯出資料</span>
          </button>
          <button className="p-4 bg-background rounded-2xl flex flex-col items-center gap-2 text-ink/60 hover:bg-ink/5 transition-colors">
            <Upload className="w-5 h-5" />
            <span className="text-[10px] font-bold">匯入資料</span>
          </button>
          <button 
            onClick={clearAllData}
            className="p-4 bg-background rounded-2xl flex flex-col items-center gap-2 text-red-500/60 hover:bg-red-500/5 transition-colors"
          >
            <Database className="w-5 h-5" />
            <span className="text-[10px] font-bold">刪除全部資料</span>
          </button>
          <button 
            onClick={onLogout}
            className="p-4 bg-background rounded-2xl flex flex-col items-center gap-2 text-ink/60 hover:bg-ink/5 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-[10px] font-bold">登出系統</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('create');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  
  // Data State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [releases, setReleases] = useState<any[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  
  // UI State
  const [isPrinting, setIsPrinting] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
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

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 3000);
  };

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

    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'settings', 'connection_test'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubCustomers = onSnapshot(query(collection(db, 'customers'), orderBy('createdAt', 'desc')), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'customers'));

    const unsubOrders = onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), (snap) => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Order)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'orders'));

    const unsubMachines = onSnapshot(query(collection(db, 'machines'), orderBy('name', 'asc')), (snap) => {
      setMachines(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'machines'));

    const unsubReleases = onSnapshot(query(collection(db, 'releases'), orderBy('createdAt', 'desc')), (snap) => {
      setReleases(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'releases'));

    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (snap) => {
      if (snap.exists()) {
        setSettings({ id: snap.id, ...snap.data() } as SystemSettings);
      } else {
        // Initialize default settings
        const defaultSettings: Omit<SystemSettings, 'id'> = {
          notificationTemplate: DEFAULT_NOTIFICATION_TEMPLATE,
          priceMap: DEFAULT_PRICE_MAP,
          lastBackupAt: new Date().toISOString()
        };
        setDoc(doc(db, 'settings', 'global'), defaultSettings).catch(err => handleFirestoreError(err, OperationType.WRITE, 'settings/global'));
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, 'settings/global'));

    return () => {
      unsubCustomers();
      unsubOrders();
      unsubMachines();
      unsubReleases();
      unsubSettings();
    };
  }, [user]);

  // --- Handlers ---
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    onBeforePrint: async () => setIsPrinting(true),
    onAfterPrint: () => setIsPrinting(false),
  });

  const copyCustomerNotification = (customer: Customer) => {
    if (!settings) return;
    
    const customerOrders = orders.filter(o => o.customerId === customer.id);
    const allItems = customerOrders.flatMap(o => o.items);
    
    const itemsText = allItems.map(i => `${i.machineName} ${i.variant ? `(${i.variant})` : ''} x ${i.quantity} $${i.subtotal}`).join('\n');
    
    const upperPart = `親愛的 ${customer.name} 您好，
您本次的連線購物明細如下：

${itemsText}
----------------
消費總額：$${customer.totalSpent.toLocaleString()}`;

    const text = `${upperPart}

${settings.notificationTemplate}`;
    
    navigator.clipboard.writeText(text);
    showToast('已複製通知文字！');
  };

  const copyNotification = (order: Order) => {
    if (!settings) return;
    
    const itemsText = order.items.map(i => `${i.machineName} ${i.variant ? `(${i.variant})` : ''} x ${i.quantity} $${i.subtotal}`).join('\n');
    
    const upperPart = `親愛的 ${order.customerName} 您好，
您本次的連線購物明細如下：

${itemsText}
----------------
消費總額：$${order.totalAmount.toLocaleString()}`;

    const text = `${upperPart}

${settings.notificationTemplate}`;
    
    navigator.clipboard.writeText(text);
    showToast('已複製通知文字！');
  };

  const exportData = () => {
    const data = { customers, orders, settings, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cuibo_gasha_backup_${format(toZonedTime(new Date(), TAIWAN_TZ), 'yyyyMMdd')}.json`;
    a.click();
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        setConfirmModal({
          show: true,
          title: '還原資料',
          message: '確定要還原資料嗎？這將覆蓋現有資料！',
          type: 'danger',
          onConfirm: async () => {
            try {
              const batch = writeBatch(db);
              
              // Import customers
              data.customers.forEach((c: any) => {
                const { id, ...rest } = c;
                batch.set(doc(db, 'customers', id), rest);
              });
              
              // Import orders
              data.orders.forEach((o: any) => {
                const { id, ...rest } = o;
                batch.set(doc(db, 'orders', id), rest);
              });
              
              // Import settings
              if (data.settings) {
                const { id, ...rest } = data.settings;
                batch.set(doc(db, 'settings', 'global'), rest);
              }
              
              await batch.commit();
              showToast('資料還原成功！');
            } catch (err) {
              handleFirestoreError(err, OperationType.WRITE, 'batch_import');
            }
          }
        });
      } catch (err) {
        showToast('資料格式錯誤！', 'error');
      }
    };
    reader.readAsText(file);
  };

  const clearData = async () => {
    setConfirmModal({
      show: true,
      title: '清空資料',
      message: '警告：這將清空所有顧客與訂單資料！此操作不可逆。',
      type: 'danger',
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          customers.forEach(c => batch.delete(doc(db, 'customers', c.id)));
          orders.forEach(o => batch.delete(doc(db, 'orders', o.id)));
          await batch.commit();
          showToast('資料已清空。');
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, 'batch_clear');
        }
      }
    });
  };

  // --- Tab Content ---

  // --- Render Helpers ---
  if (loading) return <LoadingScreen />;
  if (!user) return <LoginScreen />;

  return (
    <ErrorBoundary>
      <div className="min-h-screen pb-24">
        <Header user={user} activeTab={activeTab} />
        
        <main className="max-w-4xl mx-auto px-6 py-8">
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
                />
              )}
              {activeTab === 'customers' && (
                <CustomersList 
                  customers={customers}
                  setConfirmModal={setConfirmModal}
                  showToast={showToast}
                  onSelectCustomer={setSelectedCustomer}
                  onCopyNotification={copyCustomerNotification}
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
                  showToast={showToast}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsView 
                  settings={settings} 
                  onLogout={() => signOut(auth)}
                  showToast={showToast}
                  setConfirmModal={setConfirmModal}
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
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Confirmation Modal */}
        <AnimatePresence>
          {confirmModal.show && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-ink/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-card-white w-full max-w-sm p-8 rounded-3xl card-shadow"
              >
                <h3 className="text-xl font-bold text-ink mb-4">{confirmModal.title}</h3>
                <p className="text-ink/60 mb-8 leading-relaxed">{confirmModal.message}</p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setConfirmModal(m => ({ ...m, show: false }))}
                    className="flex-1 py-4 bg-background text-ink rounded-2xl font-bold"
                  >
                    取消
                  </button>
                  <button 
                    onClick={() => {
                      confirmModal.onConfirm();
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
                "fixed bottom-28 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-full font-bold text-white shadow-xl flex items-center gap-2",
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
                <table className="w-full border-collapse mb-8">
                  <thead>
                    <tr className="border-b-2 border-black">
                      <th className="text-left py-2">項目</th>
                      <th className="text-center py-2">數量</th>
                      <th className="text-right py-2">小計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedOrder.items.map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-200">
                        <td className="py-2">{item.machineName} {item.variant && `(${item.variant})`}</td>
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
