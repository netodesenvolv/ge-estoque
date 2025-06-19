
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRightLeft, User, Loader2, Upload, Download, ShieldAlert } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient, StockMovement, UserProfile } from '@/types';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, runTransaction, addDoc, type Transaction, type DocumentSnapshot, writeBatch } from 'firebase/firestore';
import Papa, { type ParseError } from 'papaparse';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from '@/contexts/AuthContext';


function removeUndefinedFields<T extends object>(obj: T): Partial<T> {
  const newObj: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      newObj[key] = obj[key];
    }
  }
  return newObj;
}

const CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE = "CENTRAL_WAREHOUSE_DIRECT_EXIT";
const UBS_GENERAL_STOCK_SUFFIX = "UBSGENERAL";


const createMovementSchema = (
    hospitalsList: Hospital[], 
    currentUserProfile: UserProfile | null
) => z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  type: z.enum(['entry', 'exit', 'consumption'], { required_error: "O tipo de movimentação é obrigatório." }),
  quantity: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  hospitalId: z.string().optional(), // Hospital de destino/consumo
  unitId: z.string().optional(),     // Unidade de destino/consumo
  patientId: z.string().optional(),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  const role = currentUserProfile?.role;
  const associatedHospitalId = currentUserProfile?.associatedHospitalId;
  const associatedUnitId = currentUserProfile?.associatedUnitId;

  // Role-based restrictions for movement type
  if (role === 'hospital_operator' || role === 'ubs_operator') {
    if (data.type !== 'consumption') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Seu perfil permite apenas registrar 'Consumo'.",
        path: ["type"],
      });
    }
    if (data.hospitalId !== associatedHospitalId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Você só pode registrar consumo para o seu hospital/UBS associado.",
            path: ["hospitalId"],
        });
    }
    if (associatedUnitId && data.unitId !== associatedUnitId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Você só pode registrar consumo para sua unidade associada.",
            path: ["unitId"],
        });
    }
    if (!data.unitId && role === 'hospital_operator' && !associatedUnitId && hospitalsList.find(h => h.id === data.hospitalId && !h.name.toLowerCase().includes('ubs'))) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Para consumo em Hospital (não UBS) por operador de hospital sem unidade específica, a Unidade Servida é obrigatória.",
            path: ["unitId"],
        });
    }
     if (!data.unitId && role === 'ubs_operator') {
        // For UBS operators, if no unitId is provided, it implies general UBS stock consumption
        // This is fine, but ensure hospitalId is their associated UBS.
    }
  }

  // Existing general validations
  if (data.type === 'exit' || data.type === 'consumption') {
    if (data.hospitalId && data.hospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
      const selectedHospital = hospitalsList.find(h => h.id === data.hospitalId);
      const isTargetUBS = selectedHospital?.name.toLowerCase().includes('ubs');

      if (data.type === 'consumption' && !data.unitId && !isTargetUBS) { // Consumption in non-UBS hospital requires specific unit
          ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Para Consumo em Hospital (não UBS), a Unidade Servida é obrigatória.",
              path: ["unitId"],
          });
      } else if (data.type === 'exit' && !isTargetUBS && !data.unitId) { // Exit to non-UBS hospital requires specific unit
          ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Para Saída para este tipo de Hospital, a Unidade Servida é obrigatória.",
              path: ["unitId"],
          });
      }
    }
  }

  if (data.type === 'entry' && (data.hospitalId || data.unitId)) {
    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hospital e Unidade Servida não devem ser selecionados para movimentações de Entrada (direto no Armazém Central).",
        path: ["hospitalId"], 
    });
  }
  if ((data.type === 'exit' || data.type === 'consumption') &&
      data.hospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE &&
      data.unitId) {
    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unidade Servida não deve ser selecionada para Baixa/Consumo direto do Armazém Central.",
        path: ["unitId"],
    });
  }
});


type MovementFormData = z.infer<ReturnType<typeof createMovementSchema>>;

const NO_PATIENT_ID = "__NO_PATIENT__";


