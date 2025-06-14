
'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Warehouse, Search, Printer, Package as PackageIcon, Loader2 } from 'lucide-react'; // Renomeado Package para PackageIcon
import type { Item, ServedUnit, StockItemConfig, Hospital } from '@/types';
import { mockServedUnits, mockStockConfigs, mockHospitals } from '@/data/mockData'; // mockItems removido daqui
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

interface DisplayStockItem extends StockItemConfig {
  itemCode?: string; // Adicionado para exibição
  status?: 'Optimal' | 'Low' | 'Alert';
}

export default function StockPage() {
  const [firestoreItems, setFirestoreItems] = useState<Item[]>([]); // Itens do Firestore
  const [allServedUnits, setAllServedUnits] = useState<ServedUnit[]>([]);
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
  const [allStockConfigs, setAllStockConfigs] = useState<StockItemConfig[]>([]); // Configurações mockadas
  const [stockData, setStockData] = useState<DisplayStockItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [hospitalFilter, setHospitalFilter] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all'); 

  useEffect(() => {
    setIsLoading(true);
    // Buscar itens do Firestore
    const itemsCollectionRef = collection(firestore, "items");
    const qItems = query(itemsCollectionRef, orderBy("name", "asc"));
    const unsubscribeItems = onSnapshot(qItems, (querySnapshot) => {
      const itemsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item));
      setFirestoreItems(itemsData);
    }, (error) => {
      console.error("Erro ao buscar itens do Firestore: ", error);
      toast({ title: "Erro ao Carregar Itens", description: "Não foi possível carregar os itens do banco de dados.", variant: "destructive" });
    });

    // Carregar dados mock restantes (serão substituídos por Firestore no futuro)
    const enrichedServedUnits = mockServedUnits.map(su => ({
        ...su,
        hospitalName: mockHospitals.find(h => h.id === su.hospitalId)?.name || 'N/A'
    }));
    setAllServedUnits(enrichedServedUnits);
    setAllHospitals(mockHospitals);
    setAllStockConfigs(mockStockConfigs); // Armazenar configs mockadas
    
    return () => {
      unsubscribeItems();
    };
  }, [toast]);

  useEffect(() => {
    // Reconstruir stockData quando firestoreItems ou allStockConfigs mudarem
    if (firestoreItems.length === 0 && !isLoading) { // Se não há itens no Firestore e não está mais carregando, pode prosseguir
      //setIsLoading(false); // Movido para o final da reconstrução
    }
    if (firestoreItems.length > 0 || !isLoading) { // Processa se tiver itens ou se o carregamento inicial terminou
        const getUnitDetails = (unitId?: string) => {
            if (!unitId) return { unitName: 'Armazém Central', hospitalId: undefined, hospitalName: undefined };
            const unit = allServedUnits.find(u => u.id === unitId);
            if (!unit) return { unitName: 'Unidade Desconhecida', hospitalId: undefined, hospitalName: undefined };
            return {
              unitName: unit.name,
              hospitalId: unit.hospitalId,
              hospitalName: unit.hospitalName
            };
        };

        const centralStock: DisplayStockItem[] = firestoreItems.map(item => {
          const config = allStockConfigs.find(sc => sc.itemId === item.id && !sc.unitId);
          const currentQuantity = item.currentQuantityCentral;
          let status: DisplayStockItem['status'] = 'Optimal';
          if (config) {
            if (config.minQuantity > 0 && currentQuantity < config.minQuantity) {
                status = 'Low';
            } else if (currentQuantity < config.strategicStockLevel) {
                status = 'Alert';
            }
          } else { // Se não há config, usar minQuantity do próprio item para status Low
             if (item.minQuantity > 0 && currentQuantity < item.minQuantity) {
                status = 'Low';
             }
          }
          return {
            id: `central-${item.id}`,
            itemId: item.id,
            itemName: item.name,
            itemCode: item.code,
            ...getUnitDetails(undefined), // Armazém Central
            strategicStockLevel: config?.strategicStockLevel || 0, // Pega da config ou 0
            minQuantity: config?.minQuantity || item.minQuantity, // Pega da config ou do item
            currentQuantity: currentQuantity,
            status: status,
          };
        });

        const unitStock: DisplayStockItem[] = allStockConfigs // Usa configs mockadas para unidades
          .filter(config => config.unitId)
          .map(config => {
            const itemDetail = firestoreItems.find(i => i.id === config.itemId);
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
              itemName: config.itemName || itemDetail?.name,
              itemCode: itemDetail?.code,
              ...unitDetails,
              status: status,
            };
          });
        
        setStockData([...centralStock, ...unitStock].sort((a, b) => (a.hospitalName || '').localeCompare(b.hospitalName || '') || a.unitName!.localeCompare(b.unitName!) || (a.itemName || '').localeCompare(b.itemName || '')));
        setIsLoading(false); // Marca como carregado após reconstruir os dados
    }
  }, [firestoreItems, allServedUnits, allHospitals, allStockConfigs, isLoading]);


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
    