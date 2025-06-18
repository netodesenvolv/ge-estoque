
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
  id: string; // ID do documento Firestore (itemId_unitId ou itemId_central) ou ID de exibição
  itemId: string;
  itemName?: string; // For display purposes
  unitId?: string; // Nullable for central warehouse
  unitName?: string; // For display
  hospitalId?: string; // Only relevant if unitId is present
  hospitalName?: string; // Only relevant if unitId is present
  strategicStockLevel: number;
  minQuantity: number;
  currentQuantity?: number; // Adicionado para rastrear estoque atual na unidade
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

export type PatientSex = 'masculino' | 'feminino' | 'outro' | 'ignorado';

export interface Patient {
  id: string;
  name: string; // Nome Completo
  birthDate?: string; // ISO date string, e.g., "YYYY-MM-DD"
  susCardNumber: string; // CNS
  address?: string; // Endereço
  phone?: string; // Telefone
  sex?: PatientSex; // Sexo
  healthAgentName?: string; // Nome do Agente de Saúde
  registeredUBSId?: string; // ID da UBS de Cadastro
  registeredUBSName?: string; // Nome da UBS de Cadastro (para conveniência de exibição)
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

// Represents the user profile stored in Firestore
export interface UserProfile {
  name: string;
  email: string; // Email is also stored in Auth, but useful here for display
  role: UserRole;
  status: UserStatus;
}

// Represents the user object used throughout the app, including the id (uid from Auth)
export interface User extends UserProfile {
  id: string; // Firebase Auth UID
}
