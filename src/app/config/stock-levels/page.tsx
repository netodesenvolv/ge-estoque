
'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Settings2, Save, AlertCircle, Loader2, ShieldAlert } from 'lucide-react';
import type { StockItemConfig as GlobalStockItemConfig, Item, ServedUnit, Hospital, UserProfile } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, writeBatch, getDocs } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { Alert } from '@/components/ui/alert';


interface FirestoreStockConfig {
  id?: string; 
  itemId: string;
  unitId?: string;
  hospitalId?: string;
  strategicStockLevel: number;
  minQuantity: number;
  currentQuantity?: number;
}

interface DisplayStockConfig extends GlobalStockItemConfig {
  // currentQuantity é herdado, mas não será editado aqui
}


export default function StockLevelsConfigPage() {
  const { currentUserProfile } = useAuth();
  const [firestoreItems, setFirestoreItems] = useState<Item[]>([]);
  const [allServedUnits, setAllServedUnits] = useState<ServedUnit[]>([]);
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
  const [dbStockConfigs, setDbStockConfigs] = useState<FirestoreStockConfig[]>([]);
  
  const [stockConfigsForDisplay, setStockConfigsForDisplay] = useState<DisplayStockConfig[]>([]);
  const [hospitalFilter, setHospitalFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const userCanSeeAll = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator';
  const canEditConfigs = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator';

  useEffect(() => {
    if (!currentUserProfile) return;

    setIsLoading(true);
    const unsubscribers: (() => void)[] = [];

    const itemsQuery = query(collection(firestore, "items"), orderBy("name", "asc"));
    unsubscribers.push(onSnapshot(itemsQuery, snapshot => 
        setFirestoreItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)))
    ));

    const unitsQuery = query(collection(firestore, "servedUnits"), orderBy("name", "asc"));
    unsubscribers.push(onSnapshot(unitsQuery, snapshot => {
          const unitsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServedUnit));
          setAllServedUnits(unitsData);
    }));

    const hospitalsQuery = query(collection(firestore, "hospitals"), orderBy("name", "asc"));
    unsubscribers.push(onSnapshot(hospitalsQuery, snapshot => {
        const hospitalsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital));
        setAllHospitals(hospitalsData);
        if (!userCanSeeAll && currentUserProfile?.associatedHospitalId) {
          setHospitalFilter(currentUserProfile.associatedHospitalId);
        }
    }));
    
    const stockConfigsQuery = query(collection(firestore, "stockConfigs"));
    unsubscribers.push(onSnapshot(stockConfigsQuery, snapshot => {
        setDbStockConfigs(snapshot.docs.map(docData => ({ id: docData.id, ...docData.data() } as FirestoreStockConfig & {id: string})));
    }));

    Promise.all([
        getDocs(itemsQuery), getDocs(unitsQuery), getDocs(hospitalsQuery), getDocs(stockConfigsQuery)
    ]).catch(error => {
        console.error("Erro ao buscar dados iniciais para config de estoque: ", error);
        toast({
            title: "Erro ao Carregar Dados Iniciais",
            description: "Não foi possível carregar todos os dados necessários.",
            variant: "destructive",
        });
    }).finally(() => {
      // setIsLoading(false) will be handled by the combining useEffect
    });


    return () => unsubscribers.forEach(unsub => unsub());
  }, [toast, currentUserProfile, userCanSeeAll]);

  useEffect(() => {
    if (!currentUserProfile || firestoreItems.length === 0 && allServedUnits.length === 0 && allHospitals.length === 0 && dbStockConfigs.length === 0) {
        if (!isLoading && firestoreItems.length === 0) {
            setIsLoading(false);
            setStockConfigsForDisplay([]);
        }
        return;
    }

    if (firestoreItems.length >= 0 && allServedUnits.length >= 0 && allHospitals.length >= 0 && dbStockConfigs.length >= 0) {
        setIsLoading(true);
        let combinedConfigs: DisplayStockConfig[] = [];

        firestoreItems.forEach(item => {
            // 1. Central Warehouse Configuration
            const centralDbConfigId = `${item.id}_central`;
            const centralDbConfig = dbStockConfigs.find(c => c.id === centralDbConfigId);
            if (userCanSeeAll || currentUserProfile?.role === 'central_operator') {
                combinedConfigs.push({
                    id: centralDbConfigId,
                    itemId: item.id,
                    itemName: item.name,
                    unitName: 'Armazém Central',
                    strategicStockLevel: centralDbConfig?.strategicStockLevel || 0,
                    minQuantity: centralDbConfig?.minQuantity ?? item.minQuantity,
                });
            }

            // 2. Specific Served Units Configuration
            allServedUnits.forEach(unit => {
                if (!userCanSeeAll && unit.hospitalId !== currentUserProfile?.associatedHospitalId) {
                    return;
                }
                if (currentUserProfile?.role === 'hospital_operator' && currentUserProfile.associatedUnitId && unit.id !== currentUserProfile.associatedUnitId) {
                    return;
                }

                const unitDbConfigId = `${item.id}_${unit.id}`;
                const unitDbConfig = dbStockConfigs.find(c => c.id === unitDbConfigId);
                const hospital = allHospitals.find(h => h.id === unit.hospitalId);
                combinedConfigs.push({
                    id: unitDbConfigId,
                    itemId: item.id,
                    itemName: item.name,
                    unitId: unit.id,
                    unitName: unit.name,
                    hospitalId: unit.hospitalId,
                    hospitalName: hospital?.name || 'N/A',
                    strategicStockLevel: unitDbConfig?.strategicStockLevel || 0,
                    minQuantity: unitDbConfig?.minQuantity || 0,
                });
            });

            // 3. UBS General Stock Configuration
            allHospitals.forEach(hospital => {
                if (hospital.name.toLowerCase().includes('ubs')) {
                    // A user associated with a specific unit should not see "general stock" configs.
                    if (currentUserProfile?.associatedUnitId) {
                        return;
                    }
                    // An operator not associated with a specific unit should only see their associated hospital's configs.
                    if (!userCanSeeAll && hospital.id !== currentUserProfile?.associatedHospitalId) {
                        return;
                    }

                    const ubsGeneralConfigId = `${item.id}_${hospital.id}_UBSGENERAL`;
                    const ubsGeneralDbConfig = dbStockConfigs.find(c => c.id === ubsGeneralConfigId);

                    combinedConfigs.push({
                        id: ubsGeneralConfigId,
                        itemId: item.id,
                        itemName: item.name,
                        unitName: `Estoque Geral (${hospital.name})`,
                        hospitalId: hospital.id,
                        hospitalName: hospital.name,
                        strategicStockLevel: ubsGeneralDbConfig?.strategicStockLevel || 0,
                        minQuantity: ubsGeneralDbConfig?.minQuantity || 0,
                    });
                }
            });
        });

        setStockConfigsForDisplay(combinedConfigs.sort((a, b) => (a.hospitalName || '').localeCompare(b.hospitalName || '') || (a.unitName || '').localeCompare(b.unitName || '') || (a.itemName || '').localeCompare(b.itemName || '')));
        setIsLoading(false);
    } else if (firestoreItems.length === 0 && !isLoading) {
        setStockConfigsForDisplay([]);
        setIsLoading(false);
    }
  }, [firestoreItems, allServedUnits, allHospitals, dbStockConfigs, currentUserProfile, userCanSeeAll, isLoading]);


  const handleInputChange = (configId: string, field: keyof DisplayStockConfig, value: string) => {
    if (!canEditConfigs) return;
    setStockConfigsForDisplay(prevConfigs =>
      prevConfigs.map(config =>
        config.id === configId ? { ...config, [field]: Number(value) < 0 ? 0 : Number(value) } : config
      )
    );
  };

  const handleSaveAll = async () => {
    if (!canEditConfigs) {
      toast({
        title: "Permissão Negada",
        description: "Você não tem permissão para salvar estas configurações.",
        variant: "destructive",
      });
      return;
    }
    setIsLoading(true);
    const batch = writeBatch(firestore);

    stockConfigsForDisplay.forEach(config => {
      const configDocRef = doc(firestore, "stockConfigs", config.id); 
      
      const dataToSave: Partial<FirestoreStockConfig> & { itemId: string; strategicStockLevel: number; minQuantity: number; } = {
        itemId: config.itemId,
        strategicStockLevel: config.strategicStockLevel,
        minQuantity: config.minQuantity,
      };

      // This covers both specific units and general UBS stock, as both have a hospitalId.
      // The central warehouse config has no hospitalId and this block will be skipped, which is correct.
      if (config.hospitalId) {
        dataToSave.hospitalId = config.hospitalId;
        dataToSave.unitId = config.unitId || null; // Save unitId if present, otherwise explicitly set to null
      }
      
      batch.set(configDocRef, dataToSave, { merge: true });
    });

    try {
      await batch.commit();
      toast({
        title: "Configurações Salvas",
        description: "Todos os níveis estratégicos de estoque foram atualizados no banco de dados.",
      });
    } catch (error) {
      console.error('Erro ao salvar configurações de nível de estoque:', error);
      toast({
        title: "Erro ao Salvar",
        description: "Não foi possível salvar as configurações. Verifique o console.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredConfigs = stockConfigsForDisplay.filter(config => {
    if (!userCanSeeAll && currentUserProfile?.associatedHospitalId) {
      if (currentUserProfile.associatedUnitId) {
          return config.unitId === currentUserProfile.associatedUnitId;
      }
      return config.hospitalId === currentUserProfile.associatedHospitalId || !config.hospitalId; 
    }

    if (hospitalFilter === 'all') return true;
    if (hospitalFilter === 'central' && !config.unitId && config.unitName === 'Armazém Central') return true;
    return config.hospitalId === hospitalFilter;
  });

  return (
    <div>
      <PageHeader
        title="Níveis Estratégicos de Estoque"
        description="Configure os níveis estratégicos e mínimos para itens no armazém central e unidades servidas por hospital."
        icon={Settings2}
        actions={
          canEditConfigs && (
            <Button onClick={handleSaveAll} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar Todas as Alterações
            </Button>
          )
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Configurar Níveis</CardTitle>
          <CardDescription>
            Defina os níveis de estoque desejados. Alertas serão acionados se o estoque atual cair abaixo desses níveis.
            Quantidade mínima é o menor nível absoluto antes de um alerta crítico.
          </CardDescription>
          {!canEditConfigs && (
            <Alert variant="default" className="mt-4 bg-blue-50 border-blue-200">
                <ShieldAlert className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-blue-700">Modo Somente Leitura</CardTitle>
                <CardDescription className="text-blue-600">
                Você pode visualizar as configurações de estoque para seu hospital/unidade.
                Apenas Administradores ou Operadores do Almoxarifado Central podem modificar estas configurações.
                </CardDescription>
            </Alert>
          )}
          <div className="mt-4">
            <Select 
              value={hospitalFilter} 
              onValueChange={setHospitalFilter} 
              disabled={isLoading || !userCanSeeAll}
            >
                <SelectTrigger className="w-full md:w-1/3">
                    <SelectValue placeholder="Filtrar por Hospital/Armazém" />
                </SelectTrigger>
                <SelectContent>
                  {userCanSeeAll && <SelectItem value="all">Todos Hospitais e Armazém Central</SelectItem>}
                  {userCanSeeAll && <SelectItem value="central">Apenas Armazém Central</SelectItem>}
                  {allHospitals.filter(h => userCanSeeAll || h.id === currentUserProfile?.associatedHospitalId).map(hospital => (
                    <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>
                  ))}
                </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && stockConfigsForDisplay.length === 0 ? ( 
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Carregando itens e configurações...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome do Item</TableHead>
                    <TableHead>Hospital</TableHead>
                    <TableHead>Unidade/Localização</TableHead>
                    <TableHead className="text-right">Qtde. Mínima</TableHead>
                    <TableHead className="text-right">Nível Estratégico</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredConfigs.length > 0 ? (
                    filteredConfigs.map((config) => (
                      <TableRow key={config.id}>
                        <TableCell className="font-medium">{config.itemName}</TableCell>
                        <TableCell>{config.hospitalName || (config.unitId ? 'N/A' : (config.unitName === 'Armazém Central' ? '-' : 'N/D'))}</TableCell>
                        <TableCell>{config.unitName}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={config.minQuantity}
                            onChange={(e) => handleInputChange(config.id, 'minQuantity', e.target.value)}
                            className="w-24 text-right ml-auto"
                            min="0"
                            disabled={!canEditConfigs}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={config.strategicStockLevel}
                            onChange={(e) => handleInputChange(config.id, 'strategicStockLevel', e.target.value)}
                            className="w-24 text-right ml-auto"
                            min="0"
                            disabled={!canEditConfigs}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center h-24">
                        Nenhum item ou unidade encontrada para configurar com o filtro atual, ou os dados ainda estão carregando.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
       <Card className="mt-6 bg-accent/30 border-accent shadow-lg">
        <CardHeader className="flex flex-row items-start gap-3">
          <AlertCircle className="h-6 w-6 text-accent-foreground mt-1" />
          <div>
            <CardTitle className="font-headline text-accent-foreground">Entendendo os Níveis</CardTitle>
            <CardDescription className="text-accent-foreground/80">
              <strong>Quantidade Mínima:</strong> O nível de estoque aceitável mais baixo. Ficar abaixo disso aciona alertas críticos e indica uma necessidade urgente de reabastecimento. Para o Armazém Central, se não configurado, usará a Qtde. Mínima definida no cadastro do item.
              <br />
              <strong>Nível Estratégico de Estoque:</strong> O nível de estoque ótimo desejado. Ficar abaixo disso aciona um aviso, solicitando uma revisão e potencial reabastecimento para manter as operações tranquilas e proteger contra flutuações de demanda.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
    
