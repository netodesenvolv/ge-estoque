
'use client';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { ShoppingCart, CheckCircle, User, Loader2, Building, MapPin } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient, StockMovement, UserProfile, FirestoreStockConfig } from '@/types';
import { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, runTransaction, getDoc, type FirestoreError } from 'firebase/firestore';
import { processMovementRowTransaction } from '@/app/stock/movements/page'; 

const NO_PATIENT_ID = "__NO_PATIENT__";
const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";
const GENERAL_STOCK_UNIT_ID_PLACEHOLDER = "__GENERAL_STOCK_UNIT__";
const CENTRAL_WAREHOUSE_ID = "__CENTRAL_WAREHOUSE__";


const locationSelectionSchema = z.object({
  hospitalId: z.string().min(1, "Selecione o hospital/local."),
  unitId: z.string().optional(), 
});

const consumptionDetailsSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  quantityConsumed: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  patientId: z.string().optional(),
  notes: z.string().optional(),
});

type LocationSelectionFormData = z.infer<typeof locationSelectionSchema>;
type ConsumptionDetailsFormData = z.infer<typeof consumptionDetailsSchema>;

export default function GeneralConsumptionPage() {
  const { toast } = useToast();
  const { currentUserProfile, user: firebaseUser } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [stockConfigs, setStockConfigs] = useState<FirestoreStockConfig[]>([]);

  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSubmittingConsumption, setIsSubmittingConsumption] = useState(false);
  
  const [stage, setStage] = useState<'selectLocation' | 'fillForm'>('selectLocation');
  const [selectedLocation, setSelectedLocation] = useState<{ hospitalId: string; unitId?: string; hospitalName: string; unitName: string } | null>(null);

  const locationForm = useForm<LocationSelectionFormData>({
    resolver: zodResolver(locationSelectionSchema),
    defaultValues: { hospitalId: undefined, unitId: undefined },
  });

  const consumptionForm = useForm<ConsumptionDetailsFormData>({
    resolver: zodResolver(consumptionDetailsSchema),
    defaultValues: {
      quantityConsumed: 1,
      date: new Date().toISOString().split('T')[0],
      patientId: undefined,
      notes: '',
      itemId: undefined,
    },
  });

  const handleSnapshotError = (collectionName: string, error: FirestoreError) => {
    console.error(`Error loading ${collectionName}:`, error);
    if (error.code === 'permission-denied') {
      toast({
        title: `Permissão Negada: ${collectionName}`,
        description: `Não foi possível carregar dados de '${collectionName}'. Verifique suas Regras de Segurança do Firestore.`,
        variant: "destructive",
        duration: 10000, 
      });
    } else {
      toast({
        title: `Erro ao Carregar ${collectionName.charAt(0).toUpperCase() + collectionName.slice(1)}`,
        description: error.message,
        variant: "destructive",
      });
    }
  };
  
  useEffect(() => {
    setIsLoadingData(true);
    const unsubscribers = [
      onSnapshot(query(collection(firestore, "items"), orderBy("name", "asc")), 
        snapshot => setItems(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Item))), 
        (error) => handleSnapshotError("itens", error as FirestoreError)
      ),
      onSnapshot(query(collection(firestore, "patients"), orderBy("name", "asc")), 
        snapshot => setPatients(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Patient))), 
        (error) => handleSnapshotError("pacientes", error as FirestoreError)
      ),
      onSnapshot(query(collection(firestore, "hospitals"), orderBy("name", "asc")), 
        snapshot => setHospitals(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Hospital))), 
        (error) => handleSnapshotError("hospitais", error as FirestoreError)
      ),
      onSnapshot(query(collection(firestore, "servedUnits"), orderBy("name", "asc")), 
        snapshot => setServedUnits(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ServedUnit))), 
        (error) => handleSnapshotError("unidades servidas", error as FirestoreError)
      ),
      onSnapshot(query(collection(firestore, "stockConfigs")), 
        snapshot => setStockConfigs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as FirestoreStockConfig))), 
        (error) => handleSnapshotError("configurações de estoque", error as FirestoreError)
      ),
    ];
    
    // Simplified loading check: assume all listeners are set up, then wait a bit.
    // A more robust solution would track individual load states for each collection.
    const timer = setTimeout(() => {
        setIsLoadingData(false); 
    }, 2500); // Increased timeout slightly


    return () => {
      unsubscribers.forEach(unsub => unsub());
      clearTimeout(timer);
    };
  }, [toast]); 


  useEffect(() => {
    if (currentUserProfile && !isLoadingData) { 
      const userRole = currentUserProfile.role;
      const userHospitalId = currentUserProfile.associatedHospitalId;
      const userUnitId = currentUserProfile.associatedUnitId;
  
      if ((userRole === 'hospital_operator' || userRole === 'ubs_operator') && userHospitalId) {
        if (locationForm.getValues('hospitalId') !== userHospitalId) {
          locationForm.setValue('hospitalId', userHospitalId);
          locationForm.setValue('unitId', undefined); 
        }
  
        if (userUnitId && locationForm.getValues('unitId') !== userUnitId) {
           locationForm.setValue('unitId', userUnitId);
        }
      }
    }
  }, [currentUserProfile, isLoadingData, locationForm]); 
  

  const watchedHospitalId = locationForm.watch('hospitalId');

  useEffect(() => {
    const userIsOperatorWithFixedHospital = 
      (currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator') &&
      currentUserProfile?.associatedHospitalId === watchedHospitalId;

    if (!userIsOperatorWithFixedHospital && watchedHospitalId) {
        if (locationForm.getValues('unitId') !== undefined) {
             locationForm.setValue('unitId', undefined);
        }
    }
  }, [watchedHospitalId, locationForm, currentUserProfile]);


  const availableUnitsForSelection = useMemo(() => {
    if (!watchedHospitalId || watchedHospitalId === CENTRAL_WAREHOUSE_ID || isLoadingData) return [];
    return servedUnits.filter(unit => unit.hospitalId === watchedHospitalId);
  }, [watchedHospitalId, servedUnits, isLoadingData]);

  const selectedHospitalDetails = useMemo(() => {
    if (isLoadingData || !watchedHospitalId) return null;
    return hospitals.find(h => h.id === watchedHospitalId);
  }, [watchedHospitalId, hospitals, isLoadingData]);

  const isSelectedHospitalUBS = selectedHospitalDetails?.name.toLowerCase().includes('ubs') || false;


  const handleLocationSubmit = (data: LocationSelectionFormData) => {
    const hospital = hospitals.find(h => h.id === data.hospitalId);
    if (!hospital) {
      toast({ title: "Erro", description: "Hospital selecionado inválido.", variant: "destructive" });
      return;
    }
    let unitNameDisplay = "Armazém Central";
    if (data.hospitalId === CENTRAL_WAREHOUSE_ID) {
       unitNameDisplay = "Armazém Central";
    } else if (data.unitId && data.unitId !== GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
      const unit = servedUnits.find(u => u.id === data.unitId);
      unitNameDisplay = unit?.name || "Unidade Desconhecida";
    } else if (data.unitId === GENERAL_STOCK_UNIT_ID_PLACEHOLDER && hospital?.name.toLowerCase().includes('ubs')) {
      unitNameDisplay = `Estoque Geral (${hospital.name})`;
    } else if (data.hospitalId && (!data.unitId || data.unitId === GENERAL_STOCK_UNIT_ID_PLACEHOLDER) && !hospital?.name.toLowerCase().includes('ubs')) {
      // This case should ideally not happen if button logic is correct, but good to handle
      toast({ title: "Erro de Seleção", description: "Para hospitais (não UBS), uma unidade específica deve ser selecionada para consumo.", variant: "destructive" });
      return;
    }


    setSelectedLocation({
      hospitalId: data.hospitalId,
      unitId: data.unitId === GENERAL_STOCK_UNIT_ID_PLACEHOLDER ? undefined : data.unitId,
      hospitalName: hospital.name,
      unitName: unitNameDisplay,
    });
    setStage('fillForm');
    consumptionForm.reset(); 
  };

  const handleConsumptionSubmit = async (data: ConsumptionDetailsFormData) => {
    if (!currentUserProfile || !firebaseUser || !selectedLocation) {
      toast({ title: "Erro", description: "Dados de localização ou usuário insuficientes.", variant: "destructive" });
      return;
    }
    setIsSubmittingConsumption(true);

    const itemForRow = items.find(i => i.id === data.itemId);
    if (!itemForRow) {
      toast({ title: "Erro", description: "Item selecionado não encontrado.", variant: "destructive" });
      setIsSubmittingConsumption(false);
      return;
    }

    const movementDataForTransaction: Omit<StockMovement, 'id' | 'itemName' | 'hospitalName' | 'unitName' | 'patientName' | 'userDisplayName' | 'userId'> & { itemId: string } = {
      itemId: data.itemId,
      type: 'consumption',
      quantity: data.quantityConsumed,
      date: data.date,
      hospitalId: selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID ? undefined : selectedLocation.hospitalId,
      unitId: selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID ? undefined : selectedLocation.unitId,
      patientId: data.patientId === NO_PATIENT_ID ? undefined : data.patientId,
      notes: data.notes,
    };
    
    try {
      await runTransaction(firestore, (transaction) =>
        processMovementRowTransaction(
          transaction,
          movementDataForTransaction,
          currentUserProfile,
          items, hospitals, servedUnits, patients
        )
      );

      let description = `${data.quantityConsumed} unidade(s) de ${itemForRow.name} consumido(s) em ${selectedLocation.unitName} (${selectedLocation.hospitalName}).`;
      if (data.patientId && data.patientId !== NO_PATIENT_ID) {
        description += ` Paciente: ${patients.find(p => p.id === data.patientId)?.name}.`;
      }
      toast({
        title: "Consumo Registrado",
        description: description,
        action: <CheckCircle className="text-green-500" />,
      });
      consumptionForm.reset({
        itemId: undefined,
        quantityConsumed: 1,
        date: new Date().toISOString().split('T')[0],
        patientId: undefined,
        notes: '',
      });
    } catch (error: any) {
      console.error('Erro ao registrar consumo:', error);
      toast({
        title: "Erro ao Registrar Consumo",
        description: error.message || "Não foi possível concluir a operação.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingConsumption(false);
    }
  };

  const getDisplayStockForItemAtSelectedLocation = (item: Item): number => {
    if (!selectedLocation || isLoadingData) return 0;

    if (selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID) {
        return item.currentQuantityCentral ?? 0;
    }

    let configId: string;
    if (selectedLocation.unitId) { 
      configId = `${item.id}_${selectedLocation.unitId}`;
    } else { 
      configId = `${item.id}_${selectedLocation.hospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
    }
    const config = stockConfigs.find(sc => sc.id === configId);
    return config?.currentQuantity ?? 0;
  };

  const isConsumptionAtSelectedUBSGeneralOrSpecific = useMemo(() => {
    if (!selectedLocation || selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID || isLoadingData) return false;
    const hospital = hospitals.find(h => h.id === selectedLocation.hospitalId);
    return hospital?.name.toLowerCase().includes('ubs') || false;
  }, [selectedLocation, hospitals, isLoadingData]);

  const filteredPatientsForSelectedUBS = useMemo(() => {
    if (!selectedLocation || !isConsumptionAtSelectedUBSGeneralOrSpecific || isLoadingData) return [];
    return patients.filter(p => p.registeredUBSId === selectedLocation.hospitalId);
  }, [selectedLocation, isConsumptionAtSelectedUBSGeneralOrSpecific, patients, isLoadingData]);


  if (isLoadingData && !currentUserProfile) { 
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Carregando dados e perfil...</p>
      </div>
    );
  }
  
  if (!currentUserProfile) {
     return <PageHeader title="Erro" description="Perfil do usuário não carregado. Faça login novamente." />;
  }

  const canUserSelectHospital = currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator';
  const canUserSelectUnit = canUserSelectHospital || (currentUserProfile.associatedHospitalId && !currentUserProfile.associatedUnitId);

  const isLocationSubmitButtonDisabled = 
    isLoadingData || 
    !locationForm.getValues('hospitalId') || 
    (
      locationForm.getValues('hospitalId') !== CENTRAL_WAREHOUSE_ID && 
      !locationForm.getValues('unitId') && // This now means unitId must be something (actual ID or placeholder)
      !(locationForm.getValues('hospitalId') && isSelectedHospitalUBS && locationForm.getValues('unitId') === GENERAL_STOCK_UNIT_ID_PLACEHOLDER) && // Allow if it's UBS general stock selected
      !(locationForm.getValues('hospitalId') && availableUnitsForSelection.length > 0 && locationForm.getValues('unitId')) // Allow if a specific unit is selected
    );


  return (
    <div className="container mx-auto py-2 max-w-2xl">
      <PageHeader
        title="Registrar Consumo de Item"
        description="Selecione o local e detalhe o consumo do item."
        icon={ShoppingCart}
      />

      {stage === 'selectLocation' && (
        <Card className="shadow-lg">
          <Form {...locationForm}>
            <form onSubmit={locationForm.handleSubmit(handleLocationSubmit)}>
              <CardHeader>
                <CardTitle className="font-headline text-xl">1. Selecione o Local do Consumo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={locationForm.control}
                  name="hospitalId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1"><Building className="h-4 w-4" /> Hospital/Local de Consumo</FormLabel>
                      <Select 
                        onValueChange={(value) => {
                          field.onChange(value);
                          locationForm.setValue('unitId', undefined); // Reset unit when hospital changes
                        }} 
                        value={field.value} 
                        disabled={!canUserSelectHospital || isLoadingData}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione o hospital/local" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {(currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator') && (
                            <SelectItem value={CENTRAL_WAREHOUSE_ID}>Almoxarifado Central (Consumo Direto)</SelectItem>
                          )}
                          {hospitals
                            .filter(h => canUserSelectHospital || h.id === currentUserProfile.associatedHospitalId)
                            .map(hospital => (
                            <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {watchedHospitalId && watchedHospitalId !== CENTRAL_WAREHOUSE_ID && (
                  <FormField
                    control={locationForm.control}
                    name="unitId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1"><MapPin className="h-4 w-4" /> Unidade Servida / Estoque</FormLabel>
                        <Select 
                          onValueChange={field.onChange} 
                          value={field.value} 
                          disabled={!canUserSelectUnit || isLoadingData || (availableUnitsForSelection.length === 0 && !isSelectedHospitalUBS)}
                        >
                          <FormControl><SelectTrigger>
                            <SelectValue placeholder={
                                !watchedHospitalId || watchedHospitalId === CENTRAL_WAREHOUSE_ID ? "Selecione um hospital primeiro" :
                                (availableUnitsForSelection.length > 0 || isSelectedHospitalUBS) ? "Selecione unidade ou Estoque Geral UBS" :
                                "Nenhuma unidade/opção para este hospital"
                            } />
                          </SelectTrigger></FormControl>
                          <SelectContent>
                            {isSelectedHospitalUBS && <SelectItem value={GENERAL_STOCK_UNIT_ID_PLACEHOLDER}>Estoque Geral da UBS</SelectItem>}
                            {availableUnitsForSelection
                                .filter(u => canUserSelectUnit || u.id === currentUserProfile.associatedUnitId)
                                .map(unit => (
                              <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>Se for uma UBS, pode ser "Estoque Geral da UBS". Se for um Hospital, selecione uma unidade.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </CardContent>
              <CardFooter>
                <Button type="submit" disabled={isLocationSubmitButtonDisabled}>
                  Prosseguir para Detalhes do Consumo
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
      )}

      {stage === 'fillForm' && selectedLocation && (
        <Card className="shadow-lg mt-6">
          <Form {...consumptionForm}>
            <form onSubmit={consumptionForm.handleSubmit(handleConsumptionSubmit)}>
              <CardHeader>
                <CardTitle className="font-headline text-xl">2. Detalhes do Consumo</CardTitle>
                <CardDescription>
                  Local: {selectedLocation.unitName} ({selectedLocation.hospitalName})<br/>
                  Operador: {currentUserProfile.name} ({currentUserProfile.role})
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={consumptionForm.control}
                  name="itemId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Item Consumido</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione um item" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {items.map(item => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} ({item.code}) - Disp.: {getDisplayStockForItemAtSelectedLocation(item)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                       <FormDescription>Apenas itens com estoque no local selecionado podem ser consumidos.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={consumptionForm.control}
                  name="quantityConsumed"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantidade Consumida</FormLabel>
                      <FormControl><Input type="number" placeholder="ex: 1" {...field} min="1"/></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={consumptionForm.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data do Consumo</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {isConsumptionAtSelectedUBSGeneralOrSpecific && (
                  <FormField
                    control={consumptionForm.control}
                    name="patientId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1"><User className="h-4 w-4" /> Paciente (Opcional)</FormLabel>
                        <Select
                          onValueChange={(value) => field.onChange(value === NO_PATIENT_ID ? undefined : value)}
                          value={field.value || NO_PATIENT_ID}
                        >
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione um paciente (se aplicável)" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value={NO_PATIENT_ID}>Nenhum paciente específico (consumo geral)</SelectItem>
                            {filteredPatientsForSelectedUBS.map(patient => (
                              <SelectItem key={patient.id} value={patient.id}>{patient.name} - SUS: {patient.susCardNumber}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={consumptionForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Observações (Opcional)</FormLabel>
                      <FormControl><Textarea placeholder="ex: Procedimento XYZ, Lote ABC" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter className="flex flex-col gap-3">
                <Button type="submit" className="w-full" disabled={isSubmittingConsumption}>
                  {isSubmittingConsumption && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                  Registrar Consumo
                </Button>
                <Button type="button" variant="outline" onClick={() => { setStage('selectLocation'); setSelectedLocation(null); consumptionForm.reset(); locationForm.reset(currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator' ? { hospitalId: currentUserProfile.associatedHospitalId, unitId: currentUserProfile.associatedUnitId } : {}); }} className="w-full">
                  Alterar Local
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
      )}
    </div>
  );
}
        
