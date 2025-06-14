
'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Settings2, Save, AlertCircle, Loader2 } from 'lucide-react';
import type { StockItemConfig, Item, ServedUnit, Hospital } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, writeBatch, getDocs, setDoc, where } from 'firebase/firestore';

// Interface para o que é armazenado no Firestore para stockConfigs
interface FirestoreStockConfig {
  itemId: string;
  unitId?: string;
  hospitalId?: string;
  strategicStockLevel: number;
  minQuantity: number;
}

export default function StockLevelsConfigPage() {
  const [firestoreItems, setFirestoreItems] = useState<Item[]>([]);
  const [allServedUnits, setAllServedUnits] = useState<ServedUnit[]>([]);
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
  const [dbStockConfigs, setDbStockConfigs] = useState<FirestoreStockConfig[]>([]);
  
  const [stockConfigsForDisplay, setStockConfigsForDisplay] = useState<StockItemConfig[]>([]);
  const [hospitalFilter, setHospitalFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    setIsLoading(true);
    const fetchInitialData = async () => {
      try {
        // Fetch Items
        const itemsCollectionRef = collection(firestore, "items");
        const qItems = query(itemsCollectionRef, orderBy("name", "asc"));
        const itemsSnapshot = await getDocs(qItems);
        const itemsData = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item));
        setFirestoreItems(itemsData);

        // Fetch Served Units
        const unitsCollectionRef = collection(firestore, "servedUnits");
        const qUnits = query(unitsCollectionRef, orderBy("name", "asc"));
        const unitsSnapshot = await getDocs(qUnits);
        const unitsData = unitsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServedUnit));
        setAllServedUnits(unitsData);

        // Fetch Hospitals
        const hospitalsCollectionRef = collection(firestore, "hospitals");
        const qHospitals = query(hospitalsCollectionRef, orderBy("name", "asc"));
        const hospitalsSnapshot = await getDocs(qHospitals);
        const hospitalsData = hospitalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital));
        setAllHospitals(hospitalsData);
        
        // Fetch existing stock configurations
        const stockConfigsCollectionRef = collection(firestore, "stockConfigs"); // Nome da coleção alterado
        const stockConfigsSnapshot = await getDocs(stockConfigsCollectionRef);
        const dbConfigsData = stockConfigsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FirestoreStockConfig & {id: string}));
        setDbStockConfigs(dbConfigsData);

      } catch (error) {
        console.error("Erro ao buscar dados iniciais: ", error);
        toast({
          title: "Erro ao Carregar Dados",
          description: "Não foi possível carregar os dados necessários do banco de dados.",
          variant: "destructive",
        });
      } finally {
        // O setIsLoading(false) será chamado no useEffect que depende desses dados
      }
    };
    fetchInitialData();
  }, [toast]);

  useEffect(() => {
    if (firestoreItems.length > 0 || (!isLoading && firestoreItems.length === 0)) { 
        setIsLoading(true); 
        const combinedConfigs: StockItemConfig[] = [];

        firestoreItems.forEach(item => {
            // Armazém Central
            const centralDbConfig = dbStockConfigs.find(c => c.itemId === item.id && !c.unitId);
            combinedConfigs.push({
                id: `config_central_${item.id}`, 
                itemId: item.id,
                itemName: item.name,
                unitName: 'Armazém Central',
                strategicStockLevel: centralDbConfig?.strategicStockLevel || 0,
                minQuantity: centralDbConfig?.minQuantity ?? item.minQuantity, 
            });

            allServedUnits.forEach(unit => {
                const unitDbConfig = dbStockConfigs.find(c => c.itemId === item.id && c.unitId === unit.id);
                const hospital = allHospitals.find(h => h.id === unit.hospitalId);
                combinedConfigs.push({
                    id: `config_${item.id}_${unit.id}`, 
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
        });
        setStockConfigsForDisplay(combinedConfigs.sort((a,b) => (a.hospitalName || '').localeCompare(b.hospitalName || '') || (a.unitName || '').localeCompare(b.unitName || '') || (a.itemName || '').localeCompare(b.itemName || '')));
        setIsLoading(false);
    }
  }, [firestoreItems, allServedUnits, allHospitals, dbStockConfigs, isLoading]);


  const handleInputChange = (configId: string, field: keyof StockItemConfig, value: string) => {
    setStockConfigsForDisplay(prevConfigs =>
      prevConfigs.map(config =>
        config.id === configId ? { ...config, [field]: Number(value) < 0 ? 0 : Number(value) } : config
      )
    );
  };

  const handleSaveAll = async () => {
    setIsLoading(true);
    const batch = writeBatch(firestore);

    stockConfigsForDisplay.forEach(config => {
      const firestoreDocId = `${config.itemId}_${config.unitId || 'central'}`;
      const configDocRef = doc(firestore, "stockConfigs", firestoreDocId); // Nome da coleção alterado
      
      const dataToSave: FirestoreStockConfig = {
        itemId: config.itemId,
        strategicStockLevel: config.strategicStockLevel,
        minQuantity: config.minQuantity,
      };
      if (config.unitId) {
        dataToSave.unitId = config.unitId;
      }
      if (config.hospitalId) {
        dataToSave.hospitalId = config.hospitalId;
      }
      batch.set(configDocRef, dataToSave);
    });

    try {
      await batch.commit();
      toast({
        title: "Configurações Salvas",
        description: "Todos os níveis estratégicos de estoque foram atualizados no banco de dados.",
      });
      // Para atualizar a visualização com os IDs corretos do Firestore após um novo save (se um config não existia antes),
      // precisamos recarregar `dbStockConfigs`.
      const stockConfigsCollectionRef = collection(firestore, "stockConfigs"); // Nome da coleção alterado
      const stockConfigsSnapshot = await getDocs(stockConfigsCollectionRef);
      const dbConfigsData = stockConfigsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FirestoreStockConfig & {id: string}));
      setDbStockConfigs(dbConfigsData);

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
    if (hospitalFilter === 'all') return true;
    if (hospitalFilter === 'central' && !config.unitId) return true;
    return config.hospitalId === hospitalFilter;
  });

  return (
    <div>
      <PageHeader
        title="Níveis Estratégicos de Estoque"
        description="Configure os níveis estratégicos e mínimos para itens no armazém central e unidades servidas por hospital."
        icon={Settings2}
        actions={
          <Button onClick={handleSaveAll} disabled={isLoading}>
            <Save className="mr-2 h-4 w-4" /> Salvar Todas as Alterações
          </Button>
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Configurar Níveis</CardTitle>
          <CardDescription>
            Defina os níveis de estoque desejados. Alertas serão acionados se o estoque atual cair abaixo desses níveis.
            Quantidade mínima é o menor nível absoluto antes de um alerta crítico.
          </CardDescription>
          <div className="mt-4">
            <Select value={hospitalFilter} onValueChange={setHospitalFilter} disabled={isLoading}>
                <SelectTrigger className="w-full md:w-1/3">
                    <SelectValue placeholder="Filtrar por Hospital/Armazém" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Todos Hospitais e Armazém Central</SelectItem>
                    <SelectItem value="central">Apenas Armazém Central</SelectItem>
                    {allHospitals.map(hospital => (
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
                        <TableCell>{config.hospitalName || (config.unitId ? 'N/A' : '-')}</TableCell>
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
    

    