export interface Item {
  id: string;
  name: string;
  code: string;
  category: string;
  unitOfMeasure: string;
  minQuantity: number;
  currentQuantityCentral: number;
  supplier?: string;
}

export interface ServedUnit {
  id: string;
  name: string;
  location: string;
}

export interface StockItemConfig {
  id: string;
  itemId: string;
  itemName?: string; // For display purposes
  unitId?: string; // Nullable for central warehouse
  unitName?: string; // For display
  strategicStockLevel: number;
  minQuantity: number; // This might be redundant if Item.minQuantity is for central, or specific to unit
  currentQuantity?: number; // Current quantity in this specific unit/warehouse
}

export type StockMovementType = 'entry' | 'exit' | 'consumption';

export interface StockMovement {
  id: string;
  itemId: string;
  itemName?: string;
  unitId?: string; // For served units, null for central warehouse
  unitName?: string;
  type: StockMovementType;
  quantity: number;
  date: string; // ISO date string
  notes?: string;
}

export interface ConsumptionDataPoint {
  id: string;
  itemId: string;
  date: string; // ISO date string
  quantityConsumed: number;
  servedUnitId: string;
}

// For GenAI input
export interface HistoricalDataEntry {
  item: string;
  date: string; // YYYY-MM-DD
  quantityConsumed: number;
  servedUnit: string;
}
