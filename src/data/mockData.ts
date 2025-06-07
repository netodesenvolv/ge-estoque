import type { Item, ServedUnit, StockItemConfig, StockMovement } from '@/types';

export const mockItems: Item[] = [
  { id: '1', name: 'Paracetamol 500mg', code: 'PARA500', category: 'Analgesic', unitOfMeasure: 'Tablet', minQuantity: 100, currentQuantityCentral: 500, supplier: 'Pharma Inc.' },
  { id: '2', name: 'Amoxicilina 250mg', code: 'AMOX250', category: 'Antibiotic', unitOfMeasure: 'Capsule', minQuantity: 50, currentQuantityCentral: 200, supplier: 'MediCorp' },
  { id: '3', name: 'Band-Aid Assorted', code: 'BANDAID', category: 'First Aid', unitOfMeasure: 'Box', minQuantity: 20, currentQuantityCentral: 150, supplier: 'HealthGoods' },
  { id: '4', name: 'Syringe 5ml', code: 'SYR5ML', category: 'Medical Supplies', unitOfMeasure: 'Piece', minQuantity: 200, currentQuantityCentral: 1000, supplier: 'MediSupply Co.' },
  { id: '5', name: 'Gauze Pads', code: 'GAUZEP', category: 'First Aid', unitOfMeasure: 'Pack', minQuantity: 50, currentQuantityCentral: 300, supplier: 'HealthGoods' },
];

export const mockServedUnits: ServedUnit[] = [
  { id: 'su1', name: 'Emergency Room', location: 'Floor 1, Wing A' },
  { id: 'su2', name: 'Pediatrics Ward', location: 'Floor 2, Wing B' },
  { id: 'su3', name: 'Pharmacy Main', location: 'Ground Floor' },
];

export const mockStockConfigs: StockItemConfig[] = [
  { id: 'sc1', itemId: '1', itemName: 'Paracetamol 500mg', unitId: 'su1', unitName: 'Emergency Room', strategicStockLevel: 50, minQuantity: 20, currentQuantity: 30 },
  { id: 'sc2', itemId: '1', itemName: 'Paracetamol 500mg', strategicStockLevel: 200, minQuantity: 100, currentQuantity: mockItems.find(i => i.id === '1')?.currentQuantityCentral }, // Central Warehouse
  { id: 'sc3', itemId: '2', itemName: 'Amoxicilina 250mg', unitId: 'su3', unitName: 'Pharmacy Main', strategicStockLevel: 100, minQuantity: 30, currentQuantity: 80 },
  { id: 'sc4', itemId: '4', itemName: 'Syringe 5ml', unitId: 'su1', unitName: 'Emergency Room', strategicStockLevel: 100, minQuantity: 50, currentQuantity: 70 },
  { id: 'sc5', itemId: '4', itemName: 'Syringe 5ml', strategicStockLevel: 500, minQuantity: 200, currentQuantity: mockItems.find(i => i.id === '4')?.currentQuantityCentral }, // Central Warehouse
];

export const mockStockMovements: StockMovement[] = [
    { id: 'sm1', itemId: '1', itemName: 'Paracetamol 500mg', type: 'entry', quantity: 200, date: '2024-05-01', notes: 'New batch received' },
    { id: 'sm2', itemId: '1', itemName: 'Paracetamol 500mg', unitId: 'su1', unitName: 'Emergency Room', type: 'consumption', quantity: 10, date: '2024-05-03' },
    { id: 'sm3', itemId: '2', itemName: 'Amoxicilina 250mg', type: 'exit', quantity: 50, date: '2024-05-05', unitId: 'su3', unitName: 'Pharmacy Main', notes: 'Transfer to Pharmacy' },
    { id: 'sm4', itemId: '4', itemName: 'Syringe 5ml', unitId: 'su1', unitName: 'Emergency Room', type: 'consumption', quantity: 20, date: '2024-05-10' },
];
