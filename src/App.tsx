import React, { useState, useEffect, useRef, ReactNode } from 'react';
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
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User
} from 'firebase/auth';
import { GoogleGenAI, Type } from '@google/genai';
import { 
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, 
  query, orderBy, serverTimestamp, getDoc, getDocs, writeBatch,
  getDocFromServer, increment
} from 'firebase/firestore';
import { useReactToPrint } from 'react-to-print';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { auth, db, col, dbDoc } from './firebase';
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
  const [orderItems, setOrderItems] = useState([{ id: crypto.randomUUID(), variant: '', quantity: 1, isEco: false }]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isFullscreenImage, setIsFullscreenImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      const compressedDataUrl = await compressImage(file);
      
      // 檢查是否已經上傳過相同的圖片
      const existingMachineByImg = machines.find(m => m.imageUrl === compressedDataUrl);
      if (existingMachineByImg) {
        setMachineName(existingMachineByImg.name);
        setPrice(existingMachineByImg.defaultPrice);
        if (existingMachineByImg.variants && existingMachineByImg.variants.length > 0) {
          setOrderItems(existingMachineByImg.variants.map((v: string) => ({ id: crypto.randomUUID(), variant: v, quantity: 1, isEco: false })));
        } else {
          setOrderItems([{ id: crypto.randomUUID(), variant: '', quantity: 1, isEco: false }]);
        }
        setUploadedImage(compressedDataUrl);
        showToast('已載入相同圖片的機台資料！', 'success');
        setIsAnalyzing(false);
        return;
      }

      const base64String = compressedDataUrl.split(',')[1];
      setUploadedImage(compressedDataUrl);
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const response = await ai.models.generateContent({
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
你是一位嚴謹且精通日文的電商倉儲與商品辨識 AI 專家，專為代購營運系統設計，負責將視覺資訊精準轉化為高效率、易於複製的撿貨標籤與建檔資料，協助倉儲助理無縫管理扭蛋等商品訂單。

[背景資訊]
為了提升實體撿貨的直覺性與作業效率，必須將圖片中的商品轉換為標準化名稱。以圖片確切證據為優先，遇遮擋、標籤不清楚或缺乏明顯特徵時，必須主動啟動網路搜尋進行交叉比對與補全。維持撿貨名稱與視覺特徵的高度一致性是庫存管理的核心。

[具體指令]
1. 歷史翻譯與特徵擷取：精確辨識圖片中的日文原文與核心外觀特徵（如顏色、手持配件、動作）。
2. 標準化組合：將名稱依序組合為：[販售地點/品牌] [主要角色/系列總稱] [款式視覺核心特徵] [物品類型]。
3. 扭蛋特殊處理（15字極簡標題 + 肉眼優先檢貨標籤）：若商品為扭蛋，請翻譯中文名稱，並建立「系列檢貨標題」。標題總字數嚴格限制在 15 字以內（主動去除贅字，僅保留核心角色與主題）。接著，完整條列該系列「每一款」的名稱與具備最強視覺識別性的「視覺特徵檢貨名稱」。格式請務必使用：[角色/款式名稱] [視覺特徵]（例如：美樂蒂 手上拿麥克風）。請勿包含括號或「檢貨」字樣，以確保列印美觀。
4. 個別獨立介紹：將圖片中的商品個別分開列出。

[約束條件]
- 視覺核心優先與字數限制：去除所有行銷贅字。扭蛋系列檢貨標題絕對不可超過 15 個字。單款視覺特徵檢貨名稱應極致精煉，專注描述核心外觀差異，格式為「名稱+特徵」。
- 現有機台優先：如果圖片中的商品明顯屬於以下「現有機台清單」中的某一款，請務必直接使用該機台的精確名稱作為 machineName 回傳，不要自己發明新名稱。
  現有機台清單：${machines.map(m => m.name).join(', ')}
- 證據優先：嚴禁使用「可能、應該、或許」等模糊推測。
- 允許留白：若信心水準仍低於 90% 或無法確認品項，請直接放棄該品項命名，並輸出：「【資料不足，無法確認】」。
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
                  description: "視覺特徵檢貨名稱，格式：[角色名稱] [特徵]，例如：美樂蒂 手上拿麥克風"
                }
              },
              price: { 
                type: Type.NUMBER,
                description: "辨識出的金額"
              }
            }
          }
        }
      });

      const text = response.text;
      if (text) {
        const result = JSON.parse(text);
        const aiMachineName = result.machineName || '';
        
        // 檢查 AI 回傳的機台名稱是否已存在
        const existingMachineByName = machines.find(m => m.name === aiMachineName);
        
        if (existingMachineByName) {
          setMachineName(existingMachineByName.name);
          setPrice(existingMachineByName.defaultPrice);
          // 如果 AI 有辨識出款式，優先使用 AI 辨識的款式作為當前訂單項目
          if (result.variants && result.variants.length > 0) {
            setOrderItems(result.variants.map((v: string) => ({ id: crypto.randomUUID(), variant: v, quantity: 1, isEco: false })));
          } else if (result.variant) {
            setOrderItems([{ id: crypto.randomUUID(), variant: result.variant, quantity: 1, isEco: false }]);
          } else {
            setOrderItems([{ id: crypto.randomUUID(), variant: '', quantity: 1, isEco: false }]);
          }
          showToast('已載入同名機台的現有資料！', 'success');
        } else {
          if (aiMachineName) setMachineName(aiMachineName);
          if (result.variants && result.variants.length > 0) {
            setOrderItems(result.variants.map((v: string) => ({ id: crypto.randomUUID(), variant: v, quantity: 1, isEco: false })));
          } else if (result.variant) {
            setOrderItems([{ id: crypto.randomUUID(), variant: result.variant, quantity: 1, isEco: false }]);
          } else {
            setOrderItems([{ id: crypto.randomUUID(), variant: '', quantity: 1, isEco: false }]);
          }
          if (result.price) {
            const map = settings?.priceMap || DEFAULT_PRICE_MAP;
            if (map[result.price]) {
               setPrice(result.price);
            } else {
               setPrice(result.price);
            }
          }
          showToast('圖片分析完成！', 'success');
        }
      }
      setIsAnalyzing(false);
    } catch (err) {
      console.error(err);
      showToast('圖片分析失敗，請稍後再試', 'error');
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
    
    try {
      let customerId: string | undefined;
      let existingOrder: Order | undefined;

      if (totalAddedQuantity > 0) {
        // 1. Find or Create Customer
        let customer = customers.find(c => c.name.replace(/\s+/g, '') === trimmedName);
        customerId = customer?.id;

        if (!customer) {
          const newCustRef = dbDoc('customers');
          const newCust: Omit<Customer, 'id'> = {
            name: trimmedName,
            totalSpent: 0,
            totalItems: 0,
            createdAt: now,
            lastOrderAt: now
          };
          await setDoc(newCustRef, newCust);
          customerId = newCustRef.id;
          customer = { id: customerId, ...newCust };
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
          isChecked: false
        });
      }

      if (totalAddedQuantity > 0 && customerId) {
        if (existingOrder) {
          await updateDoc(dbDoc('orders', existingOrder.id), {
            items: updatedItems,
            totalAmount: existingOrder.totalAmount + totalAddedAmount,
            updatedAt: now
          });
        } else {
          // Create new order
          const orderRef = dbDoc('orders');
          const newOrder: Omit<Order, 'id'> = {
            customerId: customerId!,
            customerName: trimmedName,
            items: updatedItems,
            totalAmount: totalAddedAmount,
            status: 'pending',
            createdAt: now,
            updatedAt: now
          };
          await setDoc(orderRef, newOrder);
        }
        
        // 3. Update customer stats
        await updateDoc(dbDoc('customers', customerId!), {
          totalSpent: increment(totalAddedAmount),
          totalItems: increment(totalAddedQuantity),
          lastOrderAt: now
        });
      }

      // 4. Update Machine Variants and Image
      const machine = machines.find(m => m.name === machineName);
      if (machine) {
        const variantsToAdd = Array.from(newVariantsToSave).filter(v => !machine.variants.includes(v));
        const updates: any = { updatedAt: now };
        if (variantsToAdd.length > 0) {
          updates.variants = [...machine.variants, ...variantsToAdd];
        }
        if (uploadedImage && machine.imageUrl !== uploadedImage) {
          updates.imageUrl = uploadedImage;
        }
        if (Object.keys(updates).length > 1) { // more than just updatedAt
          await updateDoc(dbDoc('machines', machine.id), updates);
        }
      } else {
        const machineRef = dbDoc('machines');
        const newMachine: any = {
          name: machineName,
          defaultPrice: parseInt(price) || 0,
          variants: Array.from(newVariantsToSave),
          createdAt: now,
          updatedAt: now
        };
        if (uploadedImage) {
          newMachine.imageUrl = uploadedImage;
        }
        await setDoc(machineRef, newMachine);
      }

      showToast(totalAddedQuantity > 0 ? '訂單已更新/建立！' : '機台資料已建立！');

      // Handle Modes
      if (mode === 'same_cust') {
        // Clear items, keep customer
        setMachineName('');
        setOrderItems([{ id: crypto.randomUUID(), variant: '', quantity: 1, isEco: false }]);
        setUploadedImage(null);
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
        setActiveTab('create');
      }
    } catch (err: any) {
      console.error(err);
      showToast(err?.message?.includes('Missing or insufficient') ? '無法連線：資料驗證或權限不足，請檢查資料格式！' : '發生錯誤，請稍後再試！', 'error');
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
              <img src={uploadedImage} alt="Uploaded" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                <span className="bg-black/50 text-white px-3 py-1 rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity">點擊放大</span>
              </div>
            </div>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setUploadedImage(null);
              }}
              className="absolute top-2 right-2 p-2 bg-white/80 hover:bg-white rounded-full shadow-sm text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 mb-4">
          <SuggestiveInput 
            value={machineName}
            onChange={setMachineName}
            placeholder="輸入機台名稱 (例: 吉伊卡哇)"
            suggestions={machineSuggestions}
          />
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
              src={uploadedImage} 
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
  const [editingItem, setEditingItem] = useState<{ orderId: string, item: OrderItem } | null>(null);

  const handleUpdateItem = async (orderId: string, updatedItem: OrderItem) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      const oldItem = order.items.find(i => i.id === updatedItem.id);
      const qtyDiff = updatedItem.quantity - (oldItem?.quantity || 0);

      const newItems = order.items.map(i => i.id === updatedItem.id ? updatedItem : i);
      const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);

      await updateDoc(dbDoc('orders', orderId), {
        items: newItems,
        totalAmount: newTotal,
        updatedAt: new Date().toISOString()
      });
      
      // Update customer total spent and total items
      const diff = newTotal - order.totalAmount;
      await updateDoc(dbDoc('customers', order.customerId), {
        totalSpent: increment(diff),
        totalItems: increment(qtyDiff)
      });

      setEditingItem(null);
      showToast('更新成功');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
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
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
    }
  };

  // Flatten and mix in order metadata
  const flattenedItems = orders.flatMap(order => 
    order.items.map(item => ({
      ...item,
      orderId: order.id,
      customerName: order.customerName,
      customerId: order.customerId,
      orderTime: item.createdAt || order.createdAt || new Date().toISOString()
    }))
  );

  const filteredItems = flattenedItems.filter(item => {
    const lowerSearch = searchTerm.toLowerCase();
    const itemDate = item.orderTime ? format(toZonedTime(new Date(item.orderTime), TAIWAN_TZ), 'yyyy-MM-dd') : '';
    
    return (item.customerName.toLowerCase().includes(lowerSearch) ||
           item.machineName.toLowerCase().includes(lowerSearch) ||
           (item.variant && item.variant.toLowerCase().includes(lowerSearch))) &&
           (!dateFilter || itemDate === dateFilter);
  });

  // Sort by orderTime based on sortOrder
  const sortedItems = filteredItems.sort((a, b) => {
    const timeA = new Date(a.orderTime).getTime();
    const timeB = new Date(b.orderTime).getTime();
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
        <div className="flex flex-row gap-4">
          <input 
            type="date" 
            className="px-4 py-3 bg-background rounded-xl border-none text-ink cursor-pointer outline-none focus:ring-2 focus:ring-primary-blue"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
          <button
            onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-2 px-4 py-3 bg-background rounded-xl text-ink font-medium whitespace-nowrap hover:bg-ink/5 transition-colors"
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
                      <img src={machine.imageUrl} alt={item.machineName} className="w-full h-full object-cover relative z-10 transition-transform group-hover:scale-110" referrerPolicy="no-referrer" />
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
                    <span className="text-xs text-ink/40 tracking-tight">
                      {format(toZonedTime(new Date(item.orderTime), TAIWAN_TZ), 'yyyy/MM/dd HH:mm')}
                    </span>
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
                        message: `確定要從這個顧客的清單中刪除 ${editingItem.item.machineName} 嗎？`,
                        type: 'danger',
                        onConfirm: async () => {
                          const order = orders.find(o => o.id === editingItem.orderId);
                          if (!order) return;
                          const newItems = order.items.filter(i => i.id !== editingItem.item.id);
                          const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);
                          
                          try {
                            if (newItems.length === 0) {
                              await deleteDoc(dbDoc('orders', order.id));
                            } else {
                              await updateDoc(dbDoc('orders', order.id), {
                                items: newItems,
                                totalAmount: newTotal,
                                updatedAt: new Date().toISOString()
                              });
                            }
                            
                            // Update customer stats
                            await updateDoc(dbDoc('customers', order.customerId), {
                              totalSpent: increment(-editingItem.item.subtotal),
                              totalItems: increment(-editingItem.item.quantity)
                            });
                            
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
  const [sortBy, setSortBy] = useState<'name' | 'spent'>('spent');

  const handleSyncAllStats = async () => {
    try {
      const batch = writeBatch(db);
      customers.forEach(customer => {
        const custOrders = orders.filter(o => o.customerId === customer.id);
        const actualTotalSpent = custOrders.reduce((sum, o) => sum + o.totalAmount, 0);
        const actualTotalItems = custOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
        
        batch.update(dbDoc('customers', customer.id), {
          totalSpent: actualTotalSpent,
          totalItems: actualTotalItems
        });
      });
      await batch.commit();
      showToast('所有顧客數據已同步');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'customers_sync');
    }
  };

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
        <div className="flex items-center gap-2">
          <button 
            onClick={handleSyncAllStats}
            className="p-4 bg-card-white text-primary-blue rounded-2xl card-shadow hover:bg-primary-blue/5 transition-colors"
            title="同步所有顧客數據"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
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
                            const batch = writeBatch(db);
                            batch.delete(dbDoc('customers', customer.id));
                            
                            if (checked) {
                              const customerOrders = orders.filter(o => o.customerId === customer.id);
                              customerOrders.forEach(order => {
                                batch.delete(dbDoc('orders', order.id));
                              });
                            }
                            
                            await batch.commit();
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
      )}
    </div>
  );
};

