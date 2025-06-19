
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
const ITEMS_PER_PAGE = 20;

const getUnitDetails = (
    configId: string | undefined,
    unitIdFromConfig: string | undefined, 
    hospitalIdFromConfig: string | undefined, 
    allServedUnits: ServedUnit[], 
    allHospitals: Hospital[]
) => {
    // Case 1: Specific Served Unit (unitIdFromConfig is present)
    if (unitIdFromConfig) {
        const unit = allServedUnits.find(u => u.id === unitIdFromConfig);
        if (!unit) return { unitName: 'Unidade Desconhecida', hospitalId: hospitalIdFromConfig, hospitalName: 'Hospital Desconhecido' };
        const hospital = allHospitals.find(h => h.id === unit.hospitalId);
        return {
            unitName: unit.name,
            hospitalId: unit.hospitalId,
            hospitalName: hospital?.name || 'Hospital Desconhecido'
        };
    }
    
    // Case 2: General Stock for a UBS/Hospital (configId ends with UBS_GENERAL_STOCK_SUFFIX, hospitalIdFromConfig is present, unitIdFromConfig is NOT)
    if (configId?.endsWith(`_${UBS_GENERAL_STOCK_SUFFIX}`) && hospitalIdFromConfig && !unitIdFromConfig) {
        const hospital = allHospitals.find(h => h.id === hospitalIdFromConfig);
        if (!hospital) return { unitName: `Estoque Geral (ID: ${hospitalIdFromConfig})`, hospitalId: hospitalIdFromConfig, hospitalName: 'Hospital Desconhecido' };
        return {
            unitName: `Estoque Geral (${hospital.name})`,
            hospitalId: hospital.id,
            hospitalName: hospital.name
        };
    }
    
    // Fallback for unexpected configurations
    if (hospitalIdFromConfig) {
        const hospital = allHospitals.find(h => h.id === hospitalIdFromConfig);
        return { unitName: `Configuração Inválida em ${hospital?.name || 'Hospital Desconhecido'}`, hospitalId: hospitalIdFromConfig, hospitalName: hospital?.name || 'Hospital Desconhecido' };
    }

    return { unitName: 'Localização Inválida/Não Especificada', hospitalId: undefined, hospitalName: undefined };
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
  const [currentPage, setCurrentPage] = useState(1);

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
    if (isLoading) {
      console.log("StockPage: useEffect for combining data: isLoading is true, returning early.");
      return; 
    }
    console.log("StockPage: useEffect for combining data: processing...");

    const combinedData: DisplayStockItem[] = [];

    firestoreItems.forEach(item => {
      const centralConfigId = `${item.id}_central`;
      const centralItemConfig = firestoreStockConfigs.find(sc => sc.id === centralConfigId);
      
      const rawCurrentQuantity = item.currentQuantityCentral;
      const rawStrategicLevel = centralItemConfig?.strategicStockLevel;
      const rawMinQuantityConfig = centralItemConfig?.minQuantity;
      const rawMinQuantityItem = item.minQuantity;

      const currentQuantityValue = (rawCurrentQuantity !== undefined && typeof rawCurrentQuantity === 'number' && !isNaN(rawCurrentQuantity)) ? rawCurrentQuantity : 0;
      const strategicLvlValue = (rawStrategicLevel !== undefined && typeof rawStrategicLevel === 'number' && !isNaN(rawStrategicLevel)) ? rawStrategicLevel : 0;
      const minQtyValue = (rawMinQuantityConfig !== undefined && typeof rawMinQuantityConfig === 'number' && !isNaN(rawMinQuantityConfig)) 
                          ? rawMinQuantityConfig 
                          : ((rawMinQuantityItem !== undefined && typeof rawMinQuantityItem === 'number' && !isNaN(rawMinQuantityItem)) ? rawMinQuantityItem : 0);

      let status: DisplayStockItem['status'] = 'Optimal';
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
        unitName: 'Armazém Central',
        hospitalId: undefined,
        hospitalName: undefined,
        strategicStockLevel: strategicLvlValue,
        minQuantity: minQtyValue,
        currentQuantity: currentQuantityValue,
        status: status,
      });
    });

    firestoreStockConfigs.forEach(config => {
      const itemDetail = firestoreItems.find(i => i.id === config.itemId);
      if (!itemDetail) {
        return;
      }
      
      const isCentralConfig = config.id === `${config.itemId}_central`;
      if(isCentralConfig) return;

      const unitDetails = getUnitDetails(config.id, config.unitId, config.hospitalId, allServedUnitsData, allHospitalsData);
      const rawCurrentUnitQuantity = config.currentQuantity;
      const rawUnitMinQuantity = config.minQuantity;
      const rawUnitStrategicLevel = config.strategicStockLevel;

      let status: DisplayStockItem['status'] = 'Optimal';
      let currentUnitQuantityValue = (rawCurrentUnitQuantity !== undefined && typeof rawCurrentUnitQuantity === 'number' && !isNaN(rawCurrentUnitQuantity)) ? rawCurrentUnitQuantity : 0;
      let unitMinQtyValue = (rawUnitMinQuantity !== undefined && typeof rawUnitMinQuantity === 'number' && !isNaN(rawUnitMinQuantity)) ? rawUnitMinQuantity : 0;
      let unitStrategicLvlValue = (rawUnitStrategicLevel !== undefined && typeof rawUnitStrategicLevel === 'number' && !isNaN(rawUnitStrategicLevel)) ? rawUnitStrategicLevel : 0;

      if (unitMinQtyValue > 0 && currentUnitQuantityValue < unitMinQtyValue) {
          status = 'Low';
      } else if (unitStrategicLvlValue > 0 && currentUnitQuantityValue < unitStrategicLvlValue) {
          status = 'Alert';
      }
      
      combinedData.push({
        id: config.id || `${config.itemId}_${config.unitId || (config.hospitalId ? config.hospitalId + '_' + UBS_GENERAL_STOCK_SUFFIX : 'unknown_config')}`,
        itemId: config.itemId,
        itemName: itemDetail.name,
        itemCode: itemDetail.code,
        unitId: config.unitId, 
        unitName: unitDetails.unitName,
        hospitalId: config.hospitalId || unitDetails.hospitalId,
        hospitalName: unitDetails.hospitalName,
        strategicStockLevel: unitStrategicLvlValue,
        minQuantity: unitMinQtyValue,
        currentQuantity: currentUnitQuantityValue,
        status: status,
      });
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
        if (hospitalFilter === 'central') return item.unitName === 'Armazém Central';
        return item.hospitalId === hospitalFilter;
    };

    const unitMatchLogic = () => {
        if (hospitalFilter === 'central') return true; 
        if (hospitalFilter !== 'all' && item.hospitalId !== hospitalFilter) return false; 

        if (unitFilter === 'all') return true;
        if (item.unitId === unitFilter) return true; 
        
        // Check for general stock of a specific hospital if unitFilter is 'all' (covered by hospitalMatch) or specific unit
        if (unitFilter === 'all' && item.unitName?.startsWith('Estoque Geral') && item.hospitalId === hospitalFilter) return true;
        // This scenario should be handled if a specific unit is selected (item.unitId === unitFilter)
        // Or if "Todas as Unidades (do Hospital)" is selected AND this is a general stock for that hospital
        if (item.unitName?.startsWith('Estoque Geral') && item.hospitalId === hospitalFilter && unitFilter === 'all') return true;

        return false; 
    };

    const statusMatch = statusFilter === 'all' || item.status === statusFilter;
    
    return nameMatch && hospitalMatchLogic() && unitMatchLogic() && statusMatch;
  });
  
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, hospitalFilter, unitFilter, statusFilter]);

  const indexOfLastItem = currentPage * ITEMS_PER_PAGE;
  const indexOfFirstItem = indexOfLastItem - ITEMS_PER_PAGE;
  const currentItemsToDisplay = filteredStockData.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredStockData.length / ITEMS_PER_PAGE);

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  };

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };


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
            <Select value={unitFilter} onValueChange={setUnitFilter} disabled={isLoading || hospitalFilter === 'central' || (hospitalFilter === 'all' && filteredUnitsForSelect.length === allServedUnitsData.length && allServedUnitsData.length === 0) }>
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
                {currentItemsToDisplay.length > 0 ? (
                  currentItemsToDisplay.map((item) => (
                    <TableRow key={item.id} className={item.status === 'Alert' || item.status === 'Low' ? 'bg-red-500/5' : ''}>
                      <TableCell className="font-medium">{item.itemName}</TableCell>
                      <TableCell>{item.itemCode || 'N/A'}</TableCell>
                      <TableCell>{item.hospitalName || (item.unitName === 'Armazém Central' ? '-' : 'N/D')}</TableCell>
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
          {!isLoading && filteredStockData.length > ITEMS_PER_PAGE && (
            <div className="flex justify-between items-center mt-4 pt-4 border-t no-print">
              <Button onClick={handlePrevPage} disabled={currentPage === 1 || isLoading}>
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Página {currentPage} de {totalPages} (Total: {filteredStockData.length} itens)
              </span>
              <Button onClick={handleNextPage} disabled={currentPage === totalPages || isLoading}>
                Próxima
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
    
