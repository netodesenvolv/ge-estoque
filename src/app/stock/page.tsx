
'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Warehouse, Search, Printer, Package as PackageIcon, Loader2 } from 'lucide-react';
import type { Item, ServedUnit, Hospital } from '@/types';
import { mockServedUnits, mockHospitals } from '@/data/mockData'; // mockStockConfigs removido
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, getDocs } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

// Interface para o que é armazenado no Firestore para stockConfigs
interface FirestoreStockConfig {
  id?: string; // ID do documento do Firestore (itemId_unitId ou itemId_central)
  itemId: string;
  unitId?: string;
  hospitalId?: string;
  strategicStockLevel: number;
  minQuantity: number;
}

// Interface para exibição na tabela
interface DisplayStockItem {
  id: string; // ID único para a linha da tabela
  itemId: string;
  itemName?: string;
  itemCode?: string;
  hospitalId?: string;
  hospitalName?: string;
  unitId?: string;
  unitName?: string;
  currentQuantity?: number;
  minQuantity: number;
  strategicStockLevel: number;
  status?: 'Optimal' | 'Low' | 'Alert';
}

export default function StockPage() {
  const [firestoreItems, setFirestoreItems] = useState<Item[]>([]);
  const [allServedUnits, setAllServedUnits] = useState<ServedUnit[]>([]);
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
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
    let activeListeners = 0;
    const checkDoneLoading = () => {
      activeListeners--;
      if (activeListeners === 0) {
        // O setIsLoading(false) será chamado no useEffect que combina os dados
      }
    };

    activeListeners++;
    const itemsCollectionRef = collection(firestore, "items");
    const qItems = query(itemsCollectionRef, orderBy("name", "asc"));
    const unsubscribeItems = onSnapshot(qItems, (querySnapshot) => {
      const itemsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item));
      setFirestoreItems(itemsData);
      checkDoneLoading();
    }, (error) => {
      console.error("Erro ao buscar itens do Firestore: ", error);
      toast({ title: "Erro ao Carregar Itens", description: "Não foi possível carregar os itens.", variant: "destructive" });
      checkDoneLoading();
    });
    
    activeListeners++;
    const stockConfigsCollectionRef = collection(firestore, "stockConfigs");
    const unsubscribeStockConfigs = onSnapshot(stockConfigsCollectionRef, (querySnapshot) => {
      const configsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FirestoreStockConfig));
      setFirestoreStockConfigs(configsData);
      checkDoneLoading();
    }, (error) => {
      console.error("Erro ao buscar configurações de estoque: ", error);
      toast({ title: "Erro ao Carregar Config. de Estoque", description: "Não foi possível carregar as config. de estoque.", variant: "destructive" });
      checkDoneLoading();
    });

    // Dados mock para unidades e hospitais (substituir por Firestore no futuro, se necessário para esta página)
    const enrichedServedUnits = mockServedUnits.map(su => ({
        ...su,
        hospitalName: mockHospitals.find(h => h.id === su.hospitalId)?.name || 'N/A'
    }));
    setAllServedUnits(enrichedServedUnits);
    setAllHospitals(mockHospitals);
    
    return () => {
      unsubscribeItems();
      unsubscribeStockConfigs();
    };
  }, [toast]);

  useEffect(() => {
    if (firestoreItems.length > 0 || (!isLoading && firestoreItems.length === 0 && firestoreStockConfigs.length >= 0)) {
        setIsLoading(true); // Reinicia o loading para a fase de combinação
        const getUnitDetails = (unitId?: string) => {
            if (!unitId) return { unitName: 'Armazém Central', hospitalId: undefined, hospitalName: undefined };
            const unit = allServedUnits.find(u => u.id === unitId); // allServedUnits ainda é mock
            if (!unit) return { unitName: 'Unidade Desconhecida', hospitalId: undefined, hospitalName: undefined };
            return {
              unitName: unit.name,
              hospitalId: unit.hospitalId,
              hospitalName: unit.hospitalName
            };
        };

        const combinedData: DisplayStockItem[] = [];

        // Estoque Central
        firestoreItems.forEach(item => {
          const configId = `${item.id}_central`;
          const config = firestoreStockConfigs.find(sc => sc.id === configId);
          const currentQuantity = item.currentQuantityCentral;
          
          const strategicLvl = config?.strategicStockLevel || 0;
          const minQty = config?.minQuantity ?? item.minQuantity; // Usa do config, senão do item

          let status: DisplayStockItem['status'] = 'Optimal';
          if (minQty > 0 && currentQuantity < minQty) {
              status = 'Low';
          } else if (currentQuantity < strategicLvl) {
              status = 'Alert';
          }

          combinedData.push({
            id: `central-${item.id}`,
            itemId: item.id,
            itemName: item.name,
            itemCode: item.code,
            ...getUnitDetails(undefined), // Armazém Central
            strategicStockLevel: strategicLvl,
            minQuantity: minQty,
            currentQuantity: currentQuantity,
            status: status,
          });
        });

        // Estoque das Unidades (baseado nas configs do Firestore)
        firestoreStockConfigs.forEach(config => {
          if (config.unitId) { // Apenas configurações de unidades
            const itemDetail = firestoreItems.find(i => i.id === config.itemId);
            if (!itemDetail) return; // Se o item da config não existe no catálogo, pula

            const unitDetails = getUnitDetails(config.unitId);
            
            // currentQuantity para unidades não é gerenciado centralmente da mesma forma
            // Para esta tela, pode ser N/A ou precisar de um sistema de inventário por unidade
            const currentUnitQuantity = undefined; // Placeholder - não temos essa info no 'items' nem no 'stockConfigs' por unidade

            let status: DisplayStockItem['status'] = 'Optimal';
            if (typeof currentUnitQuantity === 'number') { // Apenas calcula status se currentUnitQuantity for conhecido
               if (config.minQuantity > 0 && currentUnitQuantity < config.minQuantity) {
                 status = 'Low';
               } else if (currentUnitQuantity < config.strategicStockLevel) {
                 status = 'Alert';
               }
            } else {
                 status = undefined; // Ou 'N/A' se preferir, pois não sabemos a quantidade atual
            }
            
            combinedData.push({
              id: config.id || `${config.itemId}_${config.unitId}`, // Usa o ID do Firestore doc se disponível
              itemId: config.itemId,
              itemName: itemDetail.name,
              itemCode: itemDetail.code,
              ...unitDetails,
              strategicStockLevel: config.strategicStockLevel,
              minQuantity: config.minQuantity,
              currentQuantity: currentUnitQuantity, // Será undefined por enquanto
              status: status,
            });
          }
        });
        
        setStockData(combinedData.sort((a, b) => 
            (a.hospitalName || '').localeCompare(b.hospitalName || '') || 
            a.unitName!.localeCompare(b.unitName!) || 
            (a.itemName || '').localeCompare(b.itemName || '')
        ));
        setIsLoading(false);
    }
  }, [firestoreItems, firestoreStockConfigs, allServedUnits, allHospitals, isLoading]);


  const filteredUnitsForSelect = hospitalFilter === 'all' || hospitalFilter === 'central' 
    ? allServedUnits 
    : allServedUnits.filter(u => u.hospitalId === hospitalFilter);

  useEffect(() => {
    if (unitFilter !== 'all' && !filteredUnitsForSelect.find(u => u.id === unitFilter)) {
      setUnitFilter('all');
    }
  }, [hospitalFilter, unitFilter, filteredUnitsForSelect]);


  const filteredStockData = stockData.filter(item => {
    const nameMatch = item.itemName?.toLowerCase().includes(searchTerm.toLowerCase()) || item.itemCode?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const hospitalMatchLogic = () => {
        if (hospitalFilter === 'all') return true;
        if (hospitalFilter === 'central') return !item.unitId; // Apenas Armazém Central
        return item.hospitalId === hospitalFilter;
    };
    const unitMatchLogic = () => {
        if (!item.unitId && hospitalFilter === 'central') return true; // Armazém central com filtro 'central'
        if (hospitalFilter === 'central' && item.unitId) return false; // Unidade não deve aparecer com filtro 'central'

        if (unitFilter === 'all') return hospitalMatchLogic(); 
        return item.unitId === unitFilter && hospitalMatchLogic(); 
    };

    const statusMatch = statusFilter === 'all' || item.status === statusFilter;
    
    return nameMatch && unitMatchLogic() && statusMatch;
  });

  const getStatusBadgeVariant = (status?: DisplayStockItem['status']) => {
    if (status === 'Alert') return 'destructive'; 
    if (status === 'Low') return 'secondary'; 
    if (status === 'Optimal') return 'default';
    return 'outline'; // Para status indefinido (ex: unidades sem qtde atual)
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
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.itemName}</TableCell>
                      <TableCell>{item.itemCode || 'N/A'}</TableCell>
                      <TableCell>{item.hospitalName || (item.unitId ? 'N/A' : '-')}</TableCell>
                      <TableCell>{item.unitName}</TableCell>
                      <TableCell className="text-right">{item.currentQuantity ?? 'N/D'}</TableCell> {/* N/D para unidades */}
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
    
