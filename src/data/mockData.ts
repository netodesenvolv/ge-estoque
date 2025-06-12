
import type { Item, ServedUnit, StockItemConfig, StockMovement, Hospital, Patient, User } from '@/types';
import { addDays, formatISO, subYears } from 'date-fns';

const today = new Date();

export const mockItems: Item[] = [
  { id: '1', name: 'Paracetamol 500mg', code: 'PARA500', category: 'Analgésico', unitOfMeasure: 'Comprimido', minQuantity: 100, currentQuantityCentral: 500, supplier: 'Pharma Inc.', expirationDate: formatISO(addDays(today, 90), { representation: 'date' }) },
  { id: '2', name: 'Amoxicilina 250mg', code: 'AMOX250', category: 'Antibiótico', unitOfMeasure: 'Cápsula', minQuantity: 50, currentQuantityCentral: 200, supplier: 'MediCorp', expirationDate: formatISO(addDays(today, 15), { representation: 'date' }) },
  { id: '3', name: 'Curativos Sortidos (Band-Aid)', code: 'BANDAID', category: 'Primeiros Socorros', unitOfMeasure: 'Caixa', minQuantity: 20, currentQuantityCentral: 150, supplier: 'HealthGoods', expirationDate: formatISO(addDays(today, -10), { representation: 'date' }) },
  { id: '4', name: 'Seringa 5ml', code: 'SYR5ML', category: 'Suprimentos Médicos', unitOfMeasure: 'Peça', minQuantity: 200, currentQuantityCentral: 1000, supplier: 'MediSupply Co.', expirationDate: formatISO(addDays(today, 365), { representation: 'date' }) },
  { id: '5', name: 'Compressas de Gaze', code: 'GAUZEP', category: 'Primeiros Socorros', unitOfMeasure: 'Pacote', minQuantity: 50, currentQuantityCentral: 300, supplier: 'HealthGoods' },
];

export const mockHospitals: Hospital[] = [
  { id: 'hosp1', name: 'Hospital Central da Cidade', address: 'Rua Principal, 123, Centro' },
  { id: 'hosp2', name: 'Hospital Regional Norte', address: 'Av. das Palmeiras, 456, Zona Norte' },
  { id: 'hosp3', name: 'Hospital Infantil Sul', address: 'Rua dos Girassóis, 789, Zona Sul' },
  { id: 'ubs1', name: 'UBS Vila Esperança', address: 'Rua da Saúde, 10, Vila Esperança' },
];

export const mockServedUnits: ServedUnit[] = [
  { id: 'su1', name: 'Sala de Emergência', location: 'Piso 1, Ala A', hospitalId: 'hosp1', hospitalName: mockHospitals.find(h => h.id === 'hosp1')?.name },
  { id: 'su2', name: 'Ala Pediátrica', location: 'Piso 2, Ala B', hospitalId: 'hosp1', hospitalName: mockHospitals.find(h => h.id === 'hosp1')?.name },
  { id: 'su3', name: 'Farmácia Principal', location: 'Térreo', hospitalId: 'hosp2', hospitalName: mockHospitals.find(h => h.id === 'hosp2')?.name },
  { id: 'su4', name: 'UTI Neonatal', location: 'Piso 3, Ala C', hospitalId: 'hosp3', hospitalName: mockHospitals.find(h => h.id === 'hosp3')?.name },
  { id: 'su5', name: 'Centro Cirúrgico', location: 'Subsolo', hospitalId: 'hosp1', hospitalName: mockHospitals.find(h => h.id === 'hosp1')?.name },
  { id: 'su6', name: 'Consultório 1 - Clínica Geral', location: 'Térreo', hospitalId: 'ubs1', hospitalName: mockHospitals.find(h => h.id === 'ubs1')?.name },
  { id: 'su7', name: 'Sala de Vacinação', location: 'Piso Superior', hospitalId: 'ubs1', hospitalName: mockHospitals.find(h => h.id === 'ubs1')?.name },
];

