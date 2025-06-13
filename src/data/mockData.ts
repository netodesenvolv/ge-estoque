
import type { Item, ServedUnit, StockItemConfig, StockMovement, Hospital, Patient, User } from '@/types';
import { addDays, formatISO, subYears } from 'date-fns';

const today = new Date();

export const mockItems: Item[] = [];

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


export const mockStockConfigs: StockItemConfig[] = [];

export const mockStockMovements: StockMovement[] = [];

export const mockUsers: User[] = [
  { id: 'user1', name: 'Alice Admin', email: 'alice@example.com', role: 'admin', status: 'active' },
  { id: 'user2', name: 'Bob Usuário', email: 'bob@example.com', role: 'user', status: 'active' },
  { id: 'user3', name: 'Charlie Inativo', email: 'charlie@example.com', role: 'user', status: 'inactive' },
];
