export interface Customer {
  id: string;
  name: string;
  phone?: string;
  lineId?: string;
  fbName?: string;
  totalSpent: number;
  orderCount: number;
  lastOrderAt: string;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  machineId?: string;
  machineName: string;
  price: number;
  quantity: number;
  variant?: string;
  subtotal: number;
  isReleased?: boolean;
  releaseQuantity?: number;
}

export interface Machine {
  id: string;
  name: string;
  defaultPrice: number;
  variants: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Release {
  id: string;
  orderId: string;
  itemId: string;
  customerName: string;
  machineName: string;
  variant?: string;
  quantity: number;
  price: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: string;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export interface SystemSettings {
  id: string;
  notificationTemplate: string;
  priceMap: Record<number, number>; // JPY to TWD mapping
  lastBackupAt?: string;
}