const MachineEditModal = ({
  machine,
  onClose,
  onSave,
  onDelete,
  orders,
  settings,
  showToast
}: {
  machine: any;
  onClose: () => void;
  onSave: (data: any, oldName: string, variantMapping: Record<string, string>, syncWithOrders: boolean) => Promise<void>;
  onDelete: (machineId: string, machineName: string) => void;
  orders: Order[];
  settings: SystemSettings | null;
  showToast: (m: string, t?: 'success' | 'error') => void;
}) => {
  const [name, setName] = useState(machine.name);
  const [price, setPrice] = useState(machine.defaultPrice.toString());
  const [variantList, setVariantList] = useState<string[]>(machine.variants || []);
  const [newVariant, setNewVariant] = useState('');
  const [editingVariantIndex, setEditingVariantIndex] = useState<number | null>(null);
  const [editingVariantValue, setEditingVariantValue] = useState('');
  const [variantMapping, setVariantMapping] = useState<Record<string, string>>({});
  const [uploadedImage, setUploadedImage] = useState<string | null>(machine.imageUrl || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      imageUrl: uploadedImage
    }, machine.name, variantMapping, syncWithOrders);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-background w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
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
                  <img src={uploadedImage} alt="Machine" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
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

  // Derive all unique machine names from orders
  const machineNamesFromOrders = Array.from(new Set(orders.flatMap(o => o.items.map(i => i.machineName))));
  
  // Combine with existing configured machines
  const allMachineNames = Array.from(new Set([
    ...machineNamesFromOrders,
    ...machines.map(m => m.name)
  ])).sort();

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
      onConfirm: async () => {
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
              createdAt: now,
              updatedAt: now
            });
            addedCount++;
          });

          await batch.commit();
          showToast(`成功初始化 ${addedCount} 個機台！`);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'machines_batch_init');
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
      await setDoc(newDocRef, data);
      showToast('機台新增成功');
      reset();
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
                    <img src={config.imageUrl} alt={machineName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <Package className="w-8 h-8 text-ink/10" />
                  )}
                </div>
              )}
              
              <div className={cn("flex-1 flex", viewMode === 'list' ? "gap-4" : "p-4 flex-col gap-2")}>
                {viewMode === 'list' && (
                  <div className="w-12 h-12 bg-background rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0">
                    {config?.imageUrl ? (
                      <img src={config.imageUrl} alt={machineName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
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
                          {config.variants.map((v: string) => (
                            <span key={v} className="px-2 py-1 bg-background rounded text-[10px] font-bold text-ink/60">{v}</span>
                          ))}
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
  const [releasingItem, setReleasingItem] = useState<{ orderId: string, item: OrderItem } | null>(null);
  const [releaseQuantity, setReleaseQuantity] = useState(1);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(customer.name);

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

    try {
      const batch = writeBatch(db);
      
      // Update customer doc
      batch.update(dbDoc('customers', customer.id), { name: newName });
      
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
      showToast('顧客名稱已更新');
      setIsEditingName(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `customers/${customer.id}`);
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
      handleFirestoreError(err, OperationType.WRITE, `customers/${customer.id}`);
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
      const consolidatedItem = { ...updatedItem };
      delete consolidatedItem.rawIds;
      // We assign it the ID of the first raw item to keep continuity
      consolidatedItem.id = rawIds[0];
      newItems.push(consolidatedItem);
      
      const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);

      await updateDoc(dbDoc('orders', orderId), {
        items: newItems,
        totalAmount: newTotal,
        updatedAt: new Date().toISOString()
      });
      
      // Update customer total spent and total items
      const diff = newTotal - order.totalAmount;
      await updateDoc(dbDoc('customers', customer.id), {
        totalSpent: increment(diff),
        totalItems: increment(qtyDiff)
      });

      setEditingItem(null);
      showToast('更新成功');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
    }
  };

  const handleTransfer = async () => {
    if (!transferringItem || !targetCustomerName.replace(/\s+/g, '') || transferQuantity < 1) return;
    const { orderId, item } = transferringItem;
    // @ts-ignore
    const rawIds = item.rawIds || [item.id];
    const trimmedTarget = targetCustomerName.replace(/\s+/g, '');

    if (trimmedTarget === customer.name.replace(/\s+/g, '')) {
      showToast('不能轉讓給原顧客自己！', 'error');
      return;
    }

    try {
      // 1. Find or create target customer
      let targetCust = customers.find(c => c.name.replace(/\s+/g, '') === trimmedTarget);
      let targetId = targetCust?.id;

      if (!targetCust) {
        const newCustRef = dbDoc('customers');
        const newCust = {
          name: trimmedTarget,
          totalSpent: 0,
          totalItems: 0,
          createdAt: new Date().toISOString(),
          lastOrderAt: new Date().toISOString()
        };
        await setDoc(newCustRef, newCust);
        targetId = newCustRef.id;
        targetCust = { id: targetId, ...newCust } as Customer;
      }

      // 2. Remove or update from current order
      const currentOrder = orders.find(o => o.id === orderId);
      if (!currentOrder) return;

      const transferSubtotal = item.price * transferQuantity;
      
      // Filter out raw items to rebuild
      let newItems = currentOrder.items.filter(i => !rawIds.includes(i.id));
      
      if (transferQuantity < item.quantity) {
        // We push a consolidated remaining item to simplify logic
        newItems.push({
          ...item,
          id: rawIds[0],
          quantity: item.quantity - transferQuantity,
          subtotal: item.subtotal - transferSubtotal
        });
      }
      
      const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);
      await updateDoc(dbDoc('orders', orderId), {
        items: newItems,
        totalAmount: newTotal,
        updatedAt: new Date().toISOString()
      });
      await updateDoc(dbDoc('customers', customer.id), {
        totalSpent: increment(-transferSubtotal),
        totalItems: increment(-transferQuantity)
      });

      // 3. Add to target customer's pending order or create new
      const targetOrder = orders.find(o => o.customerId === targetId && o.status === 'pending');
      const now = new Date().toISOString();
      const transferredNewItem = { ...item, id: crypto.randomUUID(), quantity: transferQuantity, subtotal: transferSubtotal, createdAt: now };
      delete transferredNewItem.rawIds;

      if (targetOrder) {
        const updatedItems = [...targetOrder.items, transferredNewItem];

        await updateDoc(dbDoc('orders', targetOrder.id), {
          items: updatedItems,
          totalAmount: targetOrder.totalAmount + transferSubtotal,
          updatedAt: now
        });
      } else {
        await setDoc(dbDoc('orders'), {
          customerId: targetId,
          customerName: trimmedTarget,
          items: [transferredNewItem],
          totalAmount: transferSubtotal,
          status: 'pending',
          createdAt: now,
          updatedAt: now
        });
      }
      await updateDoc(dbDoc('customers', targetId!), {
        totalSpent: increment(transferSubtotal),
        totalItems: increment(transferQuantity),
        lastOrderAt: new Date().toISOString()
      });

      setTransferringItem(null);
      setTargetCustomerName('');
      showToast(`已轉讓給 ${trimmedTarget}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'transfer');
    }
  };

  const handleReleaseToggle = async (orderId: string, item: OrderItem & { rawIds?: string[] }) => {
    try {
      const rawIds = item.rawIds || [item.id];
      const existing = releases.find(r => r.orderId === orderId && rawIds.includes(r.itemId) && r.status === 'pending');
      if (existing) {
        await deleteDoc(dbDoc('releases', existing.id));
        showToast('已取消釋出');
      } else {
        setReleasingItem({ orderId, item: { ...item, id: rawIds[0] } });
        setReleaseQuantity(item.quantity);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'releases');
    }
  };

  const handleConfirmRelease = async () => {
    if (!releasingItem || releaseQuantity < 1) return;
    const { orderId, item } = releasingItem;
    try {
      const releaseRef = dbDoc('releases');
      const releaseData: any = {
        orderId,
        itemId: item.id,
        customerName: customer.name,
        machineName: item.machineName,
        quantity: releaseQuantity,
        price: item.price,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      if (item.variant) {
        releaseData.variant = item.variant;
      }
      await setDoc(releaseRef, releaseData);
      showToast('正在釋出中');
      setReleasingItem(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'releases');
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
    return grouped;
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
        <button 
          onClick={onCopyNotification}
          className="px-4 py-2 bg-primary-blue/10 text-primary-blue rounded-xl font-bold text-sm hover:bg-primary-blue/20 transition-colors"
        >
          複製通知
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 pb-32">
        {customerOrders.map(order => {
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
                          await deleteDoc(dbDoc('orders', order.id));
                          
                          // Update customer stats
                          await updateDoc(dbDoc('customers', order.customerId), {
                            totalSpent: increment(-order.totalAmount),
                            totalItems: increment(-order.items.reduce((sum, i) => sum + i.quantity, 0))
                          });

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
                {groupedItems.map((item, idx) => {
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
                            <img src={machine.imageUrl} alt={item.machineName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
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
                            <p className="text-[10px] text-ink/30">{formatDateTime(item.createdAt)}</p>
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
              })}
            </div>
          </div>
          );
        })}
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
                          
                          const rawIds = (editingItem.item as any).rawIds || [editingItem.item.id];
                          const newItems = order.items.filter(i => !rawIds.includes(i.id));
                          
                          const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);
                          
                          try {
                            if (newItems.length === 0) {
                              await deleteDoc(dbDoc('orders', order.id));
                            } else {
                              await updateDoc(dbDoc('orders', order.id), {
                                items: newItems,
                                totalAmount: newTotal,
                                updatedAt: new Date().toISOString()
                              });
                            }
                            
                            // Update customer stats
                            await updateDoc(dbDoc('customers', order.customerId), {
                              totalSpent: increment(-editingItem.item.subtotal),
                              totalItems: increment(-editingItem.item.quantity)
                            });
                            
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
              
              <div className="mb-4">
                <label className="text-xs font-bold text-ink/40 block mb-2">釋出數量</label>
                <div className="flex items-center gap-4">
                  <button onClick={() => setReleaseQuantity(Math.max(1, releaseQuantity - 1))} className="w-10 h-10 bg-background rounded-full flex items-center justify-center shadow-sm">-</button>
                  <span className="text-xl font-bold w-8 text-center">{releaseQuantity}</span>
                  <button onClick={() => setReleaseQuantity(Math.min(releasingItem.item.quantity, releaseQuantity + 1))} className="w-10 h-10 bg-background rounded-full flex items-center justify-center shadow-sm">+</button>
                </div>
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
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between bg-card-white p-4 rounded-2xl card-shadow">
        <h2 className="text-xl font-bold text-ink">列印預覽</h2>
        <button 
          onClick={() => handlePrint()}
          className="px-6 py-2 bg-primary-blue text-white rounded-xl font-bold flex items-center gap-2"
        >
          <Printer className="w-4 h-4" /> 列印所選 ({selectedIds.length})
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-1/3 space-y-2">
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

        <div className="hidden lg:block w-full lg:w-2/3 bg-ink/5 rounded-3xl p-4 sm:p-8 overflow-y-auto max-h-[70vh]">
          <div ref={printRef} className="bg-white w-[210mm] min-h-[297mm] mx-auto p-12 shadow-2xl print:shadow-none print:m-0 print:w-full print:p-0">
            <style>{`
              @media print {
                @page {
                  size: A4;
                  margin: 10mm;
                }
                body {
                  -webkit-print-color-adjust: exact;
                }
                .customer-section {
                  break-inside: avoid;
                  margin-bottom: 2rem;
                  padding-bottom: 2rem;
                  border-bottom: 1px dashed #ccc;
                }
                .customer-section.long-order {
                  break-inside: auto;
                }
                table {
                  width: 100%;
                  border-collapse: collapse;
                  table-layout: fixed;
                }
                thead {
                  display: table-header-group;
                }
                tr {
                  break-inside: avoid;
                }
              }
            `}</style>
            <div className="space-y-8 print:space-y-0">
              {customers.filter(c => selectedIds.includes(c.id)).map(customer => {
                const custOrders = orders.filter(o => o.customerId === customer.id);
                const allItems = custOrders.flatMap(o => o.items);
                const isLongOrder = allItems.length > 12;

                return (
                  <div 
                    key={customer.id} 
                    className={cn(
                      "customer-section last:border-none print:pb-8",
                      isLongOrder && "long-order"
                    )}
                  >
                    <table className="w-full text-left">
                      <thead>
                        <tr className="print-header">
                          <th colSpan={6} className="pb-4">
                            <div className="text-center border-b-2 border-ink pb-4 mb-4">
                              <h1 className="text-2xl font-bold text-ink">
                                {customer.name} 扭蛋訂單明細
                              </h1>
                              <div className="flex justify-between items-center mt-2 text-[10px] font-bold text-ink/60">
                                <span>列印日期：{format(toZonedTime(new Date(), TAIWAN_TZ), 'yyyy/MM/dd')}</span>
                                <span>顧客：{customer.name}</span>
                              </div>
                            </div>
                          </th>
                        </tr>
                        <tr className="border-b-2 border-ink text-sm bg-ink/5 print:bg-transparent">
                          <th className="py-2 px-2 w-[8%] text-center"></th>
                          <th className="py-2 px-2 w-[40%]">機台名稱</th>
                          <th className="py-2 px-2 w-[22%]">款式</th>
                          <th className="py-2 px-2 w-[10%]">單價</th>
                          <th className="py-2 px-2 w-[8%]">數量</th>
                          <th className="py-2 px-2 w-[12%] text-right">小計</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allItems.map((item, idx) => (
                          <tr key={idx} className="border-b border-divider text-sm print:border-ink/10">
                            <td className="py-2 px-2 text-center align-middle">
                              <div className="w-4 h-4 border-2 border-ink/40 rounded-sm mx-auto print:border-black"></div>
                            </td>
                            <td className="py-2 px-2">
                              <div className="font-medium">{item.machineName}</div>
                              <div className="text-[10px] text-ink/30 print:text-ink/50">{formatDateTime(item.createdAt)}</div>
                            </td>
                            <td className="py-2 px-2">{item.variant || '-'}</td>
                            <td className="py-2 px-2">NT${item.price}</td>
                            <td className="py-2 px-2">{item.quantity}</td>
                            <td className="py-2 px-2 text-right font-bold">NT${item.subtotal}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={5} className="py-4 text-right font-bold text-sm">總計金額：</td>
                          <td className="py-4 text-right font-bold text-xl text-primary-blue print:text-ink">NT${customer.totalSpent}</td>
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
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const filteredOrders = orders.map(o => {
    if (!startDate && !endDate) return o;
    
    const filteredItems = o.items.filter(item => {
      if (!item.createdAt) return false;
      const itemDateStr = format(toZonedTime(new Date(item.createdAt), TAIWAN_TZ), 'yyyy-MM-dd');
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

  const pendingReleases = releases.filter(r => r.status === 'pending');

  const [transferringRelease, setTransferringRelease] = useState<any | null>(null);
  const [targetCustomerName, setTargetCustomerName] = useState('');

  const handleReleaseTransfer = async () => {
    if (!transferringRelease || !targetCustomerName.replace(/\s+/g, '')) return;
    const release = transferringRelease;
    const trimmedTarget = targetCustomerName.replace(/\s+/g, '');

    if (trimmedTarget === release.customerName.replace(/\s+/g, '')) {
      showToast('不能轉讓給原顧客自己！', 'error');
      return;
    }

    try {
      // 1. Find or create target customer
      let targetCust = customers.find(c => c.name.replace(/\s+/g, '') === trimmedTarget);
      let targetId = targetCust?.id;

      if (!targetCust) {
        const newCustRef = dbDoc('customers');
        const newCust = {
          name: trimmedTarget,
          totalSpent: 0,
          totalItems: 0,
          createdAt: new Date().toISOString(),
          lastOrderAt: new Date().toISOString()
        };
        await setDoc(newCustRef, newCust);
        targetId = newCustRef.id;
        targetCust = { id: targetId, ...newCust } as Customer;
      }

      // 2. Update release status
      await updateDoc(dbDoc('releases', release.id), { status: 'completed' });
      
      // 3. Update the original order item and customer
      const orderRef = dbDoc('orders', release.orderId);
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
        } else {
          await updateDoc(orderRef, {
            items: updatedItems,
            totalAmount: newTotal,
            updatedAt: new Date().toISOString()
          });
        }

        // Update original customer's totalSpent and totalItems
        if (itemToTransfer) {
          await updateDoc(dbDoc('customers', orderData.customerId), {
            totalSpent: increment(-itemToTransfer.subtotal),
            totalItems: increment(-itemToTransfer.quantity)
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
        const now = new Date().toISOString();
        if (targetOrder) {
          const updatedItems = [...targetOrder.items, { ...transferredItem, createdAt: now }];

          await updateDoc(dbDoc('orders', targetOrder.id), {
            items: updatedItems,
            totalAmount: targetOrder.totalAmount + transferredItem.subtotal,
            updatedAt: now
          });
        } else {
          await setDoc(dbDoc('orders'), {
            customerId: targetId,
            customerName: trimmedTarget,
            items: [{ ...transferredItem, createdAt: now }],
            totalAmount: transferredItem.subtotal,
            status: 'pending',
            createdAt: now,
            updatedAt: now
          });
        }
        await updateDoc(dbDoc('customers', targetId!), {
          totalSpent: increment(transferredItem.subtotal),
          totalItems: increment(transferredItem.quantity),
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-card-white p-4 rounded-2xl card-shadow">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-ink/40" />
          <span className="font-bold text-ink text-sm">日期區間篩選</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
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
              <span className="bg-primary-blue/10 text-primary-blue px-2 py-1 rounded text-[10px]">{pendingReleases.length} 筆待處理</span>
              <span className="bg-orange-500/10 text-orange-500 px-2 py-1 rounded text-[10px]">共 {pendingReleases.reduce((sum, r) => sum + r.quantity, 0)} 顆</span>
            </div>
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
                      來自 <span className="font-bold text-ink/60">{r.customerName}</span> • {r.quantity} 顆 • NT${r.price}/顆 • {formatDateTime(r.createdAt)}
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

      await updateDoc(dbDoc('settings', 'global'), {
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
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  
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
      imageUrl: data.imageUrl,
      updatedAt: now
    };

    try {
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
      showToast(syncWithOrders ? '機台設定與訂單已同步更新' : '機台設定已儲存');
      setEditingMachine(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'machines_sync');
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
          showToast('機台已刪除');
          setEditingMachine(null);
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `machines/${machineId}`);
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
        await getDocFromServer(dbDoc('settings', 'connection_test'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubCustomers = onSnapshot(query(col('customers'), orderBy('createdAt', 'desc')), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'customers'));

    const unsubOrders = onSnapshot(query(col('orders'), orderBy('createdAt', 'desc')), (snap) => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Order)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'orders'));

    const unsubMachines = onSnapshot(query(col('machines'), orderBy('name', 'asc')), (snap) => {
      setMachines(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'machines'));

    const unsubReleases = onSnapshot(query(col('releases'), orderBy('createdAt', 'desc')), (snap) => {
      setReleases(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'releases'));

    const unsubSettings = onSnapshot(dbDoc('settings', 'global'), (snap) => {
      if (snap.exists()) {
        setSettings({ id: snap.id, ...snap.data() } as SystemSettings);
      } else {
        // Initialize default settings
        const defaultSettings: Omit<SystemSettings, 'id'> = {
          notificationTemplate: DEFAULT_NOTIFICATION_TEMPLATE,
          priceMap: DEFAULT_PRICE_MAP,
          lastBackupAt: new Date().toISOString()
        };
        setDoc(dbDoc('settings', 'global'), defaultSettings).catch(err => handleFirestoreError(err, OperationType.WRITE, 'settings/global'));
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
    return grouped;
  };

  const copyCustomerNotification = (customer: Customer) => {
    if (!settings) return;
    
    const customerOrders = orders.filter(o => o.customerId === customer.id);
    const allItems = groupItemsHelper(customerOrders.flatMap(o => o.items));
    
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
    
    const groupedItems = groupItemsHelper(order.items);
    const itemsText = groupedItems.map(i => `${i.machineName} ${i.variant ? `(${i.variant})` : ''} x ${i.quantity} $${i.subtotal}`).join('\n');
    
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
                batch.set(dbDoc('customers', id), rest);
              });
              
              // Import orders
              data.orders.forEach((o: any) => {
                const { id, ...rest } = o;
                batch.set(dbDoc('orders', id), rest);
              });
              
              // Import settings
              if (data.settings) {
                const { id, ...rest } = data.settings;
                batch.set(dbDoc('settings', 'global'), rest);
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
          customers.forEach(c => batch.delete(dbDoc('customers', c.id)));
          orders.forEach(o => batch.delete(dbDoc('orders', o.id)));
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
              settings={settings}
              showToast={showToast}
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
                <p className="text-ink/60 mb-6 leading-relaxed">{confirmModal.message}</p>
                
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
                "fixed bottom-28 left-1/2 -translate-x-1/2 z-[130] px-6 py-3 rounded-full font-bold text-white shadow-xl flex items-center gap-2",
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
