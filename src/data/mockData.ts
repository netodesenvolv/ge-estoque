import type { Item, ServedUnit, StockItemConfig, StockMovement } from '@/types';

export const mockItems: Item[] = [
  { id: '1', name: 'Paracetamol 500mg', code: 'PARA500', category: 'Analgésico', unitOfMeasure: 'Comprimido', minQuantity: 100, currentQuantityCentral: 500, supplier: 'Pharma Inc.' },
  { id: '2', name: 'Amoxicilina 250mg', code: 'AMOX250', category: 'Antibiótico', unitOfMeasure: 'Cápsula', minQuantity: 50, currentQuantityCentral: 200, supplier: 'MediCorp' },
  { id: '3', name: 'Curativos Sortidos (Band-Aid)', code: 'BANDAID', category: 'Primeiros Socorros', unitOfMeasure: 'Caixa', minQuantity: 20, currentQuantityCentral: 150, supplier: 'HealthGoods' },
  { id: '4', name: 'Seringa 5ml', code: 'SYR5ML', category: 'Suprimentos Médicos', unitOfMeasure: 'Peça', minQuantity: 200, currentQuantityCentral: 1000, supplier: 'MediSupply Co.' },
  { id: '5', name: 'Compressas de Gaze', code: 'GAUZEP', category: 'Primeiros Socorros', unitOfMeasure: 'Pacote', minQuantity: 50, currentQuantityCentral: 300, supplier: 'HealthGoods' },
];

export const mockServedUnits: ServedUnit[] = [
  { id: 'su1', name: 'Sala de Emergência', location: 'Piso 1, Ala A' },
  { id: 'su2', name: 'Ala Pediátrica', location: 'Piso 2, Ala B' },
  { id: 'su3', name: 'Farmácia Principal', location: 'Térreo' },
];

const findItemName = (itemId: string) => mockItems.find(i => i.id === itemId)?.name || 'Nome Desconhecido';
const findUnitName = (unitId?: string) => {
  if (!unitId) return 'Armazém Central';
  return mockServedUnits.find(u => u.id === unitId)?.name || 'Unidade Desconhecida';
}

export const mockStockConfigs: StockItemConfig[] = [
  { id: 'sc1', itemId: '1', itemName: findItemName('1'), unitId: 'su1', unitName: findUnitName('su1'), strategicStockLevel: 50, minQuantity: 20, currentQuantity: 30 },
  { id: 'sc2', itemId: '1', itemName: findItemName('1'), unitName: 'Armazém Central', strategicStockLevel: 200, minQuantity: 100, currentQuantity: mockItems.find(i => i.id === '1')?.currentQuantityCentral },
  { id: 'sc3', itemId: '2', itemName: findItemName('2'), unitId: 'su3', unitName: findUnitName('su3'), strategicStockLevel: 100, minQuantity: 30, currentQuantity: 80 },
  { id: 'sc4', itemId: '4', itemName: findItemName('4'), unitId: 'su1', unitName: findUnitName('su1'), strategicStockLevel: 100, minQuantity: 50, currentQuantity: 70 },
  { id: 'sc5', itemId: '4', itemName: findItemName('4'), unitName: 'Armazém Central', strategicStockLevel: 500, minQuantity: 200, currentQuantity: mockItems.find(i => i.id === '4')?.currentQuantityCentral },
];

export const mockStockMovements: StockMovement[] = [
    { id: 'sm1', itemId: '1', itemName: findItemName('1'), type: 'entry', quantity: 200, date: '2024-05-01', notes: 'Novo lote recebido' },
    { id: 'sm2', itemId: '1', itemName: findItemName('1'), unitId: 'su1', unitName: findUnitName('su1'), type: 'consumption', quantity: 10, date: '2024-05-03' },
    { id: 'sm3', itemId: '2', itemName: findItemName('2'), type: 'exit', quantity: 50, date: '2024-05-05', unitId: 'su3', unitName: findUnitName('su3'), notes: 'Transferência para Farmácia' },
    { id: 'sm4', itemId: '4', itemName: findItemName('4'), unitId: 'su1', unitName: findUnitName('su1'), type: 'consumption', quantity: 20, date: '2024-05-10' },
];
