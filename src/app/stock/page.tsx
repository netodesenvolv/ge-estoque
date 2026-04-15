
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Warehouse, Search, Printer, Package as PackageIcon, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Item, ServedUnit, Hospital, StockItemConfig as GlobalStockItemConfig } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, limit, startAfter, endBefore, limitToLast, where, type Query, type DocumentSnapshot } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

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
  status?: 'Optimal' | 'Low' | 'Alert' | 'NotConfigured';
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
    
    if (configId?.endsWith(`_${UBS_GENERAL_STOCK_SUFFIX}`) && hospitalIdFromConfig && !unitIdFromConfig) {
        const hospital = allHospitals.find(h => h.id === hospitalIdFromConfig);
        if (!hospital) return { unitName: `Estoque Geral (ID: ${hospitalIdFromConfig})`, hospitalId: hospitalIdFromConfig, hospitalName: 'Hospital Desconhecido' };
        return {
            unitName: `Estoque Geral (${hospital.name})`,
            hospitalId: hospital.id,
            hospitalName: hospital.name
        };
    }
    
    if (hospitalIdFromConfig) {
        const hospital = allHospitals.find(h => h.id === hospitalIdFromConfig);
        return { unitName: `Configuração Inválida em ${hospital?.name || 'Hospital Desconhecido'}`, hospitalId: hospitalIdFromConfig, hospitalName: hospital?.name || 'Hospital Desconhecido' };
    }

    return { unitName: 'Localização Inválida/Não Especificada', hospitalId: undefined, hospitalName: undefined };
};


