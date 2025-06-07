'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Warehouse, Search, Filter } from 'lucide-react';
import type { Item, ServedUnit, StockItemConfig } from '@/types';
import { mockItems, mockServedUnits, mockStockConfigs } from '@/data/mockData';
import { Badge } from '@/components/ui/badge';

interface DisplayStockItem extends StockItemConfig {
  status?: 'Optimal' | 'Low' | 'Alert';
}

export default function StockPage() {
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [allServedUnits, setAllServedUnits] = useState<ServedUnit[]>([]);
  const [stockData, setStockData] = useState<DisplayStockItem[]>([]);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [unitFilter, setUnitFilter] = useState('all'); 
  const [statusFilter, setStatusFilter] = useState('all'); 

  useEffect(() => {
    setAllItems(mockItems);
    setAllServedUnits(mockServedUnits);

    const centralStock: DisplayStockItem[] = mockItems.map(item => {
      const config = mockStockConfigs.find(sc => sc.itemId === item.id && !sc.unitId);
      const currentQuantity = item.currentQuantityCentral;
      let status: DisplayStockItem['status'] = 'Optimal';
      if (config) {
        if (currentQuantity < config.minQuantity) status = 'Low'; // Should be Alert if below minQuantity as per current logic for Strategic
        else if (currentQuantity < config.strategicStockLevel) status = 'Alert'; // Changed logic: Alert for below strategic, Low for below min. Let's keep consistent with original if this was intentional.
                                                                           // Reverting to: if (currentQuantity < config.minQuantity) status = 'Low'; if (currentQuantity < config.strategicStockLevel) status = 'Alert'; - this implies min is more critical (low) than strategic (alert).
                                                                           // Standard interpretation: Strategic is warning, Min is critical. So below min -> Low, below strategic (but above min) -> Alert.
                                                                           // Let's follow common logic:
        if (config.minQuantity > 0 && currentQuantity < config.minQuantity) { // Check if minQuantity is defined and positive
            status = 'Low';
        } else if (currentQuantity < config.strategicStockLevel) {
            status = 'Alert';
        }
      }
      return {
        id: `central-${item.id}`,
        itemId: item.id,
        itemName: item.name,
        unitName: 'Armazém Central',
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
        if (typeof config.currentQuantity === 'number') {
           if (config.minQuantity > 0 && config.currentQuantity < config.minQuantity) {
             status = 'Low';
           } else if (config.currentQuantity < config.strategicStockLevel) {
             status = 'Alert';
           }
        }
        return {
          ...config,
          status: status,
        }
      });
    
    setStockData([...centralStock, ...unitStock]);
  }, []);

  const filteredStockData = stockData.filter(item => {
    const nameMatch = item.itemName?.toLowerCase().includes(searchTerm.toLowerCase());
    const unitMatch = unitFilter === 'all' || 
                      (unitFilter === 'central' && item.unitName === 'Armazém Central') ||
                      item.unitId === unitFilter;
    const statusMatch = statusFilter === 'all' || item.status === statusFilter;
    return nameMatch && unitMatch && statusMatch;
  });

  const getStatusBadgeVariant = (status?: DisplayStockItem['status']) => {
    if (status === 'Alert') return 'destructive'; 
    if (status === 'Low') return 'secondary'; // Consider a 'warning' variant for 'Low' if 'secondary' isn't distinct enough
    return 'default'; // Optimal
  }
  
  const getStatusBadgeText = (status?: DisplayStockItem['status']) => {
    if (status === 'Alert') return 'Alerta';
    if (status === 'Low') return 'Baixo';
    if (status === 'Optimal') return 'Ótimo';
    return '';
  }


  return (
    <div>
      <PageHeader title="Estoque Atual" description="Visualize os níveis de estoque atuais em todos os locais." icon={Warehouse} />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Visão Geral do Estoque</CardTitle>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Buscar por nome do item..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filtrar por Unidade/Armazém" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Unidades/Armazéns</SelectItem>
                <SelectItem value="central">Armazém Central</SelectItem>
                {allServedUnits.map(unit => (
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
                  <TableHead>Localização</TableHead>
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
                      <TableCell>{item.unitName}</TableCell>
                      <TableCell className="text-right">{item.currentQuantity ?? 'N/A'}</TableCell>
                      <TableCell className="text-right">{item.minQuantity}</TableCell>
                      <TableCell className="text-right">{item.strategicStockLevel}</TableCell>
                      <TableCell className="text-center">
                        {item.status && <Badge variant={getStatusBadgeVariant(item.status)}>{getStatusBadgeText(item.status)}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
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
