
import type { Item, ServedUnit, StockItemConfig, StockMovement, Hospital } from '@/types';
import { addDays, formatISO } from 'date-fns';

const today = new Date();

export const mockItems: Item[] = [
  { id: '1', name: 'Paracetamol 500mg', code: 'PARA500', category: 'Analgésico', unitOfMeasure: 'Comprimido', minQuantity: 100, currentQuantityCentral: 500, supplier: 'Pharma Inc.', expirationDate: formatISO(addDays(today, 90), { representation: 'date' }) },
  { id: '2', name: 'Amoxicilina 250mg', code: 'AMOX250', category: 'Antibiótico', unitOfMeasure: 'Cápsula', minQuantity: 50, currentQuantityCentral: 200, supplier: 'MediCorp', expirationDate: formatISO(addDays(today, 15), { representation: 'date' }) }, // Próximo ao vencimento
  { id: '3', name: 'Curativos Sortidos (Band-Aid)', code: 'BANDAID', category: 'Primeiros Socorros', unitOfMeasure: 'Caixa', minQuantity: 20, currentQuantityCentral: 150, supplier: 'HealthGoods', expirationDate: formatISO(addDays(today, -10), { representation: 'date' }) }, // Vencido
  { id: '4', name: 'Seringa 5ml', code: 'SYR5ML', category: 'Suprimentos Médicos', unitOfMeasure: 'Peça', minQuantity: 200, currentQuantityCentral: 1000, supplier: 'MediSupply Co.', expirationDate: formatISO(addDays(today, 365), { representation: 'date' }) },
  { id: '5', name: 'Compressas de Gaze', code: 'GAUZEP', category: 'Primeiros Socorros', unitOfMeasure: 'Pacote', minQuantity: 50, currentQuantityCentral: 300, supplier: 'HealthGoods' }, // Sem data de validade
];

export const mockHospitals: Hospital[] = [
  { id: 'hosp1', name: 'Hospital Central da Cidade', address: 'Rua Principal, 123, Centro' },
  { id: 'hosp2', name: 'Hospital Regional Norte', address: 'Av. das Palmeiras, 456, Zona Norte' },
  { id: 'hosp3', name: 'Hospital Infantil Sul', address: 'Rua dos Girassóis, 789, Zona Sul' },
];

export const mockServedUnits: ServedUnit[] = [
  { id: 'su1', name: 'Sala de Emergência', location: 'Piso 1, Ala A', hospitalId: 'hosp1', hospitalName: mockHospitals.find(h => h.id === 'hosp1')?.name },
  { id: 'su2', name: 'Ala Pediátrica', location: 'Piso 2, Ala B', hospitalId: 'hosp1', hospitalName: mockHospitals.find(h => h.id === 'hosp1')?.name },
  { id: 'su3', name: 'Farmácia Principal', location: 'Térreo', hospitalId: 'hosp2', hospitalName: mockHospitals.find(h => h.id === 'hosp2')?.name },
  { id: 'su4', name: 'UTI Neonatal', location: 'Piso 3, Ala C', hospitalId: 'hosp3', hospitalName: mockHospitals.find(h => h.id === 'hosp3')?.name },
  { id: 'su5', name: 'Centro Cirúrgico', location: 'Subsolo', hospitalId: 'hosp1', hospitalName: mockHospitals.find(h => h.id === 'hosp1')?.name },
];

const findItemName = (itemId: string) => mockItems.find(i => i.id === itemId)?.name || 'Nome Desconhecido';
const getUnitDetails = (unitId?: string) => {
  if (!unitId) return { unitName: 'Armazém Central', hospitalId: undefined, hospitalName: undefined };
  const unit = mockServedUnits.find(u => u.id === unitId);
  if (!unit) return { unitName: 'Unidade Desconhecida', hospitalId: undefined, hospitalName: undefined };
  return {
    unitName: unit.name,
    hospitalId: unit.hospitalId,
    hospitalName: unit.hospitalName || mockHospitals.find(h => h.id === unit.hospitalId)?.name
  };
};


export const mockStockConfigs: StockItemConfig[] = [
  { id: 'sc1', itemId: '1', itemName: findItemName('1'), unitId: 'su1', ...getUnitDetails('su1'), strategicStockLevel: 50, minQuantity: 20, currentQuantity: 30 },
  { id: 'sc2', itemId: '1', itemName: findItemName('1'), ...getUnitDetails(undefined), strategicStockLevel: 200, minQuantity: 100, currentQuantity: mockItems.find(i => i.id === '1')?.currentQuantityCentral },
  { id: 'sc3', itemId: '2', itemName: findItemName('2'), unitId: 'su3', ...getUnitDetails('su3'), strategicStockLevel: 100, minQuantity: 30, currentQuantity: 80 },
  { id: 'sc4', itemId: '4', itemName: findItemName('4'), unitId: 'su1', ...getUnitDetails('su1'), strategicStockLevel: 100, minQuantity: 50, currentQuantity: 70 },
  { id: 'sc5', itemId: '4', itemName: findItemName('4'), ...getUnitDetails(undefined), strategicStockLevel: 500, minQuantity: 200, currentQuantity: mockItems.find(i => i.id === '4')?.currentQuantityCentral },
  { id: 'sc6', itemId: '5', itemName: findItemName('5'), unitId: 'su2', ...getUnitDetails('su2'), strategicStockLevel: 60, minQuantity: 25, currentQuantity: 40 },
  { id: 'sc7', itemId: '3', itemName: findItemName('3'), unitId: 'su4', ...getUnitDetails('su4'), strategicStockLevel: 30, minQuantity: 10, currentQuantity: 15 },
];

export const mockStockMovements: StockMovement[] = [
    { id: 'sm1', itemId: '1', itemName: findItemName('1'), type: 'entry', quantity: 200, date: '2024-05-01', notes: 'Novo lote recebido', ...getUnitDetails(undefined) },
    { id: 'sm2', itemId: '1', itemName: findItemName('1'), type: 'consumption', quantity: 10, date: '2024-05-03', ...getUnitDetails('su1') },
    { id: 'sm3', itemId: '2', itemName: findItemName('2'), type: 'exit', quantity: 50, date: '2024-05-05', notes: 'Transferência para Farmácia', ...getUnitDetails('su3') },
    { id: 'sm4', itemId: '4', itemName: findItemName('4'), type: 'consumption', quantity: 20, date: '2024-05-10', ...getUnitDetails('su1') },
];

