
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea'; // Import Textarea
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { TrendingDown, CheckCircle, User, Loader2, ShieldAlert } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient, StockMovement, UserProfile, StockMovementType, FirestoreStockConfig } from '@/types';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, runTransaction, getDoc } from 'firebase/firestore';
import { processMovementRowTransaction } from '@/app/stock/movements/page.tsx'; // Import the transaction function

const consumptionSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  quantityConsumed: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  patientId: z.string().optional(),
  notes: z.string().optional(),
  // Type is implicitly 'consumption' for this page
});

type ConsumptionFormData = z.infer<typeof consumptionSchema>;

const NO_PATIENT_ID = "__NO_PATIENT__";
const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL"; // Define this if not already globally available

export default function RecordUnitConsumptionPage() {
  const params = useParams();
  const unitIdParams = params.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile, user: firebaseUser } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [servedUnit, setServedUnit] = useState<ServedUnit | null>(null);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [stockConfigs, setStockConfigs] = useState<FirestoreStockConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Master lists needed for processMovementRowTransaction
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
  const [allServedUnits, setAllServedUnits] = useState<ServedUnit[]>([]);


  useEffect(() => {
    setIsLoading(true);
    const itemQuery = query(collection(firestore, "items"), orderBy("name", "asc"));
    const patientQuery = query(collection(firestore, "patients"), orderBy("name", "asc"));
    const unitDocRef = doc(firestore, "servedUnits", unitIdParams);
    const stockConfigsQuery = query(collection(firestore, "stockConfigs"));

    const allHospitalsQuery = query(collection(firestore, "hospitals"), orderBy("name", "asc"));
    const allServedUnitsQuery = query(collection(firestore, "servedUnits"), orderBy("name", "asc"));


    const unsubscribers = [
      onSnapshot(itemQuery, snapshot => setItems(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Item)))),
      onSnapshot(patientQuery, snapshot => setPatients(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Patient)))),
      onSnapshot(stockConfigsQuery, snapshot => setStockConfigs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as FirestoreStockConfig)))),
      onSnapshot(allHospitalsQuery, snapshot => setAllHospitals(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)))),
      onSnapshot(allServedUnitsQuery, snapshot => setAllServedUnits(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ServedUnit)))),
      onSnapshot(unitDocRef, async (unitSnap) => {
        if (unitSnap.exists()) {
          const unitData = { id: unitSnap.id, ...unitSnap.data() } as ServedUnit;
          setServedUnit(unitData);
          if (unitData.hospitalId) {
            const hospitalDocRef = doc(firestore, "hospitals", unitData.hospitalId);
            const hospitalSnap = await getDoc(hospitalDocRef);
            if (hospitalSnap.exists()) {
              setHospital({ id: hospitalSnap.id, ...hospitalSnap.data() } as Hospital);
            } else {
              setHospital(null);
              toast({ title: "Erro", description: "Hospital associado à unidade não encontrado.", variant: "destructive" });
            }
          }
        } else {
          setServedUnit(null);
          toast({ title: "Erro", description: "Unidade servida não encontrada.", variant: "destructive" });
        }
      }, (error) => {
        console.error("Error fetching unit/hospital:", error);
        toast({ title: "Erro ao Carregar Dados", description: error.message, variant: "destructive" });
      })
    ];

    Promise.all([
        getDoc(unitDocRef) // Just ensure the critical unit data is attempted
    ]).catch(err => {
        console.error("Error in initial data fetch for consumption page:", err);
    }).finally(() => {
      // Authorization check will set loading state
    });

    return () => unsubscribers.forEach(unsub => unsub());
  }, [unitIdParams, toast]);

  useEffect(() => {
    if (!currentUserProfile || !servedUnit || !hospital || items.length === 0 || stockConfigs.length === 0) {
      // Wait for all essential data
      if (!isLoading && (!currentUserProfile || !servedUnit || !hospital)) {
         // If not loading and critical data is missing, it's an error or unauthorized state handled below
      }
      return;
    }

    let authorized = false;
    if (currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator') {
      authorized = true; // Admins/CentralOps can consume on behalf of units
    } else if (currentUserProfile.role === 'hospital_operator' || currentUserProfile.role === 'ubs_operator') {
      if (currentUserProfile.associatedHospitalId === hospital.id) {
        // If operator is tied to a specific unit, it must be this unit
        // If operator is general for hospital/UBS, they can consume for any unit in their hospital (this page is specific to one unit)
        authorized = currentUserProfile.associatedUnitId ? currentUserProfile.associatedUnitId === servedUnit.id : true;
      }
    }
    setIsAuthorized(authorized);
    setIsLoading(false);
  }, [currentUserProfile, servedUnit, hospital, items, stockConfigs, isLoading]);


  const form = useForm<ConsumptionFormData>({
    resolver: zodResolver(consumptionSchema),
    defaultValues: {
      quantityConsumed: 1,
      date: new Date().toISOString().split('T')[0],
      patientId: undefined,
      notes: '',
      itemId: undefined,
    },
  });

  const onSubmit = async (data: ConsumptionFormData) => {
    if (!isAuthorized || !currentUserProfile || !firebaseUser || !servedUnit || !hospital) {
      toast({ title: "Erro", description: "Não autorizado ou dados insuficientes para registrar consumo.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);

    const itemForRow = items.find(i => i.id === data.itemId);
    if (!itemForRow) {
      toast({ title: "Erro", description: "Item selecionado não encontrado.", variant: "destructive" });
      setIsSubmitting(false);
      return;
    }

    const movementDataForTransaction: Omit<StockMovement, 'id' | 'itemName' | 'hospitalName' | 'unitName' | 'patientName' | 'userDisplayName' | 'userId'> & { itemId: string } = {
      itemId: data.itemId,
      type: 'consumption', // Hardcoded for this page
      quantity: data.quantityConsumed,
      date: data.date,
      hospitalId: hospital.id,
      unitId: servedUnit.id,
      patientId: data.patientId === NO_PATIENT_ID ? undefined : data.patientId,
      notes: data.notes,
    };

    try {
      await runTransaction(firestore, (transaction) =>
        processMovementRowTransaction(
          transaction,
          movementDataForTransaction,
          currentUserProfile,
          items, // master list items
          allHospitals, // master list hospitals
          allServedUnits, // master list units
          patients, // master list patients
          0, // rowIndex for logging (not batch)
          itemForRow.code, // itemCode for logging
          hospital.name, // hospitalNameLog
          servedUnit.name, // unitNameLog
          data.notes // notesLog
        )
      );

      let description = `${data.quantityConsumed} unidade(s) de ${itemForRow.name} consumido(s) em ${servedUnit.name} (${hospital.name}).`;
      if (data.patientId && data.patientId !== NO_PATIENT_ID) {
        description += ` Paciente: ${patients.find(p => p.id === data.patientId)?.name}.`;
      }
      toast({
        title: "Consumo Registrado",
        description: description,
        action: <CheckCircle className="text-green-500" />,
      });
      form.reset({
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
      setIsSubmitting(false);
    }
  };

  const getDisplayStockForItemInUnit = (item: Item): number => {
    if (!servedUnit) return 0;
    const configId = `${item.id}_${servedUnit.id}`;
    const unitConfig = stockConfigs.find(sc => sc.id === configId);
    return unitConfig?.currentQuantity ?? 0;
  };


  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Carregando dados e verificando permissões...</p>
      </div>
    );
  }

  if (!isAuthorized) {
     return (
        <div className="container mx-auto py-2 max-w-md">
            <PageHeader title="Acesso Negado" icon={ShieldAlert} />
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle className="text-destructive">Permissão Insuficiente</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>Você não tem permissão para registrar consumo para esta unidade servida ({servedUnit?.name || 'Desconhecida'} em {hospital?.name || 'Desconhecido'}).</p>
                    <p className="mt-2">Contate um administrador se você acredita que isso é um erro.</p>
                    <Button onClick={() => router.back()} className="mt-4">Voltar</Button>
                </CardContent>
            </Card>
        </div>
    );
  }

  if (!servedUnit || !hospital) {
    return <PageHeader title="Erro" description="Unidade servida ou hospital não pôde ser carregado." />;
  }

  const isConsumptionAtUBS = hospital?.name.toLowerCase().includes('ubs');

  return (
    <div className="container mx-auto py-2 max-w-lg">
      <PageHeader
        title={`Registrar Consumo`}
        description={`Unidade: ${servedUnit.name} (${servedUnit.location || 'N/D'}) - ${hospital.name}`}
        icon={TrendingDown}
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl">Detalhes do Consumo na Unidade</CardTitle>
           <CardDescription>Operador: {currentUserProfile?.name} ({currentUserProfile?.role})</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="itemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item Consumido</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um item" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {items.map(item => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name} ({item.code}) - Disp. na Unidade: {getDisplayStockForItemInUnit(item)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Apenas itens com estoque configurado para esta unidade serão processados.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="quantityConsumed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantidade Consumida</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="ex: 1" {...field} min="1"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data do Consumo</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isConsumptionAtUBS && (
                 <FormField
                  control={form.control}
                  name="patientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <User className="h-4 w-4 text-muted-foreground"/> Paciente (Opcional se consumo geral da UBS)
                      </FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value === NO_PATIENT_ID ? undefined : value)}
                        value={field.value || NO_PATIENT_ID}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um paciente (se aplicável)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NO_PATIENT_ID}>Nenhum paciente específico (consumo geral da unidade)</SelectItem>
                          {patients
                            .filter(p => p.registeredUBSId === hospital?.id || (!p.registeredUBSId && isConsumptionAtUBS)) // Melhorar filtro se necessário
                            .map(patient => (
                            <SelectItem key={patient.id} value={patient.id}>{patient.name} - SUS: {patient.susCardNumber}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Selecione o paciente se o consumo for individualizado.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
               <FormField
                control={form.control}
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
              <Button type="submit" className="w-full" disabled={isSubmitting || isLoading}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                Registrar Consumo na Unidade
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()} className="w-full">
                Voltar
            </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}

