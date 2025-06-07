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
    setAllItems(mockItems);
    setAllServedUnits(mockServedUnits);
    
    const combinedConfigs: StockItemConfig[] = [];
    mockItems.forEach(item => {
      const centralConfig = mockStockConfigs.find(c => c.itemId === item.id && !c.unitId);
      combinedConfigs.push(centralConfig || {
        id: `cfg-central-${item.id}`,
        itemId: item.id,
        itemName: item.name,
        unitName: 'Armazém Central',
        strategicStockLevel: 0,
        minQuantity: item.minQuantity,
      });

      mockServedUnits.forEach(unit => {
        const unitConfig = mockStockConfigs.find(c => c.itemId === item.id && c.unitId === unit.id);
        combinedConfigs.push(unitConfig || {
          id: `cfg-${item.id}-${unit.id}`,
          itemId: item.id,
          itemName: item.name,
          unitId: unit.id,
          unitName: unit.name,
          strategicStockLevel: 0,
          minQuantity: 0, 
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
    console.log('Salvando todas as configurações de nível de estoque:', stockConfigs);
    toast({
      title: "Configurações Salvas",
      description: "Todos os níveis estratégicos de estoque foram atualizados.",
    });
  };

  return (
    <div>
      <PageHeader
        title="Níveis Estratégicos de Estoque"
        description="Configure os níveis estratégicos e mínimos de estoque para itens no armazém central e unidades servidas."
        icon={Settings2}
        actions={
          <Button onClick={handleSaveAll}>
            <Save className="mr-2 h-4 w-4" /> Salvar Todas as Alterações
          </Button>
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Configurar Níveis</CardTitle>
          <CardDescription>
            Defina os níveis de estoque desejados. Alertas serão acionados se o estoque atual cair abaixo desses níveis estratégicos.
            Quantidade mínima é o menor nível absoluto que um item deve atingir antes de um alerta crítico.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome do Item</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead className="text-right">Qtde. Mínima</TableHead>
                  <TableHead className="text-right">Nível Estratégico</TableHead>
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
                      Nenhum item ou unidade encontrada para configurar. Adicione itens e unidades servidas primeiro.
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
            <CardTitle className="font-headline text-accent-foreground">Entendendo os Níveis</CardTitle>
            <CardDescription className="text-accent-foreground/80">
              <strong>Quantidade Mínima:</strong> O nível de estoque aceitável mais baixo. Ficar abaixo disso aciona alertas críticos e indica uma necessidade urgente de reabastecimento.
              <br />
              <strong>Nível Estratégico de Estoque:</strong> O nível de estoque ótimo desejado. Ficar abaixo disso aciona um aviso, solicitando uma revisão e potencial reabastecimento para manter as operações tranquilas e proteger contra flutuações de demanda.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
