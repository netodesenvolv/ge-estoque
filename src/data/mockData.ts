
import type { Item, ServedUnit, StockItemConfig, StockMovement, Hospital, Patient, User } from '@/types';
import { addDays, formatISO, subYears } from 'date-fns';

const today = new Date();

export const mockItems: Item[] = [];

export const mockHospitals: Hospital[] = [];

export const mockServedUnits: ServedUnit[] = [];

export const mockPatients: Patient[] = [];

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

export const mockUsers: User[] = [];
