
'use client';

import { useForm } from 'react-hook-form';
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
import { collection, query, orderBy, onSnapshot, doc, runTransaction, type FirestoreError } from 'firebase/firestore';
import { processMovementRowTransaction } from '@/app/stock/movements/page';

// --- Constants ---
const NO_PATIENT_ID = "__NO_PATIENT__";
const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";
const GENERAL_STOCK_UNIT_ID_PLACEHOLDER = "__GENERAL_STOCK_UNIT__";
const CENTRAL_WAREHOUSE_ID = "__CENTRAL_WAREHOUSE__";
const LOADING_PLACEHOLDER = "__LOADING_PLACEHOLDER__";

// --- Zod Schemas ---
const locationSelectionSchema = z.object({
  hospitalId: z.string().min(1, "Selecione o hospital/local de consumo."),
  unitId: z.string().optional(), // Optional because Central Warehouse or General UBS Stock might not use a specific unitId from servedUnits
});

const consumptionDetailsSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  quantityConsumed: z.coerce.number().positive("A quantidade consumida deve ser um número positivo."),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  patientId: z.string().optional(),
  notes: z.string().optional(),
});

type LocationSelectionFormData = z.infer<typeof locationSelectionSchema>;
type ConsumptionDetailsFormData = z.infer<typeof consumptionDetailsSchema>;

