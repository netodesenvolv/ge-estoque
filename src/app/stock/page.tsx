
'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Warehouse, Search, Printer } from 'lucide-react';
import type { Item, ServedUnit, StockItemConfig, Hospital } from '@/types';
import { mockItems, mockServedUnits, mockStockConfigs, mockHospitals } from '@/data/mockData';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface DisplayStockItem extends StockItemConfig {
  status?: 'Optimal' | 'Low' | 'Alert'; // Optimal, Alert (below strategic), Low (below min)
}

export default function StockPage() {
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [allServedUnits, setAllServedUnits] = useState<ServedUnit[]>([]);
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
  const [stockData, setStockData] = useState<DisplayStockItem[]>([]);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [hospitalFilter, setHospitalFilter] = useState('all'); // Can be hospitalId or 'central' or 'all'
  const [unitFilter, setUnitFilter] = useState('all'); // Can be unitId or 'all'
  const [statusFilter, setStatusFilter] = useState('all'); 

  useEffect(() => {
    setAllItems(mockItems);
    const enrichedServedUnits = mockServedUnits.map(su => ({
        ...su,
        hospitalName: mockHospitals.find(h => h.id === su.hospitalId)?.name || 'N/A'
    }));
    setAllServedUnits(enrichedServedUnits);
    setAllHospitals(mockHospitals);

    const getUnitDetails = (unitId?: string) => {
        if (!unitId) return { unitName: 'Armazém Central', hospitalId: undefined, hospitalName: undefined };
        const unit = enrichedServedUnits.find(u => u.id === unitId);
        if (!unit) return { unitName: 'Unidade Desconhecida', hospitalId: undefined, hospitalName: undefined };
        return {
          unitName: unit.name,
          hospitalId: unit.hospitalId,
          hospitalName: unit.hospitalName
        };
    };

    const centralStock: DisplayStockItem[] = mockItems.map(item => {
      const config = mockStockConfigs.find(sc => sc.itemId === item.id && !sc.unitId);
      const currentQuantity = item.currentQuantityCentral;
      let status: DisplayStockItem['status'] = 'Optimal';
      if (config) {
        if (config.minQuantity > 0 && currentQuantity < config.minQuantity) {
            status = 'Low';
        } else if (currentQuantity < config.strategicStockLevel) {
            status = 'Alert';
        }
      }
      return {
        id: `central-${item.id}`,
        itemId: item.id,
        itemName: item.name,
        ...getUnitDetails(undefined), // Armazém Central
        strategicStockLevel: config?.strategicStockLevel || 0,
        minQuantity: config?.minQuantity || item.minQuantity,
        currentQuantity: currentQuantity,
        status: status,
      };
    });

    const unitStock: DisplayStockItem[] = mockStockConfigs
      .filter(config => config.unitId)
      .map(config => {
        let status: DisplayStockItem['status'] = 'Optimal';
        const unitDetails = getUnitDetails(config.unitId);
        if (typeof config.currentQuantity === 'number') {
           if (config.minQuantity > 0 && config.currentQuantity < config.minQuantity) {
             status = 'Low';
           } else if (config.currentQuantity < config.strategicStockLevel) {
             status = 'Alert';
           }
        }
        return {
          ...config,
          ...unitDetails,
          status: status,
        }
      });
    
    setStockData([...centralStock, ...unitStock].sort((a, b) => (a.hospitalName || '').localeCompare(b.hospitalName || '') || a.unitName!.localeCompare(b.unitName!)));
  }, []);

  const filteredUnitsForSelect = hospitalFilter === 'all' || hospitalFilter === 'central' 
    ? allServedUnits 
    : allServedUnits.filter(u => u.hospitalId === hospitalFilter);

  useEffect(() => {
    // Reset unit filter if hospital filter makes current unit filter invalid
    if (unitFilter !== 'all' && !filteredUnitsForSelect.find(u => u.id === unitFilter)) {
      setUnitFilter('all');
    }
  }, [hospitalFilter, unitFilter, filteredUnitsForSelect]);


  const filteredStockData = stockData.filter(item => {
    const nameMatch = item.itemName?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const hospitalMatchLogic = () => {
        if (hospitalFilter === 'all') return true;
        if (hospitalFilter === 'central') return !item.unitId; // Armazém Central
        return item.hospitalId === hospitalFilter;
    };
    const unitMatchLogic = () => {
        if (!item.unitId && hospitalFilter === 'central') return true; // Matches Armazém Central specifically
        if (hospitalFilter === 'central' && item.unitId) return false; // Don't show units if central is selected

        if (unitFilter === 'all') return hospitalMatchLogic(); // If unit is 'all', rely on hospital filter
        return item.unitId === unitFilter && hospitalMatchLogic(); // Match specific unit and ensure hospital matches too
    };

    const statusMatch = statusFilter === 'all' || item.status === statusFilter;
    
    return nameMatch && unitMatchLogic() && statusMatch;
  });

  const getStatusBadgeVariant = (status?: DisplayStockItem['status']) => {
    if (status === 'Alert') return 'destructive'; 
    if (status === 'Low') return 'secondary'; 
    return 'default'; // Optimal
  }
  
  const getStatusBadgeText = (status?: DisplayStockItem['status']) => {
    if (status === 'Alert') return 'Alerta';
    if (status === 'Low') return 'Baixo';
    if (status === 'Optimal') return 'Ótimo';
    return 'N/D';
  }

  const handlePrint = () => {
    window.print();
  };

  return (
    <div>
      <PageHeader 
        title="Estoque Atual" 
        description="Visualize os níveis de estoque atuais em todos os locais." 
        icon={Warehouse}
        actions={
          <Button onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" /> Imprimir Tabela
          </Button>
        }
      />
      <Card className="shadow-lg printable-content">
        <CardHeader>
          <CardTitle className="font-headline">Visão Geral do Estoque</CardTitle>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Buscar por nome do item..."
                className="pl-10 w-full"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
             <Select value={hospitalFilter} onValueChange={setHospitalFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filtrar por Hospital" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Hospitais/Armazém</SelectItem>
                <SelectItem value="central">Armazém Central</SelectItem>
                {allHospitals.map(hospital => (
                  <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={unitFilter} onValueChange={setUnitFilter} disabled={hospitalFilter === 'central'}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filtrar por Unidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Unidades</SelectItem>
                {filteredUnitsForSelect.map(unit => (
                  <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filtrar por Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Status</SelectItem>
                <SelectItem value="Optimal">Ótimo</SelectItem>
                <SelectItem value="Low">Baixo</SelectItem>
                <SelectItem value="Alert">Alerta</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome do Item</TableHead>
                  <TableHead>Hospital</TableHead>
                  <TableHead>Unidade/Localização</TableHead>
                  <TableHead className="text-right">Qtde. Atual</TableHead>
                  <TableHead className="text-right">Qtde. Mín.</TableHead>
                  <TableHead className="text-right">Nível Estratégico</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStockData.length > 0 ? (
                  filteredStockData.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.itemName}</TableCell>
                       <TableCell>{item.hospitalName || (item.unitId ? 'N/A' : '-')}</TableCell>
                      <TableCell>{item.unitName}</TableCell>
                      <TableCell className="text-right">{item.currentQuantity ?? 'N/A'}</TableCell>
                      <TableCell className="text-right">{item.minQuantity}</TableCell>
                      <TableCell className="text-right">{item.strategicStockLevel}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={getStatusBadgeVariant(item.status)}>{getStatusBadgeText(item.status)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24">
                      Nenhum dado de estoque encontrado para os filtros atuais.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

