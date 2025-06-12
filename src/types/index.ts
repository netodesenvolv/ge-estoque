
export interface Item {
  id: string;
  name: string;
  code: string;
  category: string;
  unitOfMeasure: string;
  minQuantity: number;
  currentQuantityCentral: number;
  supplier?: string;
  expirationDate?: string; // ISO date string, e.g., "YYYY-MM-DD"
}

export interface Hospital {
  id: string;
  name: string;
  address?: string;
}

export interface ServedUnit {
  id: string;
  name: string;
  location: string;
  hospitalId: string;
  hospitalName?: string; // For display convenience
}

export interface StockItemConfig {
  id: string;
  itemId: string;
  itemName?: string; // For display purposes
  unitId?: string; // Nullable for central warehouse
  unitName?: string; // For display
  hospitalId?: string; // Only relevant if unitId is present
  hospitalName?: string; // Only relevant if unitId is present
  strategicStockLevel: number;
  minQuantity: number;
  currentQuantity?: number;
}

export type StockMovementType = 'entry' | 'exit' | 'consumption';

export interface StockMovement {
  id: string;
  itemId: string;
  itemName?: string;
  unitId?: string;
  unitName?: string;
  hospitalId?: string; // Only relevant if unitId is present for exit/consumption
  hospitalName?: string; // Only relevant if unitId is present for exit/consumption
  type: StockMovementType;
  quantity: number;
  date: string; // ISO date string
  notes?: string;
  patientId?: string; 
  patientName?: string; 
}

export interface Patient {
  id: string;
  name: string;
  birthDate: string; // ISO date string, e.g., "YYYY-MM-DD"
  susCardNumber: string;
}

export interface ConsumptionDataPoint {
  id: string;
  itemId: string;
  date: string; // ISO date string
  quantityConsumed: number;
  servedUnitId: string;
  hospitalId: string;
  patientId?: string; 
}

// For GenAI input
export interface HistoricalDataEntry {
  item: string;
  date: string; // YYYY-MM-DD
  quantityConsumed: number;
  servedUnit: string;
  hospital: string; 
  patientSUS?: string; 
}

export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'inactive';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  // Password is not stored in the client-side mock data for security simulation
}
