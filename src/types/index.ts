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
  id: string; // ID do documento Firestore (itemId_unitId ou itemId_central ou itemId_hospitalId_UBSGENERAL)
  itemId: string;
  itemName?: string; // For display purposes
  unitId?: string; // Nullable for central warehouse or general UBS stock
  unitName?: string; // For display
  hospitalId?: string; // Relevant if unitId is present, or for general UBS stock
  hospitalName?: string; // Relevant if unitId is present, or for general UBS stock
  strategicStockLevel: number;
  minQuantity: number;
  currentQuantity?: number; // Adicionado para rastrear estoque atual na unidade/UBS geral
}

export type StockMovementType = 'entry' | 'exit' | 'consumption';

export interface StockMovement {
  id: string;
  itemId: string;
  itemName?: string;
  unitId?: string;
  unitName?: string;
  hospitalId?: string | null; 
  hospitalName?: string | null; 
  type: StockMovementType;
  quantity: number;
  date: string; // ISO date string
  notes?: string | null; 
  patientId?: string | null; 
  patientName?: string | null; 
  userId?: string; // ID of the user who performed the movement
  userDisplayName?: string; // Name of the user
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

// Updated user roles
export type UserRole = 'admin' | 'central_operator' | 'hospital_operator' | 'ubs_operator' | 'user'; // Added 'user' for basic signup
export type UserStatus = 'active' | 'inactive';

// Represents the user profile stored in Firestore
export interface UserProfile {
  name: string;
  email: string; 
  role: UserRole;
  status: UserStatus;
  associatedHospitalId?: string; // For hospital_operator and ubs_operator
  associatedHospitalName?: string; // For display
  associatedUnitId?: string;     // Optional: For hospital_operator tied to a specific unit
  associatedUnitName?: string;   // For display
}

// Represents the user object used throughout the app, including the id (uid from Auth)
export interface User extends UserProfile {
  id: string; // Firebase Auth UID
}

export interface FirestoreStockConfig {
  id?: string;
  itemId: string;
  unitId?: string;
  hospitalId?: string;
  strategicStockLevel: number;
  minQuantity: number;
  currentQuantity?: number;
}