export default function StockPage() {
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();
  
  const [allServedUnitsData, setAllServedUnitsData] = useState<ServedUnit[]>([]);
  const [allHospitalsData, setAllHospitalsData] = useState<Hospital[]>([]);
  
  const [displayData, setDisplayData] = useState<DisplayStockItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [hospitalFilter, setHospitalFilter] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | DisplayStockItem['status']>('all'); 
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'positive' | 'zero'>('all');
  
  // Pagination State
  const [page, setPage] = useState(1);
  const [lastVisible, setLastVisible] = useState<DocumentSnapshot | null>(null);
  const [firstVisible, setFirstVisible] = useState<DocumentSnapshot | null>(null);
  const [isLastPage, setIsLastPage] = useState(false);

  const userCanSeeAll = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator';
  const userIsOperator = currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator';

  // Load basic reference data (Hospitals and Units) - fixed size collections
  useEffect(() => {
    const loadReferences = async () => {
      try {
        const hospitalsSnap = await getDocs(query(collection(firestore, "hospitals"), orderBy("name", "asc")));
        const unitsSnap = await getDocs(query(collection(firestore, "servedUnits"), orderBy("name", "asc")));
        
        setAllHospitalsData(hospitalsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital)));
        setAllServedUnitsData(unitsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServedUnit)));
        setIsInitialLoading(false);
      } catch (error) {
        console.error("Erro ao carregar referências: ", error);
        toast({ title: "Erro ao Carregar Referências", variant: "destructive" });
      }
    };
    loadReferences();
  }, [toast]);

  // Set initial filters based on user profile
  useEffect(() => {
    if (!currentUserProfile || isInitialLoading) return;

    if (userIsOperator && currentUserProfile.associatedHospitalId) {
      setHospitalFilter(currentUserProfile.associatedHospitalId);
      if (currentUserProfile.associatedUnitId) {
        setUnitFilter(currentUserProfile.associatedUnitId);
      }
    }
  }, [currentUserProfile, userIsOperator, isInitialLoading]);

  const fetchStock = useCallback(async (direction: 'first' | 'next' | 'prev') => {
    if (isInitialLoading || !currentUserProfile) return;
    setIsLoading(true);

    try {
      let combinedResults: DisplayStockItem[] = [];
      const itemsMap = new Map<string, Item>();
      
      // Determine what to query based on filters
      // If filtering by unit or a specific hospital, query stockConfigs first.
      // If showing everything or central, query items first.
      
      const isCentralOnly = hospitalFilter === 'central';
      const isSpecificHospital = hospitalFilter !== 'all' && hospitalFilter !== 'central';
      
      if (isCentralOnly || (hospitalFilter === 'all' && userCanSeeAll)) {
        // Query Items
        const itemsRef = collection(firestore, "items");
        const constraints: any[] = [];
        if (searchTerm) {
          const lowerTerm = searchTerm.toLowerCase();
          constraints.push(where("name_lowercase", ">=", lowerTerm), where("name_lowercase", "<=", lowerTerm + '\uf8ff'));
          constraints.push(orderBy("name_lowercase", "asc"));
        } else {
          constraints.push(orderBy("name", "asc"));
        }
    
        if (direction === 'next' && lastVisible) {
          constraints.push(startAfter(lastVisible));
        } else if (direction === 'prev' && firstVisible) {
          constraints.push(endBefore(firstVisible), limitToLast(ITEMS_PER_PAGE));
        }
        
        constraints.push(limit(ITEMS_PER_PAGE));
        const itemsSnap = await getDocs(query(itemsRef, ...constraints));
        
        let itemsBatch = itemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item));
        if (direction === 'prev') itemsBatch = itemsBatch.reverse();
        
        setFirstVisible(itemsSnap.docs[0]);
        setLastVisible(itemsSnap.docs[itemsSnap.docs.length - 1]);
        setIsLastPage(itemsSnap.docs.length < ITEMS_PER_PAGE);

        // Process these items for Central Stock
        itemsBatch.forEach(item => {
          itemsMap.set(item.id, item);
          
          const currentQty = item.currentQuantityCentral ?? 0;
          const minQty = item.minQuantity ?? 0;
          
          // Note: In "All" view, we also want to see if there's a specific config for central to get strategic level
          // but for simplicity/performance in "excessive reading" fix, we'll use item defaults here
          // unless it's strictly central view
          
          let status: DisplayStockItem['status'] = 'Optimal';
          if (minQty > 0 && currentQty < minQty) status = 'Low';
          
          combinedResults.push({
            id: `central-${item.id}`, itemId: item.id, itemName: item.name, itemCode: item.code,
            unitName: 'Armazém Central', currentQuantity: currentQty, minQuantity: minQty, status: status,
            strategicStockLevel: 0
          });
        });

        // If in "All" view, we might want to fetch configs for these items? 
        // No, stay simple to reduce reads. "All" view shows central only or requires specific unit search.
      } else if (isSpecificHospital) {
        // Query StockConfigs for this hospital/unit
        const configsRef = collection(firestore, "stockConfigs");
        const constraints: any[] = [where("hospitalId", "==", hospitalFilter)];
        if (unitFilter !== 'all') {
          constraints.push(where("unitId", "==", unitFilter));
        }
        
        // Firestore doesn't support inequality on one field and equality on another easily without index
        // so we'll fetch configs and then fetch items. Configs don't have item name, so we can't easily search by name here server-side.
        // For simplicity, we'll fetch configs and then map.
        
        if (direction === 'next' && lastVisible) {
          constraints.push(startAfter(lastVisible));
        } else if (direction === 'prev' && firstVisible) {
          constraints.push(endBefore(firstVisible), limitToLast(ITEMS_PER_PAGE));
        }
        
        constraints.push(limit(ITEMS_PER_PAGE));
        const configSnap = await getDocs(query(configsRef, ...constraints));
        
        let configsBatch = configSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FirestoreStockConfig));
        if (direction === 'prev') configsBatch = configsBatch.reverse();

        setFirstVisible(configSnap.docs[0]);
        setLastVisible(configSnap.docs[configSnap.docs.length - 1]);
        setIsLastPage(configSnap.docs.length < ITEMS_PER_PAGE);

        // Fetch corresponding items
        const itemIds = Array.from(new Set(configsBatch.map(c => c.itemId)));
        if (itemIds.length > 0) {
          // Firestore 'in' limit is 30, we're doing 20 per page, so it's OK
          const itemsSnap = await getDocs(query(collection(firestore, "items"), where("__name__", "in", itemIds)));
          itemsSnap.docs.forEach(doc => itemsMap.set(doc.id, { id: doc.id, ...doc.data() } as Item));
        }

        configsBatch.forEach(config => {
          const item = itemsMap.get(config.itemId);
          if (!item) return;
          if (searchTerm && !item.name.toLowerCase().includes(searchTerm.toLowerCase())) return;

          const unitDetails = getUnitDetails(config.id, config.unitId, config.hospitalId, allServedUnitsData, allHospitalsData);
          
          const currentQty = config.currentQuantity ?? 0;
          const minQty = config.minQuantity ?? 0;
          const stratLvl = config.strategicStockLevel ?? 0;

          let status: DisplayStockItem['status'] = 'Optimal';
          if (minQty > 0 && currentQty < minQty) status = 'Low';
          else if (stratLvl > 0 && currentQty < stratLvl) status = 'Alert';

          combinedResults.push({
            id: config.id || `${config.itemId}_${config.unitId}`, itemId: config.itemId,
            itemName: item.name, itemCode: item.code, unitId: config.unitId, unitName: unitDetails.unitName,
            hospitalId: config.hospitalId, hospitalName: unitDetails.hospitalName,
            currentQuantity: currentQty, minQuantity: minQty, strategicStockLevel: stratLvl, status: status
          });
        });
      }

      // Apply UI status filter (couldn't be done in Firestore easily for all cases)
      if (statusFilter !== 'all') {
        combinedResults = combinedResults.filter(r => r.status === statusFilter);
      }

      // Apply UI balance filter
      if (balanceFilter === 'positive') {
        combinedResults = combinedResults.filter(r => (r.currentQuantity || 0) > 0);
      } else if (balanceFilter === 'zero') {
        combinedResults = combinedResults.filter(r => (r.currentQuantity || 0) === 0);
      }

      setDisplayData(combinedResults);
    } catch (error) {
      console.error("Erro ao buscar estoque: ", error);
      toast({ title: "Erro ao Carregar Estoque", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [hospitalFilter, unitFilter, searchTerm, statusFilter, balanceFilter, allHospitalsData, allServedUnitsData, currentUserProfile, isInitialLoading, userCanSeeAll, firstVisible, lastVisible, toast]);

  useEffect(() => {
    if (!isInitialLoading) {
        setPage(1);
        setFirstVisible(null);
        setLastVisible(null);
        fetchStock('first');
    }
  }, [hospitalFilter, unitFilter, searchTerm, statusFilter, balanceFilter, isInitialLoading]);

  const handleNextPage = () => { if (!isLastPage) { setPage(p => p + 1); fetchStock('next'); } };
  const handlePrevPage = () => { if (page > 1) { setPage(p => p - 1); fetchStock('prev'); } };

  const availableUnitsForFilter = useMemo(() => {
    if (hospitalFilter === 'all' || hospitalFilter === 'central') return [];
    return allServedUnitsData.filter(u => u.hospitalId === hospitalFilter);
  }, [hospitalFilter, allServedUnitsData]);

  const getStatusBadgeVariant = (status?: DisplayStockItem['status']) => {
    if (status === 'Alert' || status === 'Low') return 'destructive'; 
    if (status === 'Optimal') return 'default';
    if (status === 'NotConfigured') return 'secondary';
    return 'outline'; 
  }
  
  const getStatusBadgeText = (status?: DisplayStockItem['status']) => {
    if (status === 'Alert') return 'Alerta';
    if (status === 'Low') return 'Baixo';
    if (status === 'Optimal') return 'Ótimo';
    if (status === 'NotConfigured') return 'Não Config.';
    return 'N/D';
  }

  const handlePrint = () => window.print();

  if (isInitialLoading) {
    return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="ml-3 text-muted-foreground">Carregando referências...</p>
        </div>
    );
  }

  return (
    <div>
      <PageHeader 
        title="Estoque Atual" 
        description="Visualize os níveis de estoque atuais. Carregado sob demanda para otimização." 
        icon={Warehouse}
        actions={
          <Button onClick={handlePrint} variant="outline" className="no-print bg-primary text-primary-foreground hover:bg-primary/90">
            <Printer className="mr-2 h-4 w-4" /> Gerar Relatório Impresso
          </Button>
        }
        className="no-print"
      />

      {/* --- PRINT ONLY HEADER --- */}
      <div className="hidden show-on-print mb-4 border-b-2 border-primary pb-3">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-tight text-primary">Relatório de Inventário</h1>
            <p className="text-[10px] font-bold text-black uppercase">
              Filtro: {hospitalFilter === 'all' ? 'Consolidado Geral' : allHospitalsData.find(h => h.id === hospitalFilter)?.name} 
              {unitFilter !== 'all' ? ` | Unidade: ${allServedUnitsData.find(u => u.id === unitFilter)?.name}` : ''}
            </p>
            <p className="text-[9px] text-muted-foreground">
              Status do Saldo: {balanceFilter === 'all' ? 'Exibir Todos' : balanceFilter === 'positive' ? 'Apenas com Saldo' : 'Apenas Zerados'}
            </p>
          </div>
          <div className="text-right flex flex-col items-end">
            <span className="bg-primary text-white text-[10px] px-2 py-0.5 font-bold mb-1">
              DATA DE GERAÇÃO: {new Date().toLocaleDateString('pt-BR')} {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <div className="text-[9px] text-black font-medium">
              Emitido por: {currentUserProfile?.name}
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm 10mm; }
          body { font-family: 'Segoe UI', system-ui, sans-serif; color: #000; background: #fff; }
          .no-print { display: none !important; }
          .show-on-print { display: block !important; }
          .printable-content { border: none !important; box-shadow: none !important; width: 100% !important; margin: 0 !important; padding: 0 !important; }
          
          table { width: 100% !important; border-collapse: collapse !important; border: 1.5px solid #000 !important; margin-top: 10px !important; }
          th { background-color: #f0f0f0 !important; -webkit-print-color-adjust: exact; font-size: 8px !important; text-transform: uppercase !important; border: 1px solid #000 !important; padding: 6px 4px !important; font-weight: bold !important; color: #000 !important; }
          td { font-size: 9px !important; border: 1px solid #000 !important; padding: 4px 6px !important; line-height: 1.2 !important; }
          tr:nth-child(even) { background-color: #fafafa !important; -webkit-print-color-adjust: exact; }
          
          .badge-print { border: 1px solid #000 !important; padding: 2px 4px !important; border-radius: 2px !important; font-size: 7px !important; font-weight: bold !important; }
          
          /* Force page titles and headers */
          h1 { font-size: 18px !important; margin-bottom: 5px !important; }
        }
        .show-on-print { display: none; }
      `}</style>
      <Card className="shadow-lg printable-content">
        <CardHeader>
          <CardTitle className="font-headline flex items-center gap-2">
            <PackageIcon className="h-6 w-6 text-primary" /> Visão Geral do Estoque
          </CardTitle>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 no-print">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="search" placeholder="Buscar por NOME do item (inicia com)..."
                className="pl-10 w-full" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
             <Select value={hospitalFilter} onValueChange={setHospitalFilter} disabled={isLoading || userIsOperator}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Hospital/Armazém" />
              </SelectTrigger>
              <SelectContent>
                {userCanSeeAll && <SelectItem value="all">Ver Tudo</SelectItem>}
                {userCanSeeAll && <SelectItem value="central">Apenas Armazém Central</SelectItem>}
                {allHospitalsData
                  .filter(h => userCanSeeAll || h.id === currentUserProfile?.associatedHospitalId)
                  .map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={unitFilter} onValueChange={setUnitFilter} 
                    disabled={isLoading || hospitalFilter === 'central' || hospitalFilter === 'all' || (userIsOperator && !!currentUserProfile?.associatedUnitId)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Unidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Unidades</SelectItem>
                {availableUnitsForFilter.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={balanceFilter} onValueChange={(val: any) => setBalanceFilter(val)} disabled={isLoading}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filtrar por Saldo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Saldo</SelectItem>
                <SelectItem value="positive">Apenas com Saldo (+)</SelectItem>
                <SelectItem value="zero">Apenas Zerados (0)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Buscando dados no Firestore...</p>
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
                {displayData.length > 0 ? (
                  displayData.map((item) => (
                    <TableRow key={item.id} className={item.status === 'Alert' || item.status === 'Low' ? 'bg-red-500/5' : ''}>
                      <TableCell className="font-medium">{item.itemName}</TableCell>
                      <TableCell>{item.itemCode || 'N/A'}</TableCell>
                      <TableCell>{item.hospitalName || (item.unitName === 'Armazém Central' ? '-' : 'N/D')}</TableCell>
                      <TableCell>{item.unitName}</TableCell>
                      <TableCell className="text-right">{item.currentQuantity}</TableCell>
                      <TableCell className="text-right">{item.minQuantity}</TableCell>
                      <TableCell className="text-right">{item.strategicStockLevel}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={getStatusBadgeVariant(item.status)} className="no-print">{getStatusBadgeText(item.status)}</Badge>
                        <span className="hidden show-on-print badge-print">{getStatusBadgeText(item.status)}</span>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center h-24">
                      Nenhum dado encontrado para os filtros e página atuais.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          )}
          {!isLoading && (
            <div className="flex justify-between items-center mt-4 pt-4 border-t no-print">
              <Button onClick={handlePrevPage} disabled={page === 1 || isLoading} variant="outline" size="sm">
                <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
              </Button>
              <span className="text-sm font-medium">Página {page}</span>
              <Button onClick={handleNextPage} disabled={isLastPage || isLoading} variant="outline" size="sm">
                Próxima <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
    

    
