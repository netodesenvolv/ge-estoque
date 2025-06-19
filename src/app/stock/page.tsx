
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

const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";

const getUnitDetails = (
    configId: string | undefined,
    unitIdFromConfig: string | undefined, 
    hospitalIdFromConfig: string | undefined, 
    allServedUnits: ServedUnit[], 
    allHospitals: Hospital[]
) => {
    if (!unitIdFromConfig && !hospitalIdFromConfig) { // Armazém Central (identificado por não ter unitId nem hospitalId na config original DO ITEM)
        return { unitName: 'Armazém Central', hospitalId: undefined, hospitalName: undefined };
    }

    if (unitIdFromConfig) { // Unidade Servida Específica
        const unit = allServedUnits.find(u => u.id === unitIdFromConfig);
        if (!unit) return { unitName: 'Unidade Desconhecida', hospitalId: hospitalIdFromConfig, hospitalName: 'Hospital Desconhecido' };
        const hospital = allHospitals.find(h => h.id === unit.hospitalId);
        return {
            unitName: unit.name,
            hospitalId: unit.hospitalId,
            hospitalName: hospital?.name || 'Hospital Desconhecido'
        };
    }
    
    // Estoque Geral de uma UBS/Hospital (config.id termina com _UBSGENERAL, unitId é undefined, hospitalId está presente)
    if (configId?.endsWith(`_${UBS_GENERAL_STOCK_SUFFIX}`) && hospitalIdFromConfig && !unitIdFromConfig) {
        const hospital = allHospitals.find(h => h.id === hospitalIdFromConfig);
        if (!hospital) return { unitName: `Hospital ID ${hospitalIdFromConfig} Desconhecido`, hospitalId: hospitalIdFromConfig, hospitalName: 'Hospital Desconhecido' };
        return {
            unitName: `Estoque Geral (${hospital.name})`,
            hospitalId: hospital.id,
            hospitalName: hospital.name
        };
    }
    
    // Fallback
    return { unitName: 'Local Desconhecido', hospitalId: hospitalIdFromConfig, hospitalName: 'N/A' };
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

  const [dataLoadStatus, setDataLoadStatus] = useState<{ [key: string]: boolean }>({
    items: false,
    stockConfigs: false,
    servedUnits: false,
    hospitals: false,
  });

  useEffect(() => {
    const sourcesToLoad = ["items", "stockConfigs", "servedUnits", "hospitals"];
    const initialLoadStatus = sourcesToLoad.reduce((acc, curr) => ({ ...acc, [curr]: false }), {});
    setDataLoadStatus(initialLoadStatus);
    setIsLoading(true); 

    const unsubscribers: (() => void)[] = [];

    const createListener = (collectionName: string, setter: React.Dispatch<React.SetStateAction<any[]>>, queryToRun: any) => {
      console.log(`StockPage: Setting up listener for ${collectionName}`);
      const unsubscribe = onSnapshot(queryToRun, (snapshot) => {
        console.log(`StockPage: Snapshot received for ${collectionName}. Docs count: ${snapshot.docs.length}`);
        setter(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
        setDataLoadStatus(prev => ({ ...prev, [collectionName]: true }));
      }, (error) => {
        console.error(`StockPage: Erro ao buscar ${collectionName}: `, error);
        toast({ title: `Erro ao Carregar ${collectionName}`, variant: "destructive" });
        setDataLoadStatus(prev => ({ ...prev, [collectionName]: true })); 
      });
      unsubscribers.push(unsubscribe);
    };

    createListener("items", setFirestoreItems, query(collection(firestore, "items"), orderBy("name", "asc")));
    createListener("stockConfigs", setFirestoreStockConfigs, query(collection(firestore, "stockConfigs")));
    createListener("servedUnits", setAllServedUnitsData, query(collection(firestore, "servedUnits"), orderBy("name", "asc")));
    createListener("hospitals", setAllHospitalsData, query(collection(firestore, "hospitals"), orderBy("name", "asc")));
    
    return () => {
      console.log("StockPage: Cleaning up Firestore listeners");
      unsubscribers.forEach(unsub => unsub());
    };
  }, [toast]); 

  useEffect(() => {
    const allLoaded = Object.values(dataLoadStatus).every(status => status === true);
    if (allLoaded) {
      console.log("StockPage: All data sources are now marked as loaded. Setting isLoading to false.");
      setIsLoading(false);
    }
  }, [dataLoadStatus]);


  useEffect(() => {
    console.log("StockPage: useEffect for combining data triggered. Current isLoading state:", isLoading);
    if (isLoading) {
      console.log("StockPage: useEffect for combining data: isLoading is true, returning.");
      return; 
    }
    console.log("StockPage: useEffect for combining data: processing...");

    const combinedData: DisplayStockItem[] = [];

    firestoreItems.forEach(item => {
      const centralConfigId = `${item.id}_central`;
      const centralItemConfig = firestoreStockConfigs.find(sc => sc.id === centralConfigId);
      
      const currentQuantity = item.currentQuantityCentral;
      const strategicLvl = centralItemConfig?.strategicStockLevel || 0;
      const minQty = centralItemConfig?.minQuantity ?? item.minQuantity ?? 0; 

      let status: DisplayStockItem['status'] = 'Optimal';
      let currentQuantityValue = typeof currentQuantity === 'number' && !isNaN(currentQuantity) ? currentQuantity : 0;
      let minQtyValue = typeof minQty === 'number' && !isNaN(minQty) ? minQty : 0;
      let strategicLvlValue = typeof strategicLvl === 'number' && !isNaN(strategicLvl) ? strategicLvl : 0;

      if (minQtyValue > 0 && currentQuantityValue < minQtyValue) {
          status = 'Low';
      } else if (strategicLvlValue > 0 && currentQuantityValue < strategicLvlValue) {
          status = 'Alert';
      }
      
      combinedData.push({
        id: `central-${item.id}`,
        itemId: item.id,
        itemName: item.name,
        itemCode: item.code,
        ...getUnitDetails(undefined, undefined, allServedUnitsData, allHospitalsData), // Armazém Central
        strategicStockLevel: strategicLvlValue,
        minQuantity: minQtyValue,
        currentQuantity: currentQuantityValue,
        status: status,
      });
    });

    firestoreStockConfigs.forEach(config => {
      const itemDetail = firestoreItems.find(i => i.id === config.itemId);
      if (!itemDetail) return;
      
      const isCentralConfig = config.id === `${config.itemId}_central`;
      if(isCentralConfig) return; // Já tratado acima com os dados de `firestoreItems`

      const unitDetails = getUnitDetails(config.id, config.unitId, config.hospitalId, allServedUnitsData, allHospitalsData);
      const currentUnitQuantity = config.currentQuantity;

      let status: DisplayStockItem['status'] = 'Optimal';
      let currentUnitQuantityValue = typeof currentUnitQuantity === 'number' && !isNaN(currentUnitQuantity) ? currentUnitQuantity : 0;
      let unitMinQtyValue = typeof config.minQuantity === 'number' && !isNaN(config.minQuantity) ? config.minQuantity : 0;
      let unitStrategicLvlValue = typeof config.strategicStockLevel === 'number' && !isNaN(config.strategicStockLevel) ? config.strategicStockLevel : 0;

      if (unitMinQtyValue > 0 && currentUnitQuantityValue < unitMinQtyValue) {
          status = 'Low';
      } else if (unitStrategicLvlValue > 0 && currentUnitQuantityValue < unitStrategicLvlValue) {
          status = 'Alert';
      }
      
      combinedData.push({
        id: config.id || `${config.itemId}_${config.unitId || config.hospitalId + '_' + UBS_GENERAL_STOCK_SUFFIX}`,
        itemId: config.itemId,
        itemName: itemDetail.name,
        itemCode: itemDetail.code,
        unitId: config.unitId, 
        unitName: unitDetails.unitName,
        hospitalId: config.hospitalId,
        hospitalName: unitDetails.hospitalName,
        strategicStockLevel: unitStrategicLvlValue,
        minQuantity: unitMinQtyValue,
        currentQuantity: currentUnitQuantityValue,
        status: status,
      });
    });
    
    console.log("StockPage: useEffect for combining data: combinedData length:", combinedData.length);
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
    if (hospitalFilter !== 'all' && hospitalFilter !== 'central') {
      if (unitFilter !== 'all' && !filteredUnitsForSelect.find(u => u.id === unitFilter)) {
        setUnitFilter('all');
      }
    } else if (hospitalFilter === 'central' && unitFilter !== 'all') {
       setUnitFilter('all'); 
    }
  }, [hospitalFilter, unitFilter, filteredUnitsForSelect]);


  const filteredStockData = stockData.filter(item => {
    const nameMatch = item.itemName?.toLowerCase().includes(searchTerm.toLowerCase()) || item.itemCode?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const hospitalMatchLogic = () => {
        if (hospitalFilter === 'all') return true;
        if (hospitalFilter === 'central') return !item.unitId && !item.hospitalId; // Armazém Central
        return item.hospitalId === hospitalFilter;
    };

    const unitMatchLogic = () => {
        if (hospitalFilter === 'central') return !item.unitId && !item.hospitalId; // Se filtro é Central, só mostra Central

        // Se filtro hospital não é 'central' e não é 'all' (ou seja, um hospital específico)
        if (hospitalFilter !== 'all' && item.hospitalId === hospitalFilter) {
            if (unitFilter === 'all') return true; // Todas as unidades desse hospital + estoque geral do hospital
            if (item.unitId === unitFilter) return true; // Unidade específica
            // Para estoque geral da UBS/Hospital (onde unitId é undefined mas hospitalId está presente)
            if (!item.unitId && item.id?.endsWith(UBS_GENERAL_STOCK_SUFFIX) && unitFilter === 'all') return true; 
            return false;
        }
        // Se filtro hospital é 'all'
        if (hospitalFilter === 'all') {
            if (unitFilter === 'all') return true; // Tudo
            if (item.unitId === unitFilter) return true; // Unidade específica em qualquer hospital
             // Se o filtro de unidade for para "nenhuma unidade específica" mas queremos todos os hospitais,
             // não há uma forma fácil de filtrar apenas os "estoques gerais" de todos os hospitais com este filtro.
             // O melhor é deixar o usuário selecionar um hospital específico para ver seu estoque geral.
        }
        return false;
    };

    const statusMatch = statusFilter === 'all' || item.status === statusFilter;
    
    return nameMatch && hospitalMatchLogic() && unitMatchLogic() && statusMatch;
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
          <Button onClick={handlePrint} variant="outline" className="no-print">
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
            <Select value={unitFilter} onValueChange={setUnitFilter} disabled={(hospitalFilter === 'central' && !isLoading) || isLoading || hospitalFilter === 'all'}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filtrar por Unidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Unidades (do Hospital)</SelectItem>
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
                      <TableCell>{item.hospitalName || (item.unitId ? 'N/A' : (item.id.startsWith('central-') ? '-' : 'N/D'))}</TableCell>
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
    