// --- Component ---
export default function GeneralConsumptionPage() {
  const { toast } = useToast();
  const { currentUserProfile, user: firebaseUser } = useAuth();

  // --- State for Data Collections ---
  const [items, setItems] = useState<Item[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [stockConfigs, setStockConfigs] = useState<FirestoreStockConfig[]>([]);

  // --- Loading and Form Stage State ---
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSubmittingConsumption, setIsSubmittingConsumption] = useState(false);
  const [stage, setStage] = useState<'selectLocation' | 'fillForm'>('selectLocation');
  const [selectedLocation, setSelectedLocation] = useState<{
    hospitalId: string; // Can be CENTRAL_WAREHOUSE_ID
    unitId?: string;   // Can be GENERAL_STOCK_UNIT_ID_PLACEHOLDER or specific unit ID
    hospitalName: string;
    unitName: string;   // Display name for the unit/location
  } | null>(null);

  // --- Forms ---
  const locationForm = useForm<LocationSelectionFormData>({
    resolver: zodResolver(locationSelectionSchema),
    defaultValues: { hospitalId: undefined, unitId: undefined },
  });
  const consumptionForm = useForm<ConsumptionDetailsFormData>({
    resolver: zodResolver(consumptionDetailsSchema),
    defaultValues: {
      itemId: undefined,
      quantityConsumed: 1,
      date: new Date().toISOString().split('T')[0],
      patientId: undefined,
      notes: '',
    },
  });

  // --- Data Fetching Effect ---
  useEffect(() => {
    setIsLoadingData(true);
    const dataSources = [
      { name: "items", query: query(collection(firestore, "items"), orderBy("name", "asc")), setter: setItems },
      { name: "patients", query: query(collection(firestore, "patients"), orderBy("name", "asc")), setter: setPatients },
      { name: "hospitals", query: query(collection(firestore, "hospitals"), orderBy("name", "asc")), setter: setHospitals },
      { name: "servedUnits", query: query(collection(firestore, "servedUnits"), orderBy("name", "asc")), setter: setServedUnits },
      { name: "stockConfigs", query: query(collection(firestore, "stockConfigs")), setter: setStockConfigs },
    ];

    let loadedCount = 0;
    const unsubscribers = dataSources.map(source =>
      onSnapshot(source.query,
        snapshot => {
          source.setter(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
          loadedCount++;
          if (loadedCount === dataSources.length) setIsLoadingData(false);
        },
        (error: FirestoreError) => {
          console.error(`Error loading ${source.name}:`, error);
          toast({
            title: `Erro ao Carregar ${source.name.charAt(0).toUpperCase() + source.name.slice(1)}`,
            description: `Permissão negada ou erro de rede. Verifique suas regras do Firestore e a conexão. Detalhes: ${error.message}`,
            variant: "destructive",
            duration: 10000,
          });
          loadedCount++;
          if (loadedCount === dataSources.length) setIsLoadingData(false);
        }
      )
    );
    return () => unsubscribers.forEach(unsub => unsub());
  }, [toast]);

  // --- User Profile Based Form Pre-filling ---
  useEffect(() => {
    if (!currentUserProfile || isLoadingData) return;

    const { role, associatedHospitalId, associatedUnitId } = currentUserProfile;

    if ((role === 'hospital_operator' || role === 'ubs_operator') && associatedHospitalId) {
      if (locationForm.getValues('hospitalId') !== associatedHospitalId) {
        locationForm.setValue('hospitalId', associatedHospitalId, { shouldValidate: true });
        // Reset unitId if hospital is pre-filled, unless user also has specific unit
        locationForm.setValue('unitId', associatedUnitId || undefined, { shouldValidate: true });
      } else if (associatedUnitId && locationForm.getValues('unitId') !== associatedUnitId) {
        locationForm.setValue('unitId', associatedUnitId, { shouldValidate: true });
      }
    }
  }, [currentUserProfile, isLoadingData, locationForm]);

  // --- Watched Form Values ---
  const watchedHospitalId = locationForm.watch('hospitalId');
  const watchedUnitId = locationForm.watch('unitId'); // For location form's unitId

  // --- Reset Unit Selection when Hospital Changes ---
  useEffect(() => {
    const { hospitalId_prev_for_unit_reset } = locationForm.getValues() as any; // Temp store
    if (watchedHospitalId && watchedHospitalId !== hospitalId_prev_for_unit_reset) {
        if (currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator' ||
           ((currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator') && !currentUserProfile.associatedUnitId)) {
             locationForm.setValue('unitId', undefined, { shouldValidate: true });
        }
        (locationForm as any).setValue('hospitalId_prev_for_unit_reset', watchedHospitalId, { shouldValidate: false });
    }
  }, [watchedHospitalId, locationForm, currentUserProfile]);


  // --- Memoized Derived Data for Selects ---
  const availableUnitsForSelection = useMemo(() => {
    if (!watchedHospitalId || watchedHospitalId === CENTRAL_WAREHOUSE_ID || isLoadingData) return [];
    return servedUnits.filter(unit => unit.hospitalId === watchedHospitalId);
  }, [watchedHospitalId, servedUnits, isLoadingData]);

  const selectedHospitalDetails = useMemo(() => {
    if (isLoadingData || !watchedHospitalId || watchedHospitalId === CENTRAL_WAREHOUSE_ID) return null;
    return hospitals.find(h => h.id === watchedHospitalId);
  }, [watchedHospitalId, hospitals, isLoadingData]);

  const isSelectedHospitalUBS = selectedHospitalDetails?.name.toLowerCase().includes('ubs') || false;

  const filteredPatientsForSelectedUBS = useMemo(() => {
    if (!selectedLocation || !selectedLocation.hospitalId || selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID || isLoadingData) return [];
    const actualHospitalId = selectedLocation.hospitalId; // Not CENTRAL_WAREHOUSE_ID
    const hospital = hospitals.find(h => h.id === actualHospitalId);
    if (!hospital?.name.toLowerCase().includes('ubs')) return []; // Only filter for UBS context

    return patients.filter(p => p.registeredUBSId === actualHospitalId);
  }, [selectedLocation, patients, hospitals, isLoadingData]);

  // --- Permission Checks ---
  const canUserSelectHospital = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator';
  const canUserSelectUnit =
    currentUserProfile?.role === 'admin' ||
    currentUserProfile?.role === 'central_operator' ||
    ((currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator') && !currentUserProfile.associatedUnitId);

  // --- Button Enablement Logic ---
  const isLocationSubmitButtonDisabled = useMemo(() => {
    if (isLoadingData) return true;
    if (!watchedHospitalId) return true;
    if (watchedHospitalId !== CENTRAL_WAREHOUSE_ID && !watchedUnitId) return true; // Must select unit or "General Stock" for non-central
    return false;
  }, [isLoadingData, watchedHospitalId, watchedUnitId]);


  // --- Event Handlers ---
  const handleLocationSubmit = (data: LocationSelectionFormData) => {
    const hospital = data.hospitalId === CENTRAL_WAREHOUSE_ID
      ? { id: CENTRAL_WAREHOUSE_ID, name: 'Almoxarifado Central' }
      : hospitals.find(h => h.id === data.hospitalId);

    if (!hospital) {
      toast({ title: "Erro", description: "Hospital selecionado inválido.", variant: "destructive" });
      return;
    }

    let unitNameDisplay = hospital.name; // Default to hospital name (e.g. for Central Warehouse)
    let actualUnitIdForTransaction = data.unitId;

    if (data.hospitalId !== CENTRAL_WAREHOUSE_ID) {
      if (data.unitId === GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
        unitNameDisplay = `Estoque Geral (${hospital.name})`;
        actualUnitIdForTransaction = undefined; // General stock has no specific unitId
      } else if (data.unitId) {
        const unit = servedUnits.find(u => u.id === data.unitId);
        if (!unit) {
          toast({ title: "Erro", description: "Unidade servida selecionada inválida.", variant: "destructive" });
          return;
        }
        unitNameDisplay = unit.name;
      } else {
         // This case should be prevented by isLocationSubmitButtonDisabled
        toast({ title: "Seleção Incompleta", description: "Para hospitais/UBS (não Almox. Central), uma unidade ou 'Estoque Geral' deve ser selecionado.", variant: "destructive" });
        return;
      }
    }


    setSelectedLocation({
      hospitalId: data.hospitalId,
      unitId: actualUnitIdForTransaction,
      hospitalName: hospital.name,
      unitName: unitNameDisplay,
    });
    setStage('fillForm');
    consumptionForm.reset(); // Reset consumption details form
  };

  const handleConsumptionSubmit = async (data: ConsumptionDetailsFormData) => {
    if (!currentUserProfile || !firebaseUser || !selectedLocation) {
      toast({ title: "Erro", description: "Dados de localização, usuário ou item insuficientes.", variant: "destructive" });
      return;
    }
    setIsSubmittingConsumption(true);

    const itemForRow = items.find(i => i.id === data.itemId);
    if (!itemForRow) {
      toast({ title: "Erro", description: "Item selecionado não encontrado.", variant: "destructive" });
      setIsSubmittingConsumption(false);
      return;
    }

    // Prepare movement data for the transaction function
    const movementDataForTransaction: Omit<StockMovement, 'id' | 'itemName' | 'hospitalName' | 'unitName' | 'patientName' | 'userDisplayName' | 'userId'> & { itemId: string } = {
      itemId: data.itemId,
      type: 'consumption',
      quantity: data.quantityConsumed,
      date: data.date,
      hospitalId: selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID ? undefined : selectedLocation.hospitalId,
      unitId: selectedLocation.unitId, // This is already correctly undefined for General Stock / Central
      patientId: data.patientId === NO_PATIENT_ID ? undefined : data.patientId,
      notes: data.notes,
    };
    
    // --- START DIAGNOSTIC LOGGING (Client-side) ---
    console.groupCollapsed("--- Firestore Transaction: Consumption Attempt (Client Diagnostics) ---");
    console.log("Current User Profile (from AuthContext):", JSON.parse(JSON.stringify(currentUserProfile)));
    console.log("Selected Location for Consumption (state):", JSON.parse(JSON.stringify(selectedLocation)));
    console.log("Consumption Form Data (raw form values):", JSON.parse(JSON.stringify(data)));
    console.log("Movement Data to be sent to Transaction:", JSON.parse(JSON.stringify(movementDataForTransaction)));
    
    let targetStockConfigId = "N/A (Error or Central Warehouse direct)";
    if (selectedLocation.hospitalId !== CENTRAL_WAREHOUSE_ID) {
        if (selectedLocation.unitId) { // Specific unit
            targetStockConfigId = `${data.itemId}_${selectedLocation.unitId}`;
        } else if (selectedLocation.hospitalId) { // General UBS stock (unitId is undefined here)
            const isTargetHospitalUBS = hospitals.find(h => h.id === selectedLocation.hospitalId)?.name.toLowerCase().includes('ubs');
            if (isTargetHospitalUBS) {
                 targetStockConfigId = `${data.itemId}_${selectedLocation.hospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
            } else {
                targetStockConfigId = "Error: Non-UBS hospital selected without a specific unit for consumption from unit stock.";
            }
        }
    } else { // Consumption from Central Warehouse
       // No specific stockConfig for central in this context, item.currentQuantityCentral is used directly.
       targetStockConfigId = `Direct from Central Warehouse (item: ${data.itemId})`;
    }
    console.log("Target stockConfigs Document ID for Update (calculated):", targetStockConfigId);
    const targetStockConfigData = stockConfigs.find(sc => sc.id === targetStockConfigId);
    console.log("Data of Target stockConfigs Document (if found):", targetStockConfigData ? JSON.parse(JSON.stringify(targetStockConfigData)) : "Not found or not applicable (e.g. Central Warehouse direct)");
    console.groupEnd();
    // --- END DIAGNOSTIC LOGGING ---

    try {
      await runTransaction(firestore, (transaction) =>
        processMovementRowTransaction(
          transaction,
          movementDataForTransaction,
          currentUserProfile,
          items, hospitals, servedUnits, patients
        )
      );

      toast({
        title: "Consumo Registrado com Sucesso!",
        description: `${data.quantityConsumed} x ${itemForRow.name} em ${selectedLocation.unitName}.`,
        action: <CheckCircle className="text-green-500" />,
      });
      consumptionForm.reset(); // Reset only consumption details
      // Optionally, could reset stage to 'selectLocation' or keep for more consumption at same location
      // setStage('selectLocation');
      // setSelectedLocation(null);
    } catch (error: any) {
      console.error('Erro ao registrar consumo:', error);
      toast({
        title: "Erro ao Registrar Consumo",
        description: error.message || "Não foi possível concluir a operação. Verifique o console para mais detalhes.",
        variant: "destructive",
        duration: 10000,
      });
    } finally {
      setIsSubmittingConsumption(false);
    }
  };

  const getDisplayStockForItemAtSelectedLocation = (item: Item): number | string => {
    if (!selectedLocation || isLoadingData) return 'N/A';

    if (selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID) {
      return item.currentQuantityCentral ?? 0;
    }

    let configId: string;
    if (selectedLocation.unitId) { // Specific unit selected
      configId = `${item.id}_${selectedLocation.unitId}`;
    } else { // Implies general stock for a UBS (selectedLocation.unitId is undefined here)
      configId = `${item.id}_${selectedLocation.hospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
    }
    const config = stockConfigs.find(sc => sc.id === configId);
    return config?.currentQuantity ?? 0;
  };


  const isConsumptionForPatientPossible = useMemo(() => {
    if (!selectedLocation || selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID || isLoadingData) return false;
    const hospital = hospitals.find(h => h.id === selectedLocation.hospitalId);
    // Patient selection is relevant if consuming from a UBS (either general stock or specific unit within UBS)
    return hospital?.name.toLowerCase().includes('ubs') || false;
  }, [selectedLocation, hospitals, isLoadingData]);


  // --- Render Logic ---
  if (isLoadingData && !currentUserProfile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Carregando dados e perfil do usuário...</p>
      </div>
    );
  }
  if (!currentUserProfile) {
    return <PageHeader title="Erro" description="Perfil do usuário não carregado. Faça login novamente." />;
  }

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
                <CardDescription>Operador: {currentUserProfile.name} ({currentUserProfile.role})</CardDescription>
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
                           // Reset unitId by useEffect watching watchedHospitalId
                        }}
                        value={field.value}
                        disabled={!canUserSelectHospital || isLoadingData}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione o hospital/local" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {isLoadingData && <SelectItem value={LOADING_PLACEHOLDER} disabled>Carregando...</SelectItem>}
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
                          value={field.value || ""}
                          disabled={!canUserSelectUnit || isLoadingData || (availableUnitsForSelection.length === 0 && !isSelectedHospitalUBS)}
                        >
                          <FormControl><SelectTrigger>
                            <SelectValue placeholder={
                                isLoadingData ? "Carregando..." :
                                !watchedHospitalId || watchedHospitalId === CENTRAL_WAREHOUSE_ID ? "Selecione um hospital primeiro" :
                                (availableUnitsForSelection.length > 0 || isSelectedHospitalUBS) ? "Selecione unidade ou Estoque Geral UBS" :
                                "Nenhuma unidade/opção para este hospital"
                            } />
                          </SelectTrigger></FormControl>
                          <SelectContent>
                            {isLoadingData && <SelectItem value={LOADING_PLACEHOLDER} disabled>Carregando...</SelectItem>}
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
                  {isLoadingData && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Prosseguir para Detalhes
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
                  Local: {selectedLocation.unitName} ({selectedLocation.hospitalName})
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
                        <SelectContent className="max-h-72"> {/* Limit height for very long lists */}
                          {isLoadingData && <SelectItem value={LOADING_PLACEHOLDER} disabled>Carregando itens...</SelectItem>}
                          {items.map(item => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} ({item.code}) - Disp.: {getDisplayStockForItemAtSelectedLocation(item)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>O estoque disponível é referente ao local selecionado.</FormDescription>
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
                {isConsumptionForPatientPossible && (
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
                          <SelectContent className="max-h-72">
                             <SelectItem value={NO_PATIENT_ID}>Nenhum paciente específico (consumo geral)</SelectItem>
                            {isLoadingData && <SelectItem value={LOADING_PLACEHOLDER} disabled>Carregando pacientes...</SelectItem>}
                            {filteredPatientsForSelectedUBS.map(patient => (
                              <SelectItem key={patient.id} value={patient.id}>{patient.name} - SUS: {patient.susCardNumber}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>Apenas pacientes associados à UBS selecionada são listados.</FormDescription>
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
              <CardFooter className="flex flex-col sm:flex-row gap-3 sm:justify-between">
                <Button type="button" variant="outline" onClick={() => { setStage('selectLocation'); setSelectedLocation(null); consumptionForm.reset(); locationForm.reset(
                  (currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator') && currentUserProfile.associatedHospitalId
                    ? { hospitalId: currentUserProfile.associatedHospitalId, unitId: currentUserProfile.associatedUnitId || undefined }
                    : { hospitalId: undefined, unitId: undefined }
                );}}>
                  Alterar Local
                </Button>
                <Button type="submit" className="w-full sm:w-auto" disabled={isSubmittingConsumption}>
                  {isSubmittingConsumption && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                  Registrar Consumo
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
      )}
    </div>
  );
}