const ManualMovementForm = ({ items, servedUnits, hospitals, patients }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], patients: Patient[] }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { currentUserProfile, user: firebaseUser } = useAuth();
  const movementSchema = createMovementSchema(hospitals, currentUserProfile); 

  const form = useForm<MovementFormData>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      type: (currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator') ? 'consumption' : 'entry',
      quantity: 1,
      date: new Date().toISOString().split('T')[0],
      notes: '',
      hospitalId: currentUserProfile?.associatedHospitalId || undefined,
      unitId: currentUserProfile?.associatedUnitId || undefined,
      patientId: undefined,
      itemId: undefined,
    },
  });

  const movementType = form.watch('type');
  const selectedHospitalId = form.watch('hospitalId');
  const selectedUnitId = form.watch('unitId'); // Watch selectedUnitId as well

  // Update form defaults if currentUserProfile changes (e.g., on initial load)
  useEffect(() => {
    if (currentUserProfile) {
      form.reset({
        type: (currentUserProfile.role === 'hospital_operator' || currentUserProfile.role === 'ubs_operator') ? 'consumption' : 'entry',
        quantity: 1,
        date: new Date().toISOString().split('T')[0],
        notes: '',
        hospitalId: currentUserProfile.associatedHospitalId || undefined,
        unitId: currentUserProfile.associatedUnitId || undefined,
        patientId: undefined,
        itemId: undefined,
      });
    }
  }, [currentUserProfile, form]);

  useEffect(() => {
    if (movementType === 'entry' && (currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator')) {
        form.setValue('hospitalId', undefined, { shouldValidate: true });
        form.setValue('unitId', undefined, { shouldValidate: true });
        form.setValue('patientId', undefined, { shouldValidate: true });
    } else if (movementType === 'exit') {
        form.setValue('patientId', undefined, { shouldValidate: true }); 
    }
    if (selectedHospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        form.setValue('unitId', undefined, { shouldValidate: true });
    }
  }, [movementType, form, selectedHospitalId, currentUserProfile]);

   useEffect(() => {
    if (selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE && 
        !(currentUserProfile?.role === 'hospital_operator' && currentUserProfile?.associatedUnitId) &&
        !(currentUserProfile?.role === 'ubs_operator') // UBS operators don't necessarily pick a unit if consuming from general stock
        ) {
        form.setValue('unitId', undefined, { shouldValidate: true });
    }
  }, [selectedHospitalId, form, currentUserProfile]);


  const availableUnits = selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE
    ? servedUnits.filter(unit => unit.hospitalId === selectedHospitalId)
    : [];

  const isPatientLinkable = () => {
    if (movementType !== 'consumption') return false;
    if (currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator') {
        // Admin/Central can link patient if consuming from a specific unit (not central warehouse direct)
        return !!selectedUnitId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE;
    }
    if (currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator') {
        // Hospital/UBS operators can always link patient if consuming (from their assigned location)
        return true;
    }
    return false;
  };


  const getUnitFormFieldDescription = () => {
    const role = currentUserProfile?.role;
    if (role === 'admin' || role === 'central_operator') {
        if (movementType === 'exit' && selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
            const hospital = hospitals.find(h => h.id === selectedHospitalId);
            if (hospital?.name.toLowerCase().includes('ubs')) {
                return "Opcional para UBS. Se não selecionada, o estoque irá para a UBS como um todo.";
            }
            return "Unidade para a qual o item está sendo transferido (Obrigatório para este tipo de hospital).";
        }
        if (movementType === 'consumption' && selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
            return "Unidade onde o item foi consumido (Obrigatório).";
        }
    } else if (role === 'hospital_operator' && !currentUserProfile?.associatedUnitId) {
        return "Selecione a unidade de consumo dentro do seu hospital.";
    } else if (role === 'ubs_operator') {
        return "Opcional. Se não selecionada, consumo é do estoque geral da UBS.";
    }
    return "Selecione uma unidade de destino ou consumo.";
  };

  const isHospitalFieldDisabled = currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator';
  const isUnitFieldDisabled = !!(currentUserProfile?.role === 'hospital_operator' && currentUserProfile?.associatedUnitId) || 
                             (selectedHospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) ||
                             (!selectedHospitalId && (currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator')) ||
                             (availableUnits.length === 0 && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE);


  const onSubmit = async (data: MovementFormData) => {
    setIsSubmitting(true);
    if (!currentUserProfile || !firebaseUser) {
        toast({ title: "Erro de Autenticação", description: "Usuário não autenticado.", variant: "destructive" });
        setIsSubmitting(false);
        return;
    }
    
    let processedData = {...data};
    if (data.hospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        processedData.hospitalId = undefined;
        processedData.unitId = undefined;
    }
    
    // Re-check role based restrictions before submitting, schema might not catch all dynamic UI states
    if ((currentUserProfile.role === 'hospital_operator' || currentUserProfile.role === 'ubs_operator')) {
        if (processedData.type !== 'consumption') {
             toast({ title: "Operação não permitida", description: "Seu perfil permite apenas registrar 'Consumo'.", variant: "destructive" });
             setIsSubmitting(false); return;
        }
        if (processedData.hospitalId !== currentUserProfile.associatedHospitalId) {
             toast({ title: "Operação não permitida", description: "Consumo apenas para seu hospital/UBS associado.", variant: "destructive" });
             setIsSubmitting(false); return;
        }
        if (currentUserProfile.associatedUnitId && processedData.unitId !== currentUserProfile.associatedUnitId) {
             toast({ title: "Operação não permitida", description: "Consumo apenas para sua unidade associada.", variant: "destructive" });
             setIsSubmitting(false); return;
        }
    }


    try {
      const itemForRow = items.find(i => i.id === processedData.itemId);
      if (!itemForRow) throw new Error("Item selecionado não encontrado na lista de itens.");

      const hospitalForLog = processedData.hospitalId ? hospitals.find(h => h.id === processedData.hospitalId) : undefined;
      const unitForLog = processedData.unitId ? servedUnits.find(u => u.id === processedData.unitId) : undefined;

      await runTransaction(firestore, (transaction) => 
        processMovementRowTransaction(
            transaction,
            processedData,
            itemForRow,
            0, 
            itemForRow.code, 
            items, hospitals, servedUnits, patients, 
            hospitalForLog?.name,
            unitForLog?.name,
            processedData.notes,
            currentUserProfile, // Pass current user profile
            firebaseUser.uid, // Pass firebase user ID
            firebaseUser.displayName || currentUserProfile.name // Pass user display name
        )
      );
      
      let description = `Movimentação de ${processedData.quantity} unidade(s) do item ${itemForRow?.name || processedData.itemId} registrada como ${processedData.type}.`;
      
      if (processedData.type !== 'entry') {
          if (unitForLog && hospitalForLog) { 
              description += ` para ${unitForLog.name} (${hospitalForLog.name}).`;
          } else if (hospitalForLog && !unitForLog && (processedData.type === 'exit' || processedData.type === 'consumption') && hospitalForLog.name.toLowerCase().includes('ubs')) {
              description += ` para ${hospitalForLog.name} (estoque geral da UBS).`;
          } else if (!processedData.hospitalId && !processedData.unitId) { 
              description += ` (Baixa/Consumo direto do Armazém Central).`;
          }
      }
      if (processedData.patientId && patients.find(p => p.id === processedData.patientId)) {
        description += ` Paciente: ${patients.find(p => p.id === processedData.patientId)?.name}.`;
      }

      toast({
        title: "Movimentação de Estoque Registrada",
        description: description,
      });
      form.reset({
          type: (currentUserProfile?.role === 'hospital_operator' || currentUserProfile?.role === 'ubs_operator') ? 'consumption' : 'entry',
          quantity: 1,
          date: new Date().toISOString().split('T')[0],
          notes: '',
          itemId: undefined,
          hospitalId: currentUserProfile?.associatedHospitalId || undefined,
          unitId: currentUserProfile?.associatedUnitId || undefined,
          patientId: undefined,
      });

    } catch (error: any) {
      console.error('Erro ao registrar movimentação de estoque:', error);
      toast({
        title: "Erro ao Registrar Movimentação",
        description: error.message || "Não foi possível concluir a operação.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  if (!currentUserProfile) {
    return (
         <Card className="max-w-2xl mx-auto shadow-lg">
            <CardHeader><CardTitle>Carregando Perfil...</CardTitle></CardHeader>
            <CardContent><Loader2 className="h-8 w-8 animate-spin text-primary" /></CardContent>
        </Card>
    );
  }
  
  return (
      <Card className="max-w-2xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Nova Movimentação de Estoque</CardTitle>
          <CardDescription>Usuário: {currentUserProfile.name} ({currentUserProfile.role})</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Tipo de Movimentação</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value} // Use value for controlled component
                        className="flex flex-col space-y-1 md:flex-row md:space-y-0 md:space-x-4"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="entry" disabled={!(currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator')} /></FormControl>
                          <FormLabel className="font-normal">Entrada (Armazém Central)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="exit" disabled={!(currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator')} /></FormControl>
                          <FormLabel className="font-normal">Saída (Transferência/Baixa)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="consumption" /></FormControl>
                          <FormLabel className="font-normal">Consumo (Unidade/Central)</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="itemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione um item" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {items.length === 0 && <SelectItem value="loading" disabled>Carregando itens...</SelectItem>}
                        {items.map(item => <SelectItem key={item.id} value={item.id}>{item.name} ({item.code}) - Atual Central: {item.currentQuantityCentral}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {(movementType === 'exit' || movementType === 'consumption') && (
                <>
                  <FormField
                    control={form.control}
                    name="hospitalId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Hospital de Destino/Consumo</FormLabel>
                        <Select
                            onValueChange={field.onChange}
                            value={field.value ?? (currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator' ? CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE : currentUserProfile.associatedHospitalId)} 
                            disabled={isHospitalFieldDisabled}
                        >
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione um hospital ou baixa direta" /></SelectTrigger></FormControl>
                          <SelectContent>
                             {(currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator') && 
                                <SelectItem value={CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE}>Nenhum (Baixa/Consumo direto do Armazém Central)</SelectItem>
                             }
                            {hospitals.map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                         <FormDescription>
                            {(currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator') && movementType === 'exit' && "Para transferir, selecione o hospital. Para baixa direta do Armazém Central, escolha 'Nenhum'."}
                            {(currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator') && movementType === 'consumption' && "Selecione o hospital onde o item foi consumido. Para consumo direto do Armazém Central, escolha 'Nenhum'."}
                            {(currentUserProfile.role === 'hospital_operator' || currentUserProfile.role === 'ubs_operator') && "Consumo será registrado para o seu hospital/UBS associado."}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE && (
                    <FormField
                      control={form.control}
                      name="unitId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unidade Servida de Destino/Consumo</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value ?? undefined}
                            disabled={isUnitFieldDisabled}
                          >
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder={availableUnits.length > 0 ? "Selecione uma unidade" : "Nenhuma unidade para este hospital/config"} />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                               {currentUserProfile.role === 'ubs_operator' && <SelectItem value="">Estoque Geral da UBS</SelectItem>}
                              {availableUnits.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                           <FormDescription>{getUnitFormFieldDescription()}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {isPatientLinkable() && (
                     <FormField
                        control={form.control}
                        name="patientId"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel className="flex items-center gap-1">
                                <User className="h-4 w-4 text-muted-foreground"/> Paciente (Opcional)
                            </FormLabel>
                            <Select
                                onValueChange={(value) => field.onChange(value === NO_PATIENT_ID ? undefined : value)}
                                value={field.value || NO_PATIENT_ID}
                            >
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder="Selecione um paciente (se aplicável)" />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                                <SelectItem value={NO_PATIENT_ID}>Nenhum paciente específico</SelectItem>
                                {patients.map(patient => (
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
                </>
              )}

              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantidade</FormLabel>
                    <FormControl><Input type="number" placeholder="ex: 10" {...field} min="1" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data da Movimentação</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observações (Opcional)</FormLabel>
                    <FormControl><Textarea placeholder="ex: Motivo da movimentação, número do lote" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Registrar Movimentação
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
  );
};

async function processMovementRowTransaction(
    transaction: Transaction,
    movementData: {
        itemId: string;
        type: 'entry' | 'exit' | 'consumption';
        quantity: number;
        date: string;
        hospitalId?: string;
        unitId?: string;
        patientId?: string;
        notes?: string;
    },
    itemForRow: Item,
    rowIndex: number, 
    itemCodeForRow: string, 
    allItemsMaster: Item[], // Not used inside, but kept for signature consistency if needed later
    allHospitalsMaster: Hospital[],
    allServedUnitsMaster: ServedUnit[],
    allPatientsMaster: Patient[],
    hospitalNameLog?: string, 
    unitNameLog?: string, 
    notesLog?: string,
    actorProfile: UserProfile, // Added
    actorUserId: string, // Added
    actorDisplayName: string // Added
) {
    console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): Start. Data:`, JSON.stringify(movementData), "Actor:", actorProfile.role);
    
    const itemDocRef = doc(firestore, "items", movementData.itemId);
    let unitConfigDocRefPath: string | undefined;
    let ubsGeneralStockConfigDocRefPath: string | undefined;
    
    // --- ALL READS FIRST ---
    const itemSnap = await transaction.get(itemDocRef);
    if (!itemSnap.exists()) {
        throw new Error(`Item ID '${movementData.itemId}' (Código: ${itemCodeForRow}) não encontrado (linha ${rowIndex}).`);
    }
    const currentItemData = itemSnap.data() as Item;
    console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): Read item ${itemDocRef.path}. Central Qty: ${currentItemData.currentQuantityCentral}`);

    let unitConfigSnap: DocumentSnapshot | null = null;
    let ubsGeneralStockConfigSnap: DocumentSnapshot | null = null;
    
    const isMovementToSpecificUnit = movementData.hospitalId && movementData.unitId;
    const targetHospital = movementData.hospitalId ? allHospitalsMaster.find(h => h.id === movementData.hospitalId) : null;
    const isMovementToUBSGeneralStock = movementData.hospitalId && !movementData.unitId && targetHospital?.name.toLowerCase().includes('ubs');

    if (isMovementToSpecificUnit) {
        const unitConfigDocId = `${movementData.itemId}_${movementData.unitId}`;
        const docRef = doc(firestore, "stockConfigs", unitConfigDocId);
        unitConfigDocRefPath = docRef.path;
        unitConfigSnap = await transaction.get(docRef);
        console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): Read unit config ${unitConfigDocRefPath}. Exists: ${unitConfigSnap?.exists()}`);
    } else if (isMovementToUBSGeneralStock) {
        const ubsGeneralStockConfigId = `${movementData.itemId}_${movementData.hospitalId}_${UBS_GENERAL_STOCK_SUFFIX}`;
        const docRef = doc(firestore, "stockConfigs", ubsGeneralStockConfigId);
        ubsGeneralStockConfigDocRefPath = docRef.path;
        ubsGeneralStockConfigSnap = await transaction.get(docRef);
        console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): Read UBS general config ${ubsGeneralStockConfigDocRefPath}. Exists: ${ubsGeneralStockConfigSnap?.exists()}`);
    }
    // --- ALL READS ARE DONE ---

    // --- WRITES AND LOGIC BASED ON READS ---
    let newCentralQuantity: number | undefined;
    let newUnitQuantity: number | undefined;
    let newUbsGeneralQuantity: number | undefined;

    const currentCentralQtyCoerced = Number(currentItemData.currentQuantityCentral) || 0;

    if (movementData.type === 'entry') {
        if (!(actorProfile.role === 'admin' || actorProfile.role === 'central_operator')) {
            throw new Error("Apenas Admin ou Operador Central podem registrar entradas.");
        }
        newCentralQuantity = currentCentralQtyCoerced + movementData.quantity;
        transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantity });
        console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): ENTRY - Update item ${itemDocRef.path}. New Central Qty: ${newCentralQuantity}`);
    } 
    else if (movementData.type === 'exit') { // Transfers FROM Central
        if (!(actorProfile.role === 'admin' || actorProfile.role === 'central_operator')) {
            throw new Error("Apenas Admin ou Operador Central podem registrar saídas/transferências.");
        }
        if (currentCentralQtyCoerced < movementData.quantity) {
            throw new Error(`Estoque insuficiente (${currentCentralQtyCoerced}) no Arm. Central para ${itemForRow.name}. Necessário: ${movementData.quantity}`);
        }
        newCentralQuantity = currentCentralQtyCoerced - movementData.quantity;
        transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantity });
        console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): EXIT - Update item ${itemDocRef.path}. New Central Qty: ${newCentralQuantity}`);

        if (isMovementToSpecificUnit && unitConfigDocRefPath) {
            const configRef = doc(firestore, unitConfigDocRefPath);
            const currentUnitQty = Number(unitConfigSnap?.data()?.currentQuantity) || 0;
            newUnitQuantity = currentUnitQty + movementData.quantity;
            transaction.set(configRef, { 
                itemId: movementData.itemId,
                unitId: movementData.unitId,
                hospitalId: targetHospital?.id,
                currentQuantity: newUnitQuantity,
                strategicStockLevel: Number(unitConfigSnap?.data()?.strategicStockLevel) || 0,
                minQuantity: Number(unitConfigSnap?.data()?.minQuantity) || 0,
            }, { merge: true });
            console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): EXIT to Unit - Set/Merge ${unitConfigDocRefPath}. New Unit Qty: ${newUnitQuantity}`);
        } else if (isMovementToUBSGeneralStock && ubsGeneralStockConfigDocRefPath) {
            const configRef = doc(firestore, ubsGeneralStockConfigDocRefPath);
            const currentUbsQty = Number(ubsGeneralStockConfigSnap?.data()?.currentQuantity) || 0;
            newUbsGeneralQuantity = currentUbsQty + movementData.quantity;
            transaction.set(configRef, {
                itemId: movementData.itemId,
                hospitalId: movementData.hospitalId, // Already checked that hospitalId exists
                currentQuantity: newUbsGeneralQuantity,
                strategicStockLevel: Number(ubsGeneralStockConfigSnap?.data()?.strategicStockLevel) || 0,
                minQuantity: Number(ubsGeneralStockConfigSnap?.data()?.minQuantity) || 0,
            }, { merge: true });
            console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): EXIT to UBS General - Set/Merge ${ubsGeneralStockConfigDocRefPath}. New UBS Qty: ${newUbsGeneralQuantity}`);
        }
        // If no hospitalId (direct 'baixa' from central), only central stock is affected above.
    } 
    else if (movementData.type === 'consumption') {
        if (actorProfile.role === 'admin' || actorProfile.role === 'central_operator') {
            // Admin/Central consuming (either directly from central or simulating unit consumption)
            if (!movementData.hospitalId && !movementData.unitId) { // Direct consumption from Central
                if (currentCentralQtyCoerced < movementData.quantity) {
                    throw new Error(`Estoque insuficiente (${currentCentralQtyCoerced}) no Arm. Central para ${itemForRow.name}. Necessário: ${movementData.quantity}`);
                }
                newCentralQuantity = currentCentralQtyCoerced - movementData.quantity;
                transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantity });
                console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): CONSUMPTION (Admin/Central from Central) - Update item ${itemDocRef.path}. New Central Qty: ${newCentralQuantity}`);
            } else if (isMovementToSpecificUnit && unitConfigDocRefPath) { // Simulating consumption from a specific unit
                 const configRef = doc(firestore, unitConfigDocRefPath);
                 const currentUnitQty = Number(unitConfigSnap?.data()?.currentQuantity) || 0;
                 if (currentUnitQty < movementData.quantity) {
                    throw new Error(`Estoque insuficiente (${currentUnitQty}) na unidade ${unitNameLog} para ${itemForRow.name}. Necessário: ${movementData.quantity}`);
                 }
                 newUnitQuantity = currentUnitQty - movementData.quantity;
                 transaction.update(configRef, { currentQuantity: newUnitQuantity });
                 console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): CONSUMPTION (Admin/Central from Unit) - Update ${unitConfigDocRefPath}. New Unit Qty: ${newUnitQuantity}`);
            } else if (isMovementToUBSGeneralStock && ubsGeneralStockConfigDocRefPath) { // Simulating consumption from UBS general
                 const configRef = doc(firestore, ubsGeneralStockConfigDocRefPath);
                 const currentUbsQty = Number(ubsGeneralStockConfigSnap?.data()?.currentQuantity) || 0;
                 if (currentUbsQty < movementData.quantity) {
                    throw new Error(`Estoque insuficiente (${currentUbsQty}) na UBS ${hospitalNameLog} para ${itemForRow.name}. Necessário: ${movementData.quantity}`);
                 }
                 newUbsGeneralQuantity = currentUbsQty - movementData.quantity;
                 transaction.update(configRef, { currentQuantity: newUbsGeneralQuantity });
                  console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): CONSUMPTION (Admin/Central from UBS General) - Update ${ubsGeneralStockConfigDocRefPath}. New UBS Qty: ${newUbsGeneralQuantity}`);
            } else {
                 throw new Error("Configuração de consumo inválida para Admin/Operador Central.");
            }
        } else if (actorProfile.role === 'hospital_operator' || actorProfile.role === 'ubs_operator') {
            // Consumption by Hospital/UBS operator from their assigned location
            if (!movementData.hospitalId || movementData.hospitalId !== actorProfile.associatedHospitalId) {
                throw new Error("Operador só pode consumir do seu hospital/UBS associado.");
            }

            let configPathForConsumption: string | undefined;
            let currentQtyInLocation: number;
            let stockSnapForConsumption: DocumentSnapshot | null = null;

            if (movementData.unitId) { // Consuming from a specific unit within their hospital
                if (actorProfile.associatedUnitId && movementData.unitId !== actorProfile.associatedUnitId) {
                    throw new Error("Operador só pode consumir da sua unidade específica associada.");
                }
                configPathForConsumption = unitConfigDocRefPath; // Should have been read if movementData.unitId is present
                stockSnapForConsumption = unitConfigSnap;
            } else if (actorProfile.role === 'ubs_operator' && !movementData.unitId) { // UBS operator consuming from general UBS stock
                configPathForConsumption = ubsGeneralStockConfigDocRefPath; // Should have been read
                stockSnapForConsumption = ubsGeneralStockConfigSnap;
            } else if (actorProfile.role === 'hospital_operator' && !actorProfile.associatedUnitId && !movementData.unitId) {
                 throw new Error("Operador de hospital (sem unidade específica) deve selecionar uma unidade para consumo.");
            }
             else {
                 throw new Error("Configuração de consumo inválida para operador de Hospital/UBS.");
            }

            if (!configPathForConsumption || !stockSnapForConsumption) {
                 throw new Error(`Configuração de estoque não encontrada para ${itemForRow.name} em ${unitNameLog || hospitalNameLog}.`);
            }
            
            currentQtyInLocation = Number(stockSnapForConsumption.data()?.currentQuantity) || 0;

            if (currentQtyInLocation < movementData.quantity) {
                throw new Error(`Estoque insuficiente (${currentQtyInLocation}) em ${unitNameLog || hospitalNameLog} para ${itemForRow.name}. Necessário: ${movementData.quantity}`);
            }
            const newQtyInLocation = currentQtyInLocation - movementData.quantity;
            transaction.update(doc(firestore, configPathForConsumption), { currentQuantity: newQtyInLocation });
            console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): CONSUMPTION (Hospital/UBS Op) - Update ${configPathForConsumption}. New Qty: ${newQtyInLocation}`);
        } else {
            throw new Error("Perfil de usuário não autorizado para esta operação de consumo.");
        }
    } else {
      throw new Error(`Tipo de movimentação inválido ou não tratado: ${movementData.type}`);
    }

    const patientDetailsForLog = movementData.patientId ? allPatientsMaster.find(p => p.id === movementData.patientId) : null;
    const movementLog: Partial<StockMovement> = {
        itemId: movementData.itemId, 
        itemName: itemForRow.name,
        type: movementData.type,
        quantity: movementData.quantity,
        date: movementData.date,
        notes: notesLog, 
        hospitalId: movementData.hospitalId, 
        hospitalName: hospitalNameLog, 
        unitId: movementData.unitId,
        unitName: unitNameLog, 
        patientId: movementData.patientId,
        patientName: patientDetailsForLog?.name, 
        userId: actorUserId,
        userDisplayName: actorDisplayName,
    };
    const movementLogClean = removeUndefinedFields(movementLog);
    transaction.set(doc(collection(firestore, "stockMovements")), movementLogClean as Omit<StockMovement, 'id'>);
    console.log(`TRANSACTION (L${rowIndex}, ${itemCodeForRow}): Log created. Movement:`, JSON.stringify(movementLogClean));
};


const BatchImportMovementsForm = ({ items, servedUnits, hospitals, patients, isLoadingDataFromParent }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], patients: Patient[], isLoadingDataFromParent: boolean }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { currentUserProfile, user: firebaseUser } = useAuth(); // Get current user

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const selectedFile = event.target.files[0];
      if (selectedFile.type === 'text/csv' || selectedFile.name.endsWith('.csv')) {
        setFile(selectedFile);
      } else {
        toast({
          title: "Tipo de Arquivo Inválido",
          description: "Por favor, selecione um arquivo .csv.",
          variant: "destructive",
        });
        setFile(null);
        if (event.target) event.target.value = ""; 
      }
    } else {
      setFile(null);
    }
  };

  const handleDownloadTemplate = () => {
    const BOM = "\uFEFF";
    const csvHeader = "Código do Item,Tipo,Quantidade,Data,Nome do Hospital Destino/Consumo,Nome da Unidade Destino/Consumo,Cartão SUS Paciente,Observações\n";
    const csvExampleRow1 = "ITEM001,entrada,100,2024-01-15,,,,,\n"; 
    const csvExampleRow2 = "ITEM002,saida,10,2024-01-16,Hospital Central,UTI Geral,,Transferência urgente\n";
    const csvExampleRow3 = "ITEM003,consumo,2,2024-01-17,UBS Vila Nova,Consultório 1,700123456789012,Consumo paciente Maria\n";
    const csvExampleRow4 = "ITEM001,saida,5,2024-01-18,UBS ABC,,,,Baixa para UBS ABC (geral)\n";


    const csvContent = BOM + csvHeader + csvExampleRow1 + csvExampleRow2 + csvExampleRow3 + csvExampleRow4;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "modelo_importacao_movimentacoes.csv");
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: "Download Iniciado", description: "O arquivo modelo_importacao_movimentacoes.csv está sendo baixado." });
    } else {
      toast({ title: "Erro no Download", description: "Seu navegador não suporta o download automático.", variant: "destructive" });
    }
  };

  const handleSubmit = async () => {
    if (!file) {
      toast({ title: "Erro", description: "Por favor, selecione um arquivo CSV para importar.", variant: "destructive" });
      return;
    }
    if (!currentUserProfile || !firebaseUser) {
        toast({ title: "Erro de Autenticação", description: "Usuário não autenticado. Não é possível importar.", variant: "destructive"});
        return;
    }
    if (!(currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator')) {
        toast({ title: "Permissão Negada", description: "Apenas Administradores ou Operadores do Almoxarifado Central podem importar movimentações em lote.", variant: "destructive"});
        return;
    }
    
    setIsProcessing(true);
    const reader = new FileReader();

    reader.onload = async (e) => {
      const csvText = e.target?.result as string;
      if (!csvText) {
        toast({ title: "Erro", description: "Não foi possível ler o arquivo.", variant: "destructive" });
        setIsProcessing(false);
        return;
      }

      Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const { data: rows, errors: parseErrors } = results;

          if (parseErrors.length > 0) {
            const errorMessages = parseErrors.map((err: Papa.ParseError, index: number) => {
              const rowInfo = typeof err.row === 'number' ? `Linha CSV ${err.row + 2} (dados linha ${err.row +1}): ` : `Erro genérico ${index + 1}: `;
              return `${rowInfo}${err.message || "Mensagem de erro não disponível"}`;
            });
            toast({ 
                title: "Erro ao Processar CSV", 
                description: <div className="max-h-60 overflow-y-auto text-xs">{errorMessages.map((msg, i) => <p key={i}>{msg}</p>)}</div>, 
                variant: "destructive", duration: 20000 
            });
            setIsProcessing(false); return;
          }
          if (rows.length === 0) {
            toast({ title: "Arquivo Vazio", description: "O arquivo CSV não contém dados.", variant: "destructive" });
            setIsProcessing(false); return;
          }

          let successfulImports = 0;
          const importErrors: string[] = [];

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowIndex = i + 2; 
            let itemCodeForRow = row["Código do Item"]?.trim() || "N/A"; 
            
            try {
                let typeStrSanitized = (row["Tipo"] || "").replace(/\s+/g, ' ').trim().toLowerCase();
                if (typeStrSanitized.charCodeAt(0) === 0xFEFF) typeStrSanitized = typeStrSanitized.substring(1);
                
                let mappedType: 'entry' | 'exit' | 'consumption';
                switch (typeStrSanitized) {
                    case 'entrada': mappedType = 'entry'; break;
                    case 'saida': mappedType = 'exit'; break;
                    case 'consumo': mappedType = 'consumption'; break;
                    default:
                        importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Tipo inválido ('${row["Tipo"]}'). Use 'entrada', 'saida' ou 'consumo'.`);
                        continue; 
                }
                
                const quantityStr = row["Quantidade"]?.trim();
                const dateStr = row["Data"]?.trim(); 
                const hospitalNameCsv = row["Nome do Hospital Destino/Consumo"]?.trim() || undefined; 
                const unitNameCsv = row["Nome da Unidade Destino/Consumo"]?.trim() || undefined; 
                const patientSUS = row["Cartão SUS Paciente"]?.trim() || undefined; 
                const notesCsv = row["Observações"]?.trim() || undefined; 

                if (!itemCodeForRow || itemCodeForRow === "N/A" || !quantityStr || !dateStr) {
                  importErrors.push(`Linha ${rowIndex}: Código do Item, Quantidade e Data são obrigatórios.`); continue;
                }
                const quantity = parseInt(quantityStr, 10);
                if (isNaN(quantity) || quantity <= 0) {
                  importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Quantidade inválida ('${quantityStr}').`); continue;
                }
                let formattedDate = dateStr;
                try {
                    const parsedDate = new Date(dateStr + "T00:00:00Z"); 
                    if (isNaN(parsedDate.getTime())) throw new Error("Data resultou em NaN.");
                     const [inputYear, inputMonth, inputDay] = dateStr.split('-').map(Number);
                    if (parsedDate.getUTCFullYear() !== inputYear || (parsedDate.getUTCMonth() + 1) !== inputMonth || parsedDate.getUTCDate() !== inputDay) {
                         throw new Error(`Data inválida (ex: dia inexistente para o mês).`);
                    }
                    formattedDate = parsedDate.toISOString().split('T')[0];
                } catch (dateParseError: any) {
                    importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Data inválida ('${dateStr}'). ${dateParseError.message}`); continue;
                }
                const item = items.find(it => it.code === itemCodeForRow);
                if (!item) {
                  importErrors.push(`Linha ${rowIndex}: Item '${itemCodeForRow}' não encontrado.`); continue;
                }

                let hospitalId: string | undefined = undefined;
                let unitId: string | undefined = undefined;
                let patientIdCsv: string | undefined = undefined;

                if (mappedType === 'exit' || mappedType === 'consumption') {
                    if (hospitalNameCsv) {
                        const selectedHospital = hospitals.find(h => h.name.toLowerCase() === hospitalNameCsv.toLowerCase());
                        if (!selectedHospital) {
                            importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Hospital '${hospitalNameCsv}' não encontrado.`); continue; 
                        }
                        hospitalId = selectedHospital.id;
                        const isTargetUBS = selectedHospital.name.toLowerCase().includes('ubs');

                        if (unitNameCsv) {
                            const selectedUnit = servedUnits.find(u => u.name.toLowerCase() === unitNameCsv.toLowerCase() && u.hospitalId === hospitalId);
                            if (!selectedUnit) {
                                importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Unidade '${unitNameCsv}' não encontrada ou não pertence a '${hospitalNameCsv}'.`); continue; 
                            }
                            unitId = selectedUnit.id;
                        } else { 
                             if (mappedType === 'consumption' && !isTargetUBS) { // Consumption in non-UBS needs unit
                                importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Unidade é obrigatória para 'consumo' em Hospital (não UBS) '${hospitalNameCsv}'.`); continue;
                             }
                             if (mappedType === 'exit' && !isTargetUBS) { // Exit to non-UBS needs unit
                                importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Unidade é obrigatória para 'saida' para Hospital (não UBS) '${hospitalNameCsv}'.`); continue;
                             }
                        }
                    }
                }
                if (mappedType === 'consumption' && patientSUS) {
                    const patient = patients.find(p => p.susCardNumber === patientSUS);
                    if (!patient) {
                        importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Paciente com Cartão SUS '${patientSUS}' não encontrado.`); continue;
                    }
                    patientIdCsv = patient.id;
                }
                
                const movementDataForTransaction = {
                    itemId: item.id, type: mappedType, quantity: quantity, date: formattedDate, 
                    hospitalId: hospitalId, unitId: unitId, patientId: patientIdCsv, notes: notesCsv,
                };
                
                try {
                    await runTransaction(firestore, (transaction) => 
                        processMovementRowTransaction(
                            transaction, movementDataForTransaction, item, rowIndex, itemCodeForRow,
                            items, hospitals, servedUnits, patients,
                            hospitalNameCsv, unitNameCsv, notesCsv,
                            currentUserProfile, firebaseUser.uid, firebaseUser.displayName || currentUserProfile.name
                        )
                    );
                    successfulImports++;
                } catch (transactionError: any) { 
                    importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Erro BD: ${transactionError.message}`);
                }
            } catch (syncError: any) { 
                importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Erro Prep: ${syncError.message}`);
            }
          } 

          if (importErrors.length > 0) {
            toast({
              title: `Erros na Importação (${importErrors.length} falhas de ${rows.length})`,
              description: <div className="max-h-60 overflow-y-auto text-xs">{importErrors.map((err, i) => <p key={i}>{err}</p>)}</div>,
              variant: "destructive", duration: successfulImports > 0 ? 15000 : 20000, 
            });
          }
          if (successfulImports > 0) {
            toast({
              title: "Importação Concluída",
              description: `${successfulImports} de ${rows.length} movimentaçõe(s) importada(s).`,
              variant: "default", duration: 10000,
            });
          }
          if (successfulImports === 0 && importErrors.length === 0 && rows.length > 0) { 
            toast({ title: "Nenhuma Movimentação Válida", description: "Nenhuma movimentação válida encontrada.", variant: "default" });
          }
          
          setIsProcessing(false);
          setFile(null);
          const fileInput = document.getElementById('batch-movements-file-input') as HTMLInputElement | null;
          if (fileInput) fileInput.value = "";
        },
        error: (err: any) => { 
          toast({ title: "Erro Crítico de Leitura do CSV", description: `Não foi possível processar: ${err.message}.`, variant: "destructive" });
          setIsProcessing(false);
        }
      });
    };
    reader.readAsText(file, 'UTF-8'); 
  };


  if (!(currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'central_operator')) {
    return (
        <Card className="shadow-lg">
            <CardHeader>
                <CardTitle className="font-headline text-orange-600 flex items-center gap-2">
                    <ShieldAlert className="h-6 w-6" /> Acesso Restrito
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p>A importação de movimentações em lote está disponível apenas para Administradores e Operadores do Almoxarifado Central.</p>
            </CardContent>
        </Card>
    );
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Movimentações em Lote</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo .csv. A primeira linha deve ser o cabeçalho.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
         <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha de Movimentações</AlertTitle>
            <AlertDescription>
              <p className="mb-2">Colunas (nesta ordem):</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Código do Item</code> (Obrigatório)</li>
                <li><code>Tipo</code> (Obrigatório - 'entrada', 'saida' ou 'consumo')</li>
                <li><code>Quantidade</code> (Obrigatório - Número positivo)</li>
                <li><code>Data</code> (Obrigatório - AAAA-MM-DD)</li>
                <li><code>Nome do Hospital Destino/Consumo</code> (Opcional/Condicional)</li>
                <li><code>Nome da Unidade Destino/Consumo</code> (Opcional/Condicional)</li>
                <li><code>Cartão SUS Paciente</code> (Opcional - 15 dígitos, para 'consumo')</li>
                <li><code>Observações</code> (Opcional)</li>
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                <strong>Notas sobre Hospitais/Unidades (para Saída/Consumo):</strong><br/>
                - Baixa/Consumo direto do Armazém Central: Deixe 'Nome do Hospital' e 'Nome da Unidade' em branco.<br/>
                - Transferência para UBS (geral): Preencha 'Nome do Hospital' (UBS), deixe 'Nome da Unidade' em branco.<br/>
                - Transferência para Hospital (não UBS) ou setor específico de UBS/Hospital: Preencha 'Nome do Hospital' e 'Nome da Unidade'.<br/>
                - Consumo em Hospital/UBS: Preencha 'Nome do Hospital' e 'Nome da Unidade' (para UBS, unidade é opcional se for consumo do estoque geral da UBS).
              </p>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Modelo (.csv)
              </Button>
            </AlertDescription>
          </Alert>

        <div className="grid w-full max-w-md items-center gap-2">
          <Label htmlFor="batch-movements-file-input">Arquivo CSV</Label>
          <Input
            id="batch-movements-file-input"
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="cursor-pointer file:cursor-pointer file:font-semibold file:text-primary"
            disabled={isProcessing || isLoadingDataFromParent}
          />
          {file && <p className="text-sm text-muted-foreground mt-2">Arquivo selecionado: {file.name}</p>}
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSubmit} disabled={!file || isProcessing || isLoadingDataFromParent}>
          {isLoadingDataFromParent ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando dados...</> 
           : isProcessing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando...</> 
           : <><Upload className="mr-2 h-4 w-4" /> Processar Planilha</>}
        </Button>
      </CardFooter>
    </Card>
  );
};


