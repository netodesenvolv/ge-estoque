
'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Warehouse, Search, Printer, Package as PackageIcon, Loader2 } from 'lucide-react';
import type { Item, ServedUnit, Hospital, StockItemConfig as GlobalStockItemConfig } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

interface FirestoreStockConfig {
  id?: string; 
  itemId: string;
  unitId?: string;
  hospitalId?: string;
  strategicStockLevel: number;
  minQuantity: number;
  currentQuantity?: number;
}

interface DisplayStockItem extends GlobalStockItemConfig {
  itemCode?: string;
  status?: 'Optimal' | 'Low' | 'Alert';
}

const getUnitDetails = (unitId: string | undefined, allServedUnits: ServedUnit[], allHospitals: Hospital[]) => {
    if (!unitId) return { unitName: 'Armazém Central', hospitalId: undefined, hospitalName: undefined };
    const unit = allServedUnits.find(u => u.id === unitId);
    if (!unit) return { unitName: 'Unidade Desconhecida', hospitalId: undefined, hospitalName: undefined };
    const hospital = allHospitals.find(h => h.id === unit.hospitalId);
    return {
        unitName: unit.name,
        hospitalId: unit.hospitalId,
        hospitalName: hospital?.name || 'Hospital Desconhecido'
    };
};


export default function StockPage() {
  const [firestoreItems, setFirestoreItems] = useState<Item[]>([]);
  const [allServedUnitsData, setAllServedUnitsData] = useState<ServedUnit[]>([]);
  const [allHospitalsData, setAllHospitalsData] = useState<Hospital[]>([]);
  const [firestoreStockConfigs, setFirestoreStockConfigs] = useState<FirestoreStockConfig[]>([]);
  
  const [stockData, setStockData] = useState<DisplayStockItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [hospitalFilter, setHospitalFilter] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all'); 

  useEffect(() => {
    setIsLoading(true);
    const dataSources = [
      { name: "items", setter: setFirestoreItems, query: query(collection(firestore, "items"), orderBy("name", "asc")) },
      { name: "stockConfigs", setter: setFirestoreStockConfigs, query: query(collection(firestore, "stockConfigs")) },
      { name: "servedUnits", setter: setAllServedUnitsData, query: query(collection(firestore, "servedUnits"), orderBy("name", "asc")) },
      { name: "hospitals", setter: setAllHospitalsData, query: query(collection(firestore, "hospitals"), orderBy("name", "asc")) },
    ];

    let loadedCount = 0;
    const unsubscribers: (() => void)[] = [];

    dataSources.forEach(source => {
      const unsubscribe = onSnapshot(source.query, (snapshot) => {
        source.setter(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
        loadedCount++;
        if (loadedCount === dataSources.length) {
          setIsLoading(false);
        }
      }, (error) => {
        console.error(`Erro ao buscar ${source.name}: `, error);
        toast({ title: `Erro ao Carregar ${source.name}`, variant: "destructive" });
        loadedCount++; // Considerar erro como "carregado" para não bloquear indefinidamente
        if (loadedCount === dataSources.length) {
          setIsLoading(false);
        }
      });
      unsubscribers.push(unsubscribe);
    });
    
    return () => unsubscribers.forEach(unsub => unsub());
  }, [toast]);

  useEffect(() => {
    if (isLoading) return; // Só processa se o carregamento inicial estiver completo

    const combinedData: DisplayStockItem[] = [];

    firestoreItems.forEach(item => {
      const centralConfigId = `${item.id}_central`;
      const config = firestoreStockConfigs.find(sc => sc.id === centralConfigId);
      
      const currentQuantity = item.currentQuantityCentral;
      const strategicLvl = config?.strategicStockLevel || 0;
      const minQty = config?.minQuantity ?? item.minQuantity;

      let status: DisplayStockItem['status'] = 'Optimal';
      if (typeof currentQuantity === 'number') {
        if (minQty > 0 && currentQuantity < minQty) {
            status = 'Low';
        } else if (strategicLvl > 0 && currentQuantity < strategicLvl) {
            status = 'Alert';
        }
      } else {
        status = undefined; 
      }

      combinedData.push({
        id: `central-${item.id}`,
        itemId: item.id,
        itemName: item.name,
        itemCode: item.code,
        ...getUnitDetails(undefined, allServedUnitsData, allHospitalsData),
        strategicStockLevel: strategicLvl,
        minQuantity: minQty,
        currentQuantity: currentQuantity,
        status: status,
      });
    });

    firestoreStockConfigs.forEach(config => {
      if (config.unitId) { 
        const itemDetail = firestoreItems.find(i => i.id === config.itemId);
        if (!itemDetail) return;

        const unitDetails = getUnitDetails(config.unitId, allServedUnitsData, allHospitalsData);
        const currentUnitQuantity = config.currentQuantity;

        let status: DisplayStockItem['status'] = 'Optimal';
            if (typeof currentUnitQuantity === 'number') {
            if (config.minQuantity > 0 && currentUnitQuantity < config.minQuantity) {
                status = 'Low';
            } else if (config.strategicStockLevel > 0 && currentUnitQuantity < config.strategicStockLevel) {
                status = 'Alert';
            }
        } else {
            status = undefined;
        }
        
        combinedData.push({
          id: config.id || `${config.itemId}_${config.unitId}`,
          itemId: config.itemId,
          itemName: itemDetail.name,
          itemCode: itemDetail.code,
          ...unitDetails,
          strategicStockLevel: config.strategicStockLevel,
          minQuantity: config.minQuantity,
          currentQuantity: currentUnitQuantity,
          status: status,
        });
      }
    });
    
    setStockData(combinedData.sort((a, b) => 
        (a.hospitalName || '').localeCompare(b.hospitalName || '') || 
        (a.unitName || '').localeCompare(b.unitName || '') || 
        (a.itemName || '').localeCompare(b.itemName || '')
    ));

  }, [firestoreItems, firestoreStockConfigs, allServedUnitsData, allHospitalsData, isLoading]);


  const filteredUnitsForSelect = hospitalFilter === 'all' || hospitalFilter === 'central' 
    ? allServedUnitsData
    : allServedUnitsData.filter(u => u.hospitalId === hospitalFilter);

  useEffect(() => {
    // Reset unitFilter if it becomes invalid due to hospitalFilter change
    if (hospitalFilter !== 'all' && hospitalFilter !== 'central') {
      if (unitFilter !== 'all' && !filteredUnitsForSelect.find(u => u.id === unitFilter)) {
        setUnitFilter('all');
      }
    } else if (hospitalFilter === 'central' && unitFilter !== 'all') {
       setUnitFilter('all'); // No units for central warehouse
    }
  }, [hospitalFilter, unitFilter, filteredUnitsForSelect]);


  const filteredStockData = stockData.filter(item => {
    const nameMatch = item.itemName?.toLowerCase().includes(searchTerm.toLowerCase()) || item.itemCode?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const hospitalMatchLogic = () => {
        if (hospitalFilter === 'all') return true;
        if (hospitalFilter === 'central') return !item.unitId; 
        return item.hospitalId === hospitalFilter;
    };
    const unitMatchLogic = () => {
        if (!item.unitId && hospitalFilter === 'central') return true; 
        if (hospitalFilter === 'central' && item.unitId) return false; 

        if (unitFilter === 'all') return hospitalMatchLogic(); 
        return item.unitId === unitFilter && hospitalMatchLogic(); 
    };

    const statusMatch = statusFilter === 'all' || item.status === statusFilter;
    
    return nameMatch && unitMatchLogic() && statusMatch;
  });

  const getStatusBadgeVariant = (status?: DisplayStockItem['status']) => {
    if (status === 'Alert' || status === 'Low') return 'destructive'; 
    if (status === 'Optimal') return 'default';
    return 'outline'; 
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
          <Button onClick={handlePrint} variant="outline">
            <Printer className="mr-2 h-4 w-4" /> Imprimir Tabela
          </Button>
        }
        className="no-print"
      />
      <Card className="shadow-lg printable-content">
        <CardHeader>
          <CardTitle className="font-headline flex items-center gap-2">
            <PackageIcon className="h-6 w-6 text-primary" /> Visão Geral do Estoque
          </CardTitle>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Buscar por nome ou código do item..."
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
                <SelectItem value="central">Apenas Armazém Central</SelectItem>
                {allHospitalsData.map(hospital => (
                  <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={unitFilter} onValueChange={setUnitFilter} disabled={hospitalFilter === 'central' || isLoading}>
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
            <Select value={statusFilter} onValueChange={setStatusFilter} disabled={isLoading}>
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
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Carregando dados de estoque...</p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome do Item</TableHead>
                  <TableHead>Código</TableHead>
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
                    <TableRow key={item.id} className={item.status === 'Alert' || item.status === 'Low' ? 'bg-red-500/5' : ''}>
                      <TableCell className="font-medium">{item.itemName}</TableCell>
                      <TableCell>{item.itemCode || 'N/A'}</TableCell>
                      <TableCell>{item.hospitalName || (item.unitId ? 'N/A' : '-')}</TableCell>
                      <TableCell>{item.unitName}</TableCell>
                      <TableCell className="text-right">{typeof item.currentQuantity === 'number' ? item.currentQuantity : 'N/D'}</TableCell>
                      <TableCell className="text-right">{item.minQuantity}</TableCell>
                      <TableCell className="text-right">{item.strategicStockLevel}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={getStatusBadgeVariant(item.status)}>{getStatusBadgeText(item.status)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center h-24">
                      Nenhum dado de estoque encontrado para os filtros atuais.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
    

    