export interface Customer {
  id: string;
  name: string;
  phone?: string;
  lineId?: string;
  fbName?: string;
  aliases?: string[];
  totalSpent: number;
  totalItems: number;
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
  createdAt: string;
  callTime?: string;
  releaseAt?: string;
  transferAt?: string;
  exchangeAt?: string;
  sourceCustomerId?: string;
  sourceCustomerName?: string;
  updatedAt?: string;
  isChecked?: boolean;
}

export interface MachineVariantDetail {
  name: string;
  originalName?: string;
  feature?: string;
  aliases?: string[];
  active?: boolean;
}

export interface Machine {
  id: string;
  name: string;
  defaultPrice: number;
  variants: string[];
  variantDetails?: Record<string, MachineVariantDetail>;
  imageUrl?: string;
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
  releaseAt?: string;
  transferredAt?: string;
  transferTargetCustomerId?: string;
  transferTargetCustomerName?: string;
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
  lastDriveBackupAt?: string;
}

export interface OperationLog {
  id: string;
  action: string;
  targetType: string;
  targetName?: string;
  message: string;
  details?: Record<string, any>;
  createdAt: string;
}
