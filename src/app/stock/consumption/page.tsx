
'use client';

import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShoppingCart, Loader2, X, Search } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient, StockMovement, UserProfile, FirestoreStockConfig, User as AppUser } from '@/types';
import { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { firestore } from '@/lib/firebase';
import { collection, doc, query, orderBy, onSnapshot, runTransaction, type DocumentSnapshot, where, getDocs, limit } from 'firebase/firestore';

// --- Constants ---
const CENTRAL_WAREHOUSE_ID = "__CENTRAL_WAREHOUSE__";
const GENERAL_STOCK_UNIT_ID_PLACEHOLDER = "__GENERAL_STOCK_UNIT__";
const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";
const NO_UNITS_FOR_HOSPITAL_PLACEHOLDER = "__NO_UNITS_FOR_HOSPITAL__";
const LOADING_PLACEHOLDER = "__LOADING__";

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


// --- Helper Components (Moved Outside for Stability) ---
interface LocationSelectionFormProps {
  locationForm: any;
  handleLocationSubmit: (data: LocationSelectionFormData) => void;
  currentUserProfile: UserProfile | null;
  hospitals: Hospital[];
  servedUnits: ServedUnit[];
}

const LocationSelectionForm = ({
  locationForm,
  handleLocationSubmit,
  currentUserProfile,
  hospitals,
  servedUnits,
}: LocationSelectionFormProps) => {
  const watchedHospitalId = locationForm.watch('hospitalId');
  const watchedUnitId = locationForm.watch('unitId');

  const isSelectedHospitalUBS = useMemo(() => {
    if (!watchedHospitalId) return false;
    return hospitals.find(h => h.id === watchedHospitalId)?.name.toLowerCase().includes('ubs') || false;
  }, [watchedHospitalId, hospitals]);

  const availableUnitsForSelection = useMemo(() => {
    if (!watchedHospitalId) return [];
    return servedUnits.filter(u => u.hospitalId === watchedHospitalId)
  }, [watchedHospitalId, servedUnits]);

  const isButtonDisabled = !watchedHospitalId || (watchedHospitalId !== CENTRAL_WAREHOUSE_ID && !watchedUnitId);

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
                <Select
                  onValueChange={(value) => {
                    field.onChange(value);
                    locationForm.setValue('unitId', undefined, { shouldValidate: true });
                  }}
                  value={field.value || ''}
                  disabled={!!currentUserProfile?.associatedHospitalId}
                >
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

interface ConsumptionDetailsFormProps {
  consumptionForm: any;
  handleConsumptionSubmit: (data: ConsumptionDetailsFormData) => void;
  isSubmitting: boolean;
  selectedLocation: { hospitalId: string; unitId?: string | null; hospitalName: string; unitName: string };
  setSelectedLocation: (location: any) => void;
  setStage: (stage: 'selectLocation' | 'fillForm') => void;
  items: Item[];
  stockConfigs: FirestoreStockConfig[];
  patientSearchTerm: string;
  setPatientSearchTerm: (term: string) => void;
  patientSearchResults: Patient[];
  handlePatientSearch: () => void;
  isSearchingPatient: boolean;
  selectedPatient: Patient | null;
  handleSelectPatient: (patient: Patient) => void;
  handleClearPatientSelection: () => void;
  isSelectedHospitalUBS: boolean;
  currentUserProfile: UserProfile | null;
}

const ConsumptionDetailsForm = ({
    consumptionForm,
    handleConsumptionSubmit,
    isSubmitting,
    selectedLocation,
    setSelectedLocation,
    setStage,
    items,
    stockConfigs,
    patientSearchTerm,
    setPatientSearchTerm,
    patientSearchResults,
    handlePatientSearch,
    isSearchingPatient,
    selectedPatient,
    handleSelectPatient,
    handleClearPatientSelection,
    isSelectedHospitalUBS,
    currentUserProfile,
  }: ConsumptionDetailsFormProps) => {

    const { fields, append, remove } = useFieldArray({ control: consumptionForm.control, name: "items" });
    
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

    const canGoBack = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator' ||
                      (currentUserProfile?.role === 'hospital_operator' && !currentUserProfile.associatedUnitId);

    return (
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
                 {canGoBack ? (
                    <Button type="button" variant="ghost" onClick={() => { setSelectedLocation(null); setStage('selectLocation'); }}>Voltar</Button>
                  ) : (
                    <div></div> // Placeholder to keep spacing
                  )}
                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="animate-spin" /> : 'Registrar Consumo'}</Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
      );
};

// --- Main Page Component ---
export default function GeneralConsumptionPage() {
  const { toast } = useToast();
  const { currentUserProfile, loading: authLoading, user } = useAuth();
  
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
    unitId?: string | null;
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

  useEffect(() => {
    const sourcesToLoad = 4;
    let loadedCount = 0;
    
    const checkAllLoaded = () => {
      loadedCount++;
      if (loadedCount >= sourcesToLoad) {
        setIsLoadingData(false);
      }
    };

    const createListener = (collectionName: string, q: any, setter: React.Dispatch<React.SetStateAction<any[]>>) => {
      return onSnapshot(q, (snapshot) => {
        setter(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
        checkAllLoaded();
      }, (error) => {
        toast({ title: `Erro ao carregar ${collectionName}`, variant: "destructive" });
        checkAllLoaded(); // Still count as "loaded" to unblock UI
      });
    };

    const unsubscribers = [
      createListener("items", query(collection(firestore, "items"), orderBy("name")), setItems),
      createListener("hospitals", query(collection(firestore, "hospitals"), orderBy("name")), setHospitals),
      createListener("servedUnits", query(collection(firestore, "servedUnits"), orderBy("name")), setServedUnits),
      createListener("stockConfigs", query(collection(firestore, "stockConfigs")), setStockConfigs),
    ];

    return () => unsubscribers.forEach(unsub => unsub());
  }, [toast]);
  
  useEffect(() => {
    if (isLoadingData || authLoading || !currentUserProfile) {
      return;
    }
  
    const { role, associatedHospitalId, associatedUnitId } = currentUserProfile;
    const isOperator = role === 'hospital_operator' || role === 'ubs_operator';
  
    // Logic for operators with specific associations to bypass selection
    if (isOperator && associatedHospitalId) {
      const hospital = hospitals.find(h => h.id === associatedHospitalId);
      if (!hospital) return;
  
      let locationToSet = null;
      if (associatedUnitId) {
        const unit = servedUnits.find(u => u.id === associatedUnitId);
        if (unit) {
          locationToSet = {
            hospitalId: associatedHospitalId,
            unitId: associatedUnitId,
            hospitalName: hospital.name,
            unitName: unit.name,
          };
        }
      } else if (role === 'ubs_operator' || hospital.name.toLowerCase().includes('ubs')) {
        locationToSet = {
          hospitalId: associatedHospitalId,
          unitId: null,
          hospitalName: hospital.name,
          unitName: `Estoque Geral (${hospital.name})`,
        };
      }
  
      if (locationToSet && stage === 'selectLocation') {
        setSelectedLocation(locationToSet);
        setStage('fillForm');
        consumptionForm.reset({ items: [{ itemId: '', quantityConsumed: 1, notes: '' }], date: new Date().toISOString().split('T')[0] });
        return;
      }
    }

    if (stage === 'selectLocation') {
       if (isOperator && associatedHospitalId) {
          locationForm.reset({
            hospitalId: associatedHospitalId,
            unitId: undefined,
          });
       } else {
         locationForm.reset({ hospitalId: '', unitId: '' });
       }
    }
  }, [stage, isLoadingData, authLoading, currentUserProfile, hospitals, servedUnits, locationForm, consumptionForm]);


  const isSelectedHospitalUBS = useMemo(() => {
    if (!selectedLocation?.hospitalId) return false;
    return hospitals.find(h => h.id === selectedLocation.hospitalId)?.name.toLowerCase().includes('ubs') || false;
  }, [selectedLocation, hospitals]);

  const handleLocationSubmit = (data: LocationSelectionFormData) => {
    const hospital = data.hospitalId === CENTRAL_WAREHOUSE_ID ? { id: CENTRAL_WAREHOUSE_ID, name: 'Almoxarifado Central' } : hospitals.find(h => h.id === data.hospitalId);
    if (!hospital) return toast({ title: "Hospital inválido", variant: "destructive" });

    let unitName = hospital.name;
    let unitIdForTx: string | undefined | null = data.unitId;

    if (data.hospitalId !== CENTRAL_WAREHOUSE_ID) {
      if (data.unitId === GENERAL_STOCK_UNIT_ID_PLACEHOLDER) {
        unitName = `Estoque Geral (${hospital.name})`;
        unitIdForTx = null; // Use null for general stock
      } else {
        const unit = servedUnits.find(u => u.id === data.unitId);
        if (!unit) return toast({ title: "Unidade inválida", variant: "destructive" });
        unitName = unit.name;
      }
    } else {
      unitIdForTx = null;
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
        const ubsId = isSelectedHospitalUBS ? selectedLocation?.hospitalId : null;
        
        if (ubsId) {
            // SCENARIO: User is at a UBS. Scope the search.
            const q = query(patientsRef, where("registeredUBSId", "==", ubsId));
            const querySnapshot = await getDocs(q);

            const searchTermLower = patientSearchTerm.toLowerCase();
            
            const filteredPatients = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Patient))
                .filter(patient => 
                    patient.name.toLowerCase().includes(searchTermLower) || 
                    patient.susCardNumber.includes(patientSearchTerm)
                );

            setPatientSearchResults(filteredPatients.slice(0, 10)); // Limit results on the client
            if (filteredPatients.length === 0) {
                 toast({ title: "Nenhum Paciente Encontrado", description: "Nenhum paciente encontrado nesta UBS com os termos da busca." });
            }

        } else {
            // SCENARIO: User is at Central Warehouse (or admin). Do a global search.
            const results: { [id: string]: Patient } = {};
            const term = patientSearchTerm;

            if (/^\d{15}$/.test(term)) {
                const susQuery = query(patientsRef, where("susCardNumber", "==", term), limit(10));
                const susSnap = await getDocs(susQuery);
                susSnap.docs.forEach(doc => {
                    results[doc.id] = { id: doc.id, ...doc.data() } as Patient;
                });
            }

            const nameQuery = query(
                patientsRef,
                where("name", ">=", term),
                where("name", "<=", term + '\uf8ff'),
                limit(10)
            );
            const nameSnap = await getDocs(nameQuery);
            nameSnap.docs.forEach(doc => {
                if (!results[doc.id]) {
                    results[doc.id] = { id: doc.id, ...doc.data() } as Patient;
                }
            });

            const uniqueResults = Object.values(results);
            setPatientSearchResults(uniqueResults);
            if (uniqueResults.length === 0) {
                 toast({ title: "Nenhum Paciente Encontrado", description: "Verifique os termos de busca e tente novamente." });
            }
        }
    } catch (error) {
      console.error("Erro ao buscar pacientes: ", error);
      toast({ title: "Erro na Busca", description: "Não foi possível realizar a busca por pacientes.", variant: "destructive" });
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
            notes: job.formInput.notes ?? null,
            patientId: selectedPatient?.id ?? null,
            patientName: selectedPatient?.name ?? null,
            userId: userWithId.id || "unknown_user_id",
            userDisplayName: userWithId.name,
          };
          
          transaction.set(newMovementRef, movementLog);
        }
      });

      toast({ title: "Consumo Registrado com Sucesso!" });
      // Reset logic: if operator with specific role, stay on the form, otherwise go back to selection.
      if (currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator' || (currentUserProfile.role === 'hospital_operator' && !currentUserProfile.associatedUnitId)) {
        setStage('selectLocation');
        locationForm.reset({ hospitalId: '', unitId: ''});
      }
      consumptionForm.reset({ items: [{ itemId: '', quantityConsumed: 1, notes: '' }], date: new Date().toISOString().split('T')[0] });
      setSelectedPatient(null);
      setPatientSearchTerm('');

    } catch (error: any) {
      console.error("Erro ao registrar consumo:", error);
      toast({ title: "Erro ao registrar consumo", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || isLoadingData) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-lg text-muted-foreground">Carregando dados...</p>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto py-4">
      <PageHeader title="Registrar Consumo" icon={ShoppingCart} />
      
      {stage === 'selectLocation' && currentUserProfile ? (
        <LocationSelectionForm 
          locationForm={locationForm}
          handleLocationSubmit={handleLocationSubmit}
          currentUserProfile={currentUserProfile}
          hospitals={hospitals}
          servedUnits={servedUnits}
        />
      ) : selectedLocation ? (
        <ConsumptionDetailsForm 
          consumptionForm={consumptionForm}
          handleConsumptionSubmit={handleConsumptionSubmit}
          isSubmitting={isSubmitting}
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
          setStage={setStage}
          items={items}
          stockConfigs={stockConfigs}
          patientSearchTerm={patientSearchTerm}
          setPatientSearchTerm={setPatientSearchTerm}
          patientSearchResults={patientSearchResults}
          handlePatientSearch={handlePatientSearch}
          isSearchingPatient={isSearchingPatient}
          selectedPatient={selectedPatient}
          handleSelectPatient={handleSelectPatient}
          handleClearPatientSelection={handleClearPatientSelection}
          isSelectedHospitalUBS={isSelectedHospitalUBS}
          currentUserProfile={currentUserProfile}
        />
      ) : (
         <div className="flex h-screen w-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-lg text-muted-foreground">Aguardando dados de localização...</p>
        </div>
      )}
    </div>
  );
}
