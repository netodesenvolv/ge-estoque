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
  const [unitFilter, setUnitFilter] = useState('all'); // 'all', 'central', or servedUnitId
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'Optimal', 'Low', 'Alert'

  useEffect(() => {
    // Simulate data fetching
    setAllItems(mockItems);
    setAllServedUnits(mockServedUnits);

    // Combine central stock and unit stock for display
    const centralStock: DisplayStockItem[] = mockItems.map(item => {
      const config = mockStockConfigs.find(sc => sc.itemId === item.id && !sc.unitId);
      const currentQuantity = item.currentQuantityCentral;
      let status: DisplayStockItem['status'] = 'Optimal';
      if (config) {
        if (currentQuantity < config.minQuantity) status = 'Low';
        if (currentQuantity < config.strategicStockLevel) status = 'Alert';
      }
      return {
        id: `central-${item.id}`,
        itemId: item.id,
        itemName: item.name,
        unitName: 'Central Warehouse',
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
           if (config.currentQuantity < config.minQuantity) status = 'Low';
           if (config.currentQuantity < config.strategicStockLevel) status = 'Alert';
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
                      (unitFilter === 'central' && item.unitName === 'Central Warehouse') ||
                      item.unitId === unitFilter;
    const statusMatch = statusFilter === 'all' || item.status === statusFilter;
    return nameMatch && unitMatch && statusMatch;
  });

  const getStatusBadgeVariant = (status?: DisplayStockItem['status']) => {
    if (status === 'Alert') return 'destructive';
    if (status === 'Low') return 'secondary'; // Or a custom 'warning' variant
    return 'default';
  }

  return (
    <div>
      <PageHeader title="Current Stock" description="View current stock levels across all locations." icon={Warehouse} />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Stock Overview</CardTitle>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by item name..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filter by Unit/Warehouse" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Units/Warehouses</SelectItem>
                <SelectItem value="central">Central Warehouse</SelectItem>
                {allServedUnits.map(unit => (
                  <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filter by Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Optimal">Optimal</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Alert">Alert</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Current Qty</TableHead>
                  <TableHead className="text-right">Min. Qty</TableHead>
                  <TableHead className="text-right">Strategic Level</TableHead>
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
                        {item.status && <Badge variant={getStatusBadgeVariant(item.status)}>{item.status}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      No stock data found for current filters.
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
