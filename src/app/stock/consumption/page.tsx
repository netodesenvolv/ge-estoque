'use client';

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { ShoppingCart, User, Loader2, X } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient, StockMovement, UserProfile, StockItemConfig, User as AppUser, FirestoreStockConfig } from '@/types';
import { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, runTransaction, type DocumentSnapshot } from 'firebase/firestore';

// --- Constants ---
const CENTRAL_WAREHOUSE_ID = "__CENTRAL_WAREHOUSE__";
const GENERAL_STOCK_UNIT_ID_PLACEHOLDER = "__GENERAL_STOCK_UNIT__";
const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";
const NO_PATIENT_ID = "__NO_PATIENT__";
const LOADING_PLACEHOLDER = "__LOADING__";
const NO_UNITS_FOR_HOSPITAL_PLACEHOLDER = "__NO_UNITS_FOR_HOSPITAL__";


// --- Zod Schemas ---
const locationSelectionSchema = z.object({
  hospitalId: z.string().min(1, "Selecione o hospital/local de consumo."),
  unitId: z.string().optional(),
});

const consumptionItemSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  quantityConsumed: z.coerce.number().positive("A quantidade deve ser positiva."),
  notes: z.string().optional(),
});

const consumptionDetailsSchema = z.object({
  items: z.array(consumptionItemSchema).min(1, "Adicione pelo menos um item."),
  date: z.string().refine((d) => !isNaN(Date.parse(d)), { message: "Data inválida." }),
  patientId: z.string().optional(),
});

type LocationSelectionFormData = z.infer<typeof locationSelectionSchema>;
type ConsumptionDetailsFormData = z.infer<typeof consumptionDetailsSchema>;