export default function StockMovementsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const { toast } = useToast();
  const [isLoadingData, setIsLoadingData] = useState(true);
  const { currentUserProfile } = useAuth();


  useEffect(() => {
    setIsLoadingData(true);
    const listeners = [
      { coll: "items", setter: setItems, msg: "Itens" },
      { coll: "hospitals", setter: setHospitals, msg: "Hospitais" },
      { coll: "servedUnits", setter: setServedUnits, msg: "Unidades Servidas" },
      { coll: "patients", setter: setPatients, msg: "Pacientes" },
    ];
    
    let loadedCount = 0;
    const unsubscribers: (()=>void)[] = [];

    listeners.forEach(config => {
      const q = query(collection(firestore, config.coll), orderBy("name", "asc"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        config.setter(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
        loadedCount++;
        if (loadedCount === listeners.length) setIsLoadingData(false);
      }, (error) => {
        console.error(`Erro ao buscar ${config.msg}: `, error);
        toast({ title: `Erro ao Carregar ${config.msg}`, variant: "destructive" });
        loadedCount++; 
        if (loadedCount === listeners.length) setIsLoadingData(false);
      });
      unsubscribers.push(unsubscribe);
    });
    
    return () => unsubscribers.forEach(unsub => unsub());
  }, [toast]);

  return (
    <div>
      <PageHeader title="Registrar Movimentação de Estoque" description="Registre entradas, saídas ou consumos de itens, manualmente ou via planilha." icon={ArrowRightLeft} />
      {isLoadingData || !currentUserProfile ? (
         <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-3 text-muted-foreground">Carregando dados e perfil do usuário...</p>
        </div>
      ) : (
      <Tabs defaultValue="manual" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-1/2 lg:w-1/3 mb-6">
          <TabsTrigger value="manual">
            Registrar Manualmente
          </TabsTrigger>
          <TabsTrigger value="import" disabled={!(currentUserProfile.role === 'admin' || currentUserProfile.role === 'central_operator')}>
            Importar Planilha CSV
          </TabsTrigger>
        </TabsList>
        <TabsContent value="manual">
            <ManualMovementForm items={items} servedUnits={servedUnits} hospitals={hospitals} patients={patients} />
        </TabsContent>
        <TabsContent value="import">
            <BatchImportMovementsForm 
                items={items} 
                servedUnits={servedUnits} 
                hospitals={hospitals} 
                patients={patients} 
                isLoadingDataFromParent={isLoadingData} // Pass the loading state
            />
        </TabsContent>
      </Tabs>
      )}
    </div>
  );
}
    
