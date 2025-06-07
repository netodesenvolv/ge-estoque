'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Settings2, Save, AlertCircle } from 'lucide-react';
import type { StockItemConfig, Item, ServedUnit } from '@/types';
import { mockStockConfigs, mockItems, mockServedUnits } from '@/data/mockData';
import { useToast } from '@/hooks/use-toast';

export default function StockLevelsConfigPage() {
  const [stockConfigs, setStockConfigs] = useState<StockItemConfig[]>([]);
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [allServedUnits, setAllServedUnits] = useState<ServedUnit[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    // Simulate fetching data
    // In a real app, you'd fetch items and their current configs, or create new ones
    setAllItems(mockItems);
    setAllServedUnits(mockServedUnits);
    
    // Create a comprehensive list of configurations to manage
    const combinedConfigs: StockItemConfig[] = [];
    mockItems.forEach(item => {
      // Central warehouse config
      const centralConfig = mockStockConfigs.find(c => c.itemId === item.id && !c.unitId);
      combinedConfigs.push(centralConfig || {
        id: `cfg-central-${item.id}`,
        itemId: item.id,
        itemName: item.name,
        unitName: 'Central Warehouse',
        strategicStockLevel: 0,
        minQuantity: item.minQuantity, // Default to item's general min quantity
      });

      // Served units configs
      mockServedUnits.forEach(unit => {
        const unitConfig = mockStockConfigs.find(c => c.itemId === item.id && c.unitId === unit.id);
        combinedConfigs.push(unitConfig || {
          id: `cfg-${item.id}-${unit.id}`,
          itemId: item.id,
          itemName: item.name,
          unitId: unit.id,
          unitName: unit.name,
          strategicStockLevel: 0,
          minQuantity: 0, // Min quantity per unit might be different
        });
      });
    });
    setStockConfigs(combinedConfigs);

  }, []);

  const handleInputChange = (configId: string, field: keyof StockItemConfig, value: string) => {
    setStockConfigs(prevConfigs =>
      prevConfigs.map(config =>
        config.id === configId ? { ...config, [field]: Number(value) } : config
      )
    );
  };

  const handleSaveAll = () => {
    console.log('Saving all stock level configurations:', stockConfigs);
    // Simulate API call
    toast({
      title: "Configurations Saved",
      description: "All strategic stock levels have been updated.",
    });
  };

  return (
    <div>
      <PageHeader
        title="Strategic Stock Levels"
        description="Configure strategic and minimum stock levels for items in the central warehouse and served units."
        icon={Settings2}
        actions={
          <Button onClick={handleSaveAll}>
            <Save className="mr-2 h-4 w-4" /> Save All Changes
          </Button>
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Configure Levels</CardTitle>
          <CardDescription>
            Set the desired stock levels. Alerts will be triggered if current stock falls below these strategic levels.
            Minimum quantity is the absolute lowest an item should reach before critical alert.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Min. Quantity</TableHead>
                  <TableHead className="text-right">Strategic Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockConfigs.length > 0 ? (
                  stockConfigs.map((config) => (
                    <TableRow key={config.id}>
                      <TableCell className="font-medium">{config.itemName}</TableCell>
                      <TableCell>{config.unitName}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          value={config.minQuantity}
                          onChange={(e) => handleInputChange(config.id, 'minQuantity', e.target.value)}
                          className="w-24 text-right ml-auto"
                          min="0"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          value={config.strategicStockLevel}
                          onChange={(e) => handleInputChange(config.id, 'strategicStockLevel', e.target.value)}
                          className="w-24 text-right ml-auto"
                          min="0"
                        />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center h-24">
                      No items or units found to configure. Add items and served units first.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
       <Card className="mt-6 bg-accent/30 border-accent shadow-lg">
        <CardHeader className="flex flex-row items-start gap-3">
          <AlertCircle className="h-6 w-6 text-accent-foreground mt-1" />
          <div>
            <CardTitle className="font-headline text-accent-foreground">Understanding Levels</CardTitle>
            <CardDescription className="text-accent-foreground/80">
              <strong>Minimum Quantity:</strong> The lowest acceptable stock level. Falling below this triggers critical alerts and indicates an urgent need for reordering.
              <br />
              <strong>Strategic Stock Level:</strong> The desired optimal stock level. Falling below this triggers a warning, prompting a review and potential reorder to maintain smooth operations and buffer against demand fluctuations.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