// --- Component ---
export default function GeneralConsumptionPage() {
  const { toast } = useToast();
  const { currentUserProfile, user } = useAuth(); // Use 'user' for ID
  
  // Master Data States
  const [items, setItems] = useState<Item[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [stockConfigs, setStockConfigs] = useState<FirestoreStockConfig[]>([]);

  // UI/Flow Control States
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stage, setStage] = useState<'selectLocation' | 'fillForm'>('selectLocation');
  const [selectedLocation, setSelectedLocation] = useState<{
    hospitalId: string;
    unitId?: string;
    hospitalName: string;
    unitName: string;
  } | null>(null);

  const locationForm = useForm<LocationSelectionFormData>({ resolver: zodResolver(locationSelectionSchema) });
  const consumptionForm = useForm<ConsumptionDetailsFormData>({
    resolver: zodResolver(consumptionDetailsSchema),
    defaultValues: { items: [], date: new Date().toISOString().split('T')[0] },
  });
  const { fields, append, remove } = useFieldArray({ control: consumptionForm.control, name: "items" });

  useEffect(() => {
    let loadedCount = 0;
    const totalToLoad = 5;

    const createListener = (collectionName: string, q: any, setter: React.Dispatch<React.SetStateAction<any[]>>) => {
        return onSnapshot(q, (snapshot) => {
            setter(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
            if (++loadedCount >= totalToLoad) setIsLoadingData(false);
        }, (error) => {
            toast({ title: `Erro ao carregar ${collectionName}`, description: error.message, variant: "destructive" });
            if (++loadedCount >= totalToLoad) setIsLoadingData(false);
        });
    };

    const unsubscribers = [
        createListener("items", query(collection(firestore, "items"), orderBy("name")), setItems),
        createListener("patients", query(collection(firestore, "patients"), orderBy("name")), setPatients),
        createListener("hospitals", query(collection(firestore, "hospitals"), orderBy("name")), setHospitals),
        createListener("servedUnits", query(collection(firestore, "servedUnits"), orderBy("name")), setServedUnits),
        createListener("stockConfigs", query(collection(firestore, "stockConfigs")), setStockConfigs),
    ];

    return () => unsubscribers.forEach(unsub => unsub());
  }, [toast]);

  useEffect(() => {
    if (!isLoadingData && currentUserProfile) {
        if (currentUserProfile.associatedHospitalId) {
            locationForm.setValue('hospitalId', currentUserProfile.associatedHospitalId);
            if (currentUserProfile.associatedUnitId) {
                locationForm.setValue('unitId', currentUserProfile.associatedUnitId);
            }
        }
    }
  }, [currentUserProfile, isLoadingData, locationForm]);

  const watchedHospitalId = locationForm.watch('hospitalId');
  const watchedUnitId = locationForm.watch('unitId');
  
  const availableUnitsForSelection = useMemo(() => servedUnits.filter(u => u.hospitalId === watchedHospitalId), [watchedHospitalId, servedUnits]);
  const isSelectedHospitalUBS = useMemo(() => hospitals.find(h => h.id === watchedHospitalId)?.name.toLowerCase().includes('ubs'), [watchedHospitalId, hospitals]);
  const filteredPatientsForSelectedUBS = useMemo(() => {
    if (!selectedLocation || !selectedLocation.hospitalId || selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID) return [];
    return patients.filter(p => p.registeredUBSId === selectedLocation.hospitalId);
  }, [selectedLocation, patients]);


  const isLocationSubmitButtonDisabled = isLoadingData || !watchedHospitalId || (watchedHospitalId !== CENTRAL_WAREHOUSE_ID && !watchedUnitId);

  const handleLocationSubmit = (data: LocationSelectionFormData) => {
    const hospital = data.hospitalId === CENTRAL_WAREHOUSE_ID ? { id: CENTRAL_WAREHOUSE_ID, name: 'Almoxarifado Central' } : hospitals.find(h => h.id === data.hospitalId);
    if (!hospital) return toast({ title: "Hospital inválido", variant: "destructive" });

    let unitName = hospital.name;
    let unitIdForTx = data.unitId;

    if (data.hospitalId !== CENTRAL_WAREHOUSE_ID) {
        if (data.unitId === GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
            unitName = `Estoque Geral (${hospital.name})`;
            unitIdForTx = undefined; // Processed as undefined for transaction logic
        } else {
            const unit = servedUnits.find(u => u.id === data.unitId);
            if (!unit) return toast({ title: "Unidade inválida", variant: "destructive" });
            unitName = unit.name;
        }
    } else {
        unitIdForTx = undefined;
    }

    setSelectedLocation({ hospitalId: data.hospitalId, unitId: unitIdForTx, hospitalName: hospital.name, unitName });
    setStage('fillForm');
    consumptionForm.reset({ items: [{ itemId: '', quantityConsumed: 1, notes: '' }], date: new Date().toISOString().split('T')[0] });
  };

  const handleConsumptionSubmit = async (data: ConsumptionDetailsFormData) => {
    if (!currentUserProfile || !user || !selectedLocation) {
        toast({ title: "Dados de usuário ou local insuficientes", variant: "destructive" });
        return;
    }
    setIsSubmitting(true);
    const userWithId: AppUser = { ...currentUserProfile, id: user.uid };

    try {
        await runTransaction(firestore, async (transaction) => {
            // --- 1. READ PHASE ---
            const jobsToProcess: {
                formInput: (typeof data.items)[0];
                itemSnap: DocumentSnapshot<Item>;
                unitConfigSnap?: DocumentSnapshot<FirestoreStockConfig>;
                unitConfigDocId?: string;
            }[] = [];

            for (const itemData of data.items) {
                if (!itemData.itemId || itemData.quantityConsumed <= 0) continue;

                const itemDocRef = doc(firestore, "items", itemData.itemId);
                const itemSnap = await transaction.get(itemDocRef);
                if (!itemSnap.exists()) throw new Error(`Item com ID ${itemData.itemId} não encontrado.`);

                let unitConfigSnap: DocumentSnapshot<FirestoreStockConfig> | undefined = undefined;
                let unitConfigDocId: string | undefined = undefined;

                if (selectedLocation.hospitalId !== CENTRAL_WAREHOUSE_ID) {
                    unitConfigDocId = selectedLocation.unitId
                        ? `${itemData.itemId}_${selectedLocation.unitId}`
                        : `${itemData.itemId}_${selectedLocation.hospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
                    const unitConfigDocRef = doc(firestore, "stockConfigs", unitConfigDocId);
                    unitConfigSnap = await transaction.get(unitConfigDocRef);
                }
                
                jobsToProcess.push({ formInput: itemData, itemSnap, unitConfigSnap, unitConfigDocId });
            }

            // --- 2. VALIDATION PHASE ---
            for (const job of jobsToProcess) {
                const currentItemData = job.itemSnap.data()!;
                const quantityToConsume = job.formInput.quantityConsumed;

                if (selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID) {
                    if ((currentItemData.currentQuantityCentral ?? 0) < quantityToConsume) {
                        throw new Error(`Estoque insuficiente no Almoxarifado Central para ${currentItemData.name}. Disponível: ${currentItemData.currentQuantityCentral}, Necessário: ${quantityToConsume}.`);
                    }
                } else {
                    if (!job.unitConfigSnap?.exists()) {
                        throw new Error(`Configuração de estoque não encontrada para ${currentItemData.name} em ${selectedLocation.unitName}. O estoque pode não ter sido transferido.`);
                    }
                    const currentUnitQty = job.unitConfigSnap.data()?.currentQuantity ?? 0;
                    if (currentUnitQty < quantityToConsume) {
                        throw new Error(`Estoque insuficiente (${currentUnitQty}) em ${selectedLocation.unitName} para ${currentItemData.name}. Necessário: ${quantityToConsume}.`);
                    }
                }
            }

            // --- 3. WRITE PHASE ---
            for (const job of jobsToProcess) {
                const currentItemData = job.itemSnap.data()!;
                const quantityToConsume = job.formInput.quantityConsumed;

                // A. Update Stock Level
                if (selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID) {
                    const newQuantity = (currentItemData.currentQuantityCentral ?? 0) - quantityToConsume;
                    transaction.update(job.itemSnap.ref, { currentQuantityCentral: newQuantity });
                } else {
                    const unitConfigDocRef = doc(firestore, "stockConfigs", job.unitConfigDocId!);
                    const currentUnitQty = job.unitConfigSnap!.data()!.currentQuantity ?? 0;
                    const newQuantity = currentUnitQty - quantityToConsume;
                    transaction.update(unitConfigDocRef, { currentQuantity: newQuantity });
                }

                // B. Create Movement Log
                const patientDetails = data.patientId && data.patientId !== NO_PATIENT_ID ? patients.find(p => p.id === data.patientId) : null;
                const newMovementRef = doc(collection(firestore, "stockMovements"));
                
                const movementLog: Omit<StockMovement, 'id'> = {
                    itemId: job.formInput.itemId,
                    itemName: currentItemData.name,
                    type: 'consumption',
                    quantity: quantityToConsume,
                    date: data.date,
                    hospitalId: selectedLocation.hospitalId !== CENTRAL_WAREHOUSE_ID ? selectedLocation.hospitalId : null,
                    hospitalName: selectedLocation.hospitalId !== CENTRAL_WAREHOUSE_ID ? selectedLocation.hospitalName : null,
                    unitId: selectedLocation.unitId,
                    unitName: selectedLocation.unitName,
                    patientId: patientDetails?.id,
                    patientName: patientDetails?.name,
                    notes: job.formInput.notes || null,
                    userId: userWithId.id,
                    userDisplayName: userWithId.name,
                };

                 Object.keys(movementLog).forEach(
                    key => (movementLog as any)[key] === undefined && delete (movementLog as any)[key]
                );
                 Object.keys(movementLog).forEach(
                    key => (movementLog as any)[key] === null && delete (movementLog as any)[key]
                );

                transaction.set(newMovementRef, movementLog);
            }
        });

        toast({ title: "Consumo Registrado com Sucesso!" });
        setSelectedLocation(null);
        setStage('selectLocation');
        locationForm.reset();
        consumptionForm.reset();

    } catch (error: any) {
      console.error("Erro ao registrar consumo:", error);
      toast({ title: "Erro ao registrar consumo", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getDisplayStockForItemAtSelectedLocation = (itemId: string): number | string => {
    if (!selectedLocation || !itemId) return 'N/A';
    
    if (selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID) {
        return items.find(i => i.id === itemId)?.currentQuantityCentral ?? 0;
    }
    
    const configId = selectedLocation.unitId
      ? `${itemId}_${selectedLocation.unitId}`
      : `${itemId}_${selectedLocation.hospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
      
    return stockConfigs.find(sc => sc.id === configId)?.currentQuantity ?? 0;
  };

  if (isLoadingData) return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>;

  return (
    <div className="container max-w-2xl mx-auto py-4">
      <PageHeader title="Registrar Consumo" icon={ShoppingCart} />
      
      {stage === 'selectLocation' && (
        <Card>
          <Form {...locationForm}>
            <form onSubmit={locationForm.handleSubmit(handleLocationSubmit)}>
              <CardHeader>
                  <CardTitle>1. Selecione o Local do Consumo</CardTitle>
                  <CardDescription>Indique de onde o item foi consumido.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField name="hospitalId" control={locationForm.control} render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hospital / Almoxarifado</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!!currentUserProfile?.associatedHospitalId}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {(currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator') && <SelectItem value={CENTRAL_WAREHOUSE_ID}>Almoxarifado Central</SelectItem>}
                        {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                {watchedHospitalId && watchedHospitalId !== CENTRAL_WAREHOUSE_ID && (
                  <FormField name="unitId" control={locationForm.control} render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unidade Servida / Estoque Geral</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={!!currentUserProfile?.associatedUnitId}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione a unidade..." /></SelectTrigger></FormControl>
                        <SelectContent>
                            {isLoadingData && <SelectItem value={LOADING_PLACEHOLDER} disabled>Carregando...</SelectItem>}
                            {!isLoadingData && availableUnitsForSelection.length === 0 && !isSelectedHospitalUBS && <SelectItem value={NO_UNITS_FOR_HOSPITAL_PLACEHOLDER} disabled>Nenhuma unidade para este hospital</SelectItem>}
                            {isSelectedHospitalUBS && <SelectItem value={GENERAL_STOCK_UNIT_ID_PLACEHOLDER} key={`key-${GENERAL_STOCK_UNIT_ID_PLACEHOLDER}`}>Estoque Geral da UBS</SelectItem>}
                            {availableUnitsForSelection.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                       <FormDescription>Selecione a unidade específica ou o estoque geral da UBS.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
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
        <Card>
          <Form {...consumptionForm}>
            <form onSubmit={consumptionForm.handleSubmit(handleConsumptionSubmit)}>
              <CardHeader>
                <CardTitle>2. Detalhes do Consumo</CardTitle>
                <CardDescription>Local: <span className="font-semibold">{selectedLocation.unitName}</span></CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  {fields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-[1fr_auto_auto] items-start gap-2 mb-2 p-2 border rounded-md">
                      <FormField name={`items.${index}.itemId`} control={consumptionForm.control} render={({ field }) => (
                          <FormItem>
                            <FormLabel className="sr-only">Item</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Selecione o item" /></SelectTrigger></FormControl><SelectContent>{items.map(item => <SelectItem key={item.id} value={item.id}>{item.name} (Disp: {getDisplayStockForItemAtSelectedLocation(item.id)})</SelectItem>)}</SelectContent></Select>
                            <FormMessage />
                          </FormItem>
                      )} />
                      <FormField name={`items.${index}.quantityConsumed`} control={consumptionForm.control} render={({ field }) => 
                        <FormItem><FormLabel className="sr-only">Quantidade</FormLabel><FormControl><Input type="number" placeholder="Qtd" {...field} className="w-24" /></FormControl><FormMessage /></FormItem>} />
                      <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="mt-0"><X className="h-4 w-4" /></Button>
                    </div>))}
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ itemId: '', quantityConsumed: 1, notes: '' })} className="mt-2">Adicionar Item</Button>
                </div>
                <FormField name="date" control={consumptionForm.control} render={({ field }) => <FormItem><FormLabel>Data</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>} />
                {selectedLocation.hospitalId !== CENTRAL_WAREHOUSE_ID && isSelectedHospitalUBS && (
                  <FormField name="patientId" control={consumptionForm.control} render={({ field }) => (
                    <FormItem><FormLabel>Paciente (Opcional)</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl><SelectContent><SelectItem value={NO_PATIENT_ID}>Nenhum (consumo geral da unidade)</SelectItem>{filteredPatientsForSelectedUBS.map(p => <SelectItem key={p.id} value={p.id}>{p.name} - {p.susCardNumber}</SelectItem>)}</SelectContent></Select></FormItem>
                  )} />
                )}
                <FormField
                    control={consumptionForm.control}
                    name="items.0.notes" // This is a bit of a hack, assumes notes are general
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Observações Gerais (Opcional)</FormLabel>
                        <FormControl>
                        <Textarea placeholder="Observações sobre o consumo (lote, motivo, etc.)" {...field} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
              </CardContent>
              <CardFooter className="flex justify-between">
                <Button type="button" variant="ghost" onClick={() => { setStage('selectLocation'); setSelectedLocation(null); }}>Voltar</Button>
                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : 'Registrar Consumo'}</Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
      )}
    </div>
  );
}
