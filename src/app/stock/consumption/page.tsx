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
import { ShoppingCart, User, Loader2, X, Search } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient, StockMovement, UserProfile, StockItemConfig as FirestoreStockConfig, User as AppUser } from '@/types';
import { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, runTransaction, type DocumentSnapshot, where, getDocs, limit } from 'firebase/firestore';

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
});

type LocationSelectionFormData = z.infer<typeof locationSelectionSchema>;
type ConsumptionDetailsFormData = z.infer<typeof consumptionDetailsSchema>;

// --- Component ---
export default function GeneralConsumptionPage() {
  const { toast } = useToast();
  const { currentUserProfile, user } = useAuth();
  
  // Master Data States
  const [items, setItems] = useState<Item[]>([]);
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

  // Patient Search State
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [patientSearchResults, setPatientSearchResults] = useState<Patient[]>([]);
  const [isSearchingPatient, setIsSearchingPatient] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);


  const locationForm = useForm<LocationSelectionFormData>({
    resolver: zodResolver(locationSelectionSchema),
    defaultValues: { hospitalId: '', unitId: '' }
  });
  const consumptionForm = useForm<ConsumptionDetailsFormData>({
    resolver: zodResolver(consumptionDetailsSchema),
    defaultValues: { items: [], date: new Date().toISOString().split('T')[0] },
  });
  const { fields, append, remove } = useFieldArray({ control: consumptionForm.control, name: "items" });

  useEffect(() => {
    let loadedCount = 0;
    const sourcesToLoad = ["items", "hospitals", "servedUnits", "stockConfigs"];
    
    const checkAllLoaded = () => {
        if(loadedCount >= sourcesToLoad.length){
            setIsLoadingData(false);
        }
    };

    const createListener = (collectionName: string, q: any, setter: React.Dispatch<React.SetStateAction<any[]>>, sourceKey: string) => {
      return onSnapshot(q, (snapshot) => {
        setter(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
        loadedCount++;
        checkAllLoaded();
      }, (error) => {
        toast({ title: `Erro ao carregar ${collectionName}`, description: `Verifique as permissões do Firestore. Detalhe: ${error.message}`, variant: "destructive" });
        loadedCount++;
        checkAllLoaded();
      });
    };

    const unsubscribers = [
      createListener("items", query(collection(firestore, "items"), orderBy("name")), setItems, "items"),
      createListener("hospitals", query(collection(firestore, "hospitals"), orderBy("name")), setHospitals, "hospitals"),
      createListener("servedUnits", query(collection(firestore, "servedUnits"), orderBy("name")), setServedUnits, "servedUnits"),
      createListener("stockConfigs", query(collection(firestore, "stockConfigs")), setStockConfigs, "stockConfigs"),
    ];

    return () => unsubscribers.forEach(unsub => unsub());
  }, [toast]);

  useEffect(() => {
    if (!isLoadingData && currentUserProfile) {
      locationForm.reset({
          hospitalId: currentUserProfile.associatedHospitalId,
          unitId: currentUserProfile.associatedUnitId,
      });
    }
  }, [currentUserProfile, isLoadingData, locationForm]);

  const watchedHospitalId = locationForm.watch('hospitalId');
  
  const availableUnitsForSelection = useMemo(() => {
      if (!watchedHospitalId) return [];
      return servedUnits.filter(u => u.hospitalId === watchedHospitalId)
  }, [watchedHospitalId, servedUnits]);

  const isSelectedHospitalUBS = useMemo(() => {
      if (!watchedHospitalId) return false;
      return hospitals.find(h => h.id === watchedHospitalId)?.name.toLowerCase().includes('ubs') || false;
  }, [watchedHospitalId, hospitals]);

  const handleLocationSubmit = (data: LocationSelectionFormData) => {
    const hospital = data.hospitalId === CENTRAL_WAREHOUSE_ID ? { id: CENTRAL_WAREHOUSE_ID, name: 'Almoxarifado Central' } : hospitals.find(h => h.id === data.hospitalId);
    if (!hospital) return toast({ title: "Hospital inválido", variant: "destructive" });

    let unitName = hospital.name;
    let unitIdForTx = data.unitId;

    if (data.hospitalId !== CENTRAL_WAREHOUSE_ID) {
        if (data.unitId === GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
            unitName = `Estoque Geral (${hospital.name})`;
            unitIdForTx = undefined; 
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
    setSelectedPatient(null);
    setPatientSearchTerm('');
  };

  const handlePatientSearch = async () => {
    if (patientSearchTerm.trim().length < 3) {
      toast({ title: "Busca Inválida", description: "Por favor, digite pelo menos 3 caracteres para buscar." });
      return;
    }
    setIsSearchingPatient(true);
    setPatientSearchResults([]);

    try {
      const patientsRef = collection(firestore, "patients");
      const queries = [];

      if (/^\d+$/.test(patientSearchTerm)) {
        queries.push(getDocs(query(patientsRef, where("susCardNumber", "==", patientSearchTerm))));
      }
      
      const nameQuery = query(patientsRef, where("name", ">=", patientSearchTerm.toUpperCase()), where("name", "<=", patientSearchTerm.toUpperCase() + '\uf8ff'), limit(10));
      queries.push(getDocs(nameQuery));

      const snapshots = await Promise.all(queries);
      const results: { [id: string]: Patient } = {};
      snapshots.forEach(snapshot => {
        snapshot.docs.forEach(doc => {
          results[doc.id] = { id: doc.id, ...doc.data() } as Patient;
        });
      });
      
      const uniqueResults = Object.values(results);
      setPatientSearchResults(uniqueResults);
      if (uniqueResults.length === 0) {
        toast({ title: "Nenhum Paciente Encontrado" });
      }

    } catch (error) {
      console.error("Erro ao buscar pacientes: ", error);
      toast({ title: "Erro na Busca por Pacientes", variant: "destructive" });
    } finally {
      setIsSearchingPatient(false);
    }
  };

  const handleSelectPatient = (patient: Patient) => {
    setSelectedPatient(patient);
    setPatientSearchTerm(patient.name);
    setPatientSearchResults([]);
  };

  const handleClearPatientSelection = () => {
    setSelectedPatient(null);
    setPatientSearchTerm('');
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
            const jobsToProcess: {
                formInput: (typeof data.items)[0];
                itemSnap: DocumentSnapshot<Item>;
                unitConfigSnap?: DocumentSnapshot<FirestoreStockConfig>;
                unitConfigDocId?: string;
            }[] = [];

            // 1. Read Phase
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
            
            // 2. Validation Phase
            for (const job of jobsToProcess) {
                const currentItemData = job.itemSnap.data()!;
                const quantityToConsume = job.formInput.quantityConsumed;

                if (selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID) {
                    if ((currentItemData.currentQuantityCentral ?? 0) < quantityToConsume) {
                        throw new Error(`Estoque insuficiente no Almoxarifado Central para ${currentItemData.name}. Disponível: ${currentItemData.currentQuantityCentral ?? 0}, Necessário: ${quantityToConsume}.`);
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

            // 3. Write Phase
            for (const job of jobsToProcess) {
                const currentItemData = job.itemSnap.data()!;
                const quantityToConsume = job.formInput.quantityConsumed;

                if (selectedLocation.hospitalId === CENTRAL_WAREHOUSE_ID) {
                    const newQuantity = (currentItemData.currentQuantityCentral ?? 0) - quantityToConsume;
                    transaction.update(job.itemSnap.ref, { currentQuantityCentral: newQuantity });
                } else {
                    const unitConfigDocRef = doc(firestore, "stockConfigs", job.unitConfigDocId!);
                    const currentUnitQty = job.unitConfigSnap!.data()!.currentQuantity ?? 0;
                    const newQuantity = currentUnitQty - quantityToConsume;
                    transaction.update(unitConfigDocRef, { currentQuantity: newQuantity });
                }

                const newMovementRef = doc(collection(firestore, "stockMovements"));
                
                const movementLog: Partial<Omit<StockMovement, 'id'>> = {
                    itemId: job.formInput.itemId,
                    itemName: currentItemData.name,
                    type: 'consumption',
                    quantity: quantityToConsume,
                    date: data.date,
                    hospitalId: selectedLocation.hospitalId !== CENTRAL_WAREHOUSE_ID ? selectedLocation.hospitalId : null,
                    hospitalName: selectedLocation.hospitalId !== CENTRAL_WAREHOUSE_ID ? selectedLocation.hospitalName : null,
                    unitId: selectedLocation.unitId,
                    unitName: selectedLocation.unitName,
                    patientId: selectedPatient?.id,
                    patientName: selectedPatient?.name,
                    notes: job.formInput.notes || null,
                    userId: userWithId.id || "unknown_user_id",
                    userDisplayName: userWithId.name,
                };
                
                transaction.set(newMovementRef, movementLog);
            }
        });

        toast({ title: "Consumo Registrado com Sucesso!" });
        setSelectedLocation(null);
        setStage('selectLocation');
        locationForm.reset({ hospitalId: '', unitId: ''});
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

  const LocationSelectionForm = () => {
    const isButtonDisabled = !watchedHospitalId || (watchedHospitalId !== CENTRAL_WAREHOUSE_ID && !locationForm.getValues('unitId'));

    return (
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
                          {isSelectedHospitalUBS && (
                              <SelectItem value={GENERAL_STOCK_UNIT_ID_PLACEHOLDER} key={GENERAL_STOCK_UNIT_ID_PLACEHOLDER}>
                                  Estoque Geral da UBS
                              </SelectItem>
                          )}
                          {availableUnitsForSelection.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                           {!isSelectedHospitalUBS && availableUnitsForSelection.length === 0 && (
                              <SelectItem value={NO_UNITS_FOR_HOSPITAL_PLACEHOLDER} disabled>
                                  Nenhuma unidade para este hospital
                              </SelectItem>
                           )}
                      </SelectContent>
                    </Select>
                     <FormDescription>Selecione a unidade específica ou o estoque geral da UBS.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isButtonDisabled}>
                  Prosseguir para Detalhes do Consumo
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    );
  };

  const ConsumptionDetailsForm = () => (
    <Card>
      <Form {...consumptionForm}>
        <form onSubmit={consumptionForm.handleSubmit(handleConsumptionSubmit)}>
          <CardHeader>
            <CardTitle>2. Detalhes do Consumo</CardTitle>
            <CardDescription>Local: <span className="font-semibold">{selectedLocation?.unitName}</span></CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              {fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2 mb-2 p-2 border rounded-md">
                  <FormField name={`items.${index}.itemId`} control={consumptionForm.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>Item</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Selecione o item" /></SelectTrigger></FormControl><SelectContent>{items.map(item => <SelectItem key={item.id} value={item.id}>{item.name} (Disp: {getDisplayStockForItemAtSelectedLocation(item.id)})</SelectItem>)}</SelectContent></Select>
                        <FormMessage />
                      </FormItem>
                  )} />
                   <FormField name={`items.${index}.quantityConsumed`} control={consumptionForm.control} render={({ field }) => (
                    <FormItem><FormLabel>Qtd</FormLabel><FormControl><Input type="number" placeholder="Qtd" {...field} className="w-24" /></FormControl><FormMessage /></FormItem>
                  )} />
                   <FormField name={`items.${index}.notes`} control={consumptionForm.control} render={({ field }) => (
                     <FormItem className="w-full"><FormLabel>Obs.</FormLabel><FormControl><Input placeholder="Lote, etc." {...field} /></FormControl><FormMessage /></FormItem>
                   )} />
                  <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}><X className="h-4 w-4" /></Button>
                </div>))}
              <Button type="button" variant="outline" size="sm" onClick={() => append({ itemId: '', quantityConsumed: 1, notes: '' })} className="mt-2">Adicionar Item</Button>
            </div>
            <FormField name="date" control={consumptionForm.control} render={({ field }) => <FormItem><FormLabel>Data</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>} />
            
            {selectedLocation?.hospitalId !== CENTRAL_WAREHOUSE_ID && isSelectedHospitalUBS && (
                <div className="space-y-2">
                  <FormLabel>Paciente (Opcional)</FormLabel>
                  {selectedPatient ? (
                      <div className="flex items-center justify-between p-2 border rounded-md bg-muted">
                        <div>
                          <p className="font-semibold">{selectedPatient.name}</p>
                          <p className="text-sm text-muted-foreground">SUS: {selectedPatient.susCardNumber}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={handleClearPatientSelection}><X className="h-4 w-4" /></Button>
                      </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                          <Input
                            placeholder="Buscar por nome ou nº do Cartão SUS"
                            value={patientSearchTerm}
                            onChange={(e) => setPatientSearchTerm(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handlePatientSearch(); }}}
                          />
                          <Button type="button" onClick={handlePatientSearch} disabled={isSearchingPatient}>
                              {isSearchingPatient ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          </Button>
                      </div>
                      {patientSearchResults.length > 0 && (
                          <Card className="mt-2 p-2 max-h-48 overflow-y-auto">
                            <ul className="space-y-1">
                              {patientSearchResults.map(p => (
                                <li key={p.id} onClick={() => handleSelectPatient(p)}
                                    className="p-2 rounded-md hover:bg-accent cursor-pointer text-sm">
                                  <p className="font-semibold">{p.name}</p>
                                  <p className="text-muted-foreground">SUS: {p.susCardNumber}</p>
                                </li>
                              ))}
                            </ul>
                          </Card>
                      )}
                    </>
                  )}
                  <FormDescription>Se o consumo for para um paciente específico, busque e selecione-o.</FormDescription>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button type="button" variant="ghost" onClick={() => { setSelectedLocation(null); setStage('selectLocation'); }}>Voltar</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : 'Registrar Consumo'}</Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );

  return (
    <div className="container max-w-4xl mx-auto py-4">
      <PageHeader title="Registrar Consumo" icon={ShoppingCart} />
      
      {isLoadingData ? (
        <div className="flex justify-center p-8">
          <Loader2 className="animate-spin h-8 w-8 text-primary" />
        </div>
      ) : (
        stage === 'selectLocation' ? <LocationSelectionForm /> : <ConsumptionDetailsForm />
      )}
    </div>
  );
}