export const mockPatients: Patient[] = [
  { id: 'pat1', name: 'João Silva', birthDate: formatISO(subYears(today, 30), { representation: 'date' }), susCardNumber: '700123456789012' },
  { id: 'pat2', name: 'Maria Oliveira', birthDate: formatISO(subYears(today, 45), { representation: 'date' }), susCardNumber: '700987654321098' },
  { id: 'pat3', name: 'Carlos Pereira', birthDate: formatISO(subYears(today, 22), { representation: 'date' }), susCardNumber: '700112233445566' },
  { id: 'pat4', name: 'Ana Costa', birthDate: formatISO(subYears(today, 60), { representation: 'date' }), susCardNumber: '700665544332211' },
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
const findPatientName = (patientId?: string) => patientId ? (mockPatients.find(p => p.id === patientId)?.name || 'Paciente Desconhecido') : undefined;


export const mockStockConfigs: StockItemConfig[] = [
  { id: 'sc1', itemId: '1', itemName: findItemName('1'), unitId: 'su1', ...getUnitDetails('su1'), strategicStockLevel: 50, minQuantity: 20, currentQuantity: 30 },
  { id: 'sc2', itemId: '1', itemName: findItemName('1'), ...getUnitDetails(undefined), strategicStockLevel: 200, minQuantity: 100, currentQuantity: mockItems.find(i => i.id === '1')?.currentQuantityCentral },
  { id: 'sc3', itemId: '2', itemName: findItemName('2'), unitId: 'su3', ...getUnitDetails('su3'), strategicStockLevel: 100, minQuantity: 30, currentQuantity: 80 },
  { id: 'sc4', itemId: '4', itemName: findItemName('4'), unitId: 'su1', ...getUnitDetails('su1'), strategicStockLevel: 100, minQuantity: 50, currentQuantity: 70 },
  { id: 'sc5', itemId: '4', itemName: findItemName('4'), ...getUnitDetails(undefined), strategicStockLevel: 500, minQuantity: 200, currentQuantity: mockItems.find(i => i.id === '4')?.currentQuantityCentral },
  { id: 'sc6', itemId: '5', itemName: findItemName('5'), unitId: 'su2', ...getUnitDetails('su2'), strategicStockLevel: 60, minQuantity: 25, currentQuantity: 40 },
  { id: 'sc7', itemId: '3', itemName: findItemName('3'), unitId: 'su4', ...getUnitDetails('su4'), strategicStockLevel: 30, minQuantity: 10, currentQuantity: 15 },
  { id: 'sc8', itemId: '1', itemName: findItemName('1'), unitId: 'su6', ...getUnitDetails('su6'), strategicStockLevel: 20, minQuantity: 5, currentQuantity: 10 }, // Para UBS
];

export const mockStockMovements: StockMovement[] = [
    { id: 'sm1', itemId: '1', itemName: findItemName('1'), type: 'entry', quantity: 200, date: '2024-05-01', notes: 'Novo lote recebido', ...getUnitDetails(undefined) },
    { id: 'sm2', itemId: '1', itemName: findItemName('1'), type: 'consumption', quantity: 1, date: '2024-05-03', ...getUnitDetails('su6'), patientId: 'pat1', patientName: findPatientName('pat1') },
    { id: 'sm3', itemId: '2', itemName: findItemName('2'), type: 'exit', quantity: 50, date: '2024-05-05', notes: 'Transferência para Farmácia', ...getUnitDetails('su3') },
    { id: 'sm4', itemId: '4', itemName: findItemName('4'), type: 'consumption', quantity: 20, date: '2024-05-10', ...getUnitDetails('su1') },
];

export const mockUsers: User[] = [
  { id: 'user1', name: 'Alice Admin', email: 'alice@example.com', role: 'admin', status: 'active' },
  { id: 'user2', name: 'Bob Usuário', email: 'bob@example.com', role: 'user', status: 'active' },
  { id: 'user3', name: 'Charlie Inativo', email: 'charlie@example.com', role: 'user', status: 'inactive' },
];
