
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
import { ArrowRightLeft, User, Loader2, Upload, Download } from 'lucide-react';
import type { Item, ServedUnit, Hospital, Patient, StockMovement } from '@/types';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { firestore } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, runTransaction, addDoc, getDocs, writeBatch } from 'firebase/firestore';
import Papa, { type ParseError } from 'papaparse';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";


const CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE = "CENTRAL_WAREHOUSE_DIRECT_EXIT";

const movementSchema = z.object({
  itemId: z.string().min(1, "A seleção do item é obrigatória."),
  type: z.enum(['entry', 'exit', 'consumption'], { required_error: "O tipo de movimentação é obrigatório." }),
  quantity: z.coerce.number().positive("A quantidade deve ser um número positivo."),
  hospitalId: z.string().optional(),
  unitId: z.string().optional(),
  patientId: z.string().optional(),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Data inválida." }),
  notes: z.string().optional(),
}).refine(data => {
  if ((data.type === 'exit' || data.type === 'consumption') &&
      data.hospitalId && data.hospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE &&
      !data.unitId) {
    return false;
  }
  return true;
}, {
  message: "Para Saída ou Consumo com um Hospital específico selecionado (que não seja baixa direta), a Unidade Servida também deve ser selecionada.",
  path: ["unitId"],
}).refine(data => {
  if ((data.type === 'exit' || data.type === 'consumption') &&
      data.hospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE &&
      data.unitId) {
    return false;
  }
  return true;
}, {
  message: "Unidade Servida não deve ser selecionada para Baixa/Consumo direto do Armazém Central.",
  path: ["unitId"],
});


type MovementFormData = z.infer<typeof movementSchema>;

const NO_PATIENT_ID = "__NO_PATIENT__";


const ManualMovementForm = ({ items, servedUnits, hospitals, patients }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], patients: Patient[] }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const form = useForm<MovementFormData>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      type: 'entry',
      quantity: 1,
      date: new Date().toISOString().split('T')[0],
      notes: '',
      hospitalId: undefined,
      unitId: undefined,
      patientId: undefined,
      itemId: undefined,
    },
  });

  const movementType = form.watch('type');
  const selectedHospitalId = form.watch('hospitalId');
  const selectedUnitId = form.watch('unitId');

  useEffect(() => {
    if (movementType === 'entry') {
        form.setValue('hospitalId', undefined);
        form.setValue('unitId', undefined);
        form.setValue('patientId', undefined);
    } else if (movementType === 'exit') {
        form.setValue('patientId', undefined); 
    }
  }, [movementType, form]);

   useEffect(() => {
    form.setValue('unitId', undefined, { shouldValidate: true });
  }, [selectedHospitalId, form]);


  const availableUnits = selectedHospitalId && selectedHospitalId !== CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE
    ? servedUnits.filter(unit => unit.hospitalId === selectedHospitalId)
    : [];

  const isConsumptionInUBS = () => {
    if (movementType !== 'consumption' || !selectedUnitId) return false;
    const unit = servedUnits.find(u => u.id === selectedUnitId);
    if (!unit) return false;
    const hospital = hospitals.find(h => h.id === unit.hospitalId);
    return hospital?.name.toLowerCase().includes('ubs') || false;
  };


  const onSubmit = async (data: MovementFormData) => {
    setIsSubmitting(true);
    
    let processedData = {...data};
    if (data.hospitalId === CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE) {
        processedData.hospitalId = undefined;
        processedData.unitId = undefined;
    }

    try {
      await runTransaction(firestore, async (transaction) => {
        const itemDocRef = doc(firestore, "items", processedData.itemId);
        let unitConfigDocRef = null;
        let unitConfigSnap = null;
        let unitConfigDocId = null;
        
        // READS FIRST
        const itemSnap = await transaction.get(itemDocRef);
        if (!itemSnap.exists()) {
          throw new Error("Item não encontrado no banco de dados.");
        }
        
        if ((processedData.type === 'exit' || processedData.type === 'consumption') && 
            processedData.hospitalId && processedData.unitId) {
          unitConfigDocId = `${processedData.itemId}_${processedData.unitId}`;
          unitConfigDocRef = doc(firestore, "stockConfigs", unitConfigDocId);
          unitConfigSnap = await transaction.get(unitConfigDocRef); 
        }
        
        // PREPARE WRITES
        const currentItemData = itemSnap.data() as Item;
        let newQuantityCentral = currentItemData.currentQuantityCentral;

        if (processedData.type === 'entry') {
          newQuantityCentral += processedData.quantity;
          transaction.update(itemDocRef, { currentQuantityCentral: newQuantityCentral });
        } else if (processedData.type === 'exit' || processedData.type === 'consumption') {
          if (processedData.hospitalId && processedData.unitId && unitConfigDocRef) { 
            if (newQuantityCentral < processedData.quantity) {
              throw new Error(`Estoque insuficiente (${newQuantityCentral}) no Armazém Central para ${currentItemData.name}. Necessário: ${processedData.quantity}`);
            }
            const newCentralQuantityAfterTransfer = newQuantityCentral - processedData.quantity;
            transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantityAfterTransfer });

            if (unitConfigSnap && unitConfigSnap.exists()) {
              const currentUnitConfigData = unitConfigSnap.data();
              const newUnitQuantity = (currentUnitConfigData.currentQuantity || 0) + processedData.quantity;
              transaction.update(unitConfigDocRef, { currentQuantity: newUnitQuantity });
            } else {
              const unitDetails = servedUnits.find(u => u.id === processedData.unitId);
              transaction.set(unitConfigDocRef, {
                itemId: processedData.itemId,
                unitId: processedData.unitId,
                hospitalId: unitDetails?.hospitalId || null, 
                currentQuantity: processedData.quantity,
                strategicStockLevel: 0, 
                minQuantity: 0, 
              });
            }
          } else if (!processedData.hospitalId && !processedData.unitId) { 
            if (newQuantityCentral < processedData.quantity) {
              throw new Error(`Estoque insuficiente (${newQuantityCentral}) no Armazém Central para ${currentItemData.name} para baixa/consumo direto. Necessário: ${processedData.quantity}`);
            }
            newQuantityCentral -= processedData.quantity;
            transaction.update(itemDocRef, { currentQuantityCentral: newQuantityCentral });
          } else {
            throw new Error("Configuração de saída/consumo inválida. Uma unidade é necessária se um hospital específico for selecionado (e não for baixa/consumo direto).");
          }
        }

        const itemDetailsForLog = items.find(i => i.id === processedData.itemId);
        const hospitalDetailsForLog = hospitals.find(h => h.id === processedData.hospitalId);
        const unitDetailsForLog = servedUnits.find(u => u.id === processedData.unitId);
        const patientDetailsForLog = patients.find(p => p.id === processedData.patientId);

        const movementLog: Omit<StockMovement, 'id'> = {
          itemId: processedData.itemId,
          itemName: itemDetailsForLog?.name || null,
          type: processedData.type,
          quantity: processedData.quantity,
          date: processedData.date,
          notes: processedData.notes || null,
          hospitalId: processedData.hospitalId || null,
          hospitalName: hospitalDetailsForLog?.name || null,
          unitId: processedData.unitId || null,
          unitName: unitDetailsForLog?.name || null,
          patientId: processedData.patientId || null,
          patientName: patientDetailsForLog?.name || null,
        };
        const stockMovementsCollectionRef = collection(firestore, "stockMovements");
        transaction.set(doc(stockMovementsCollectionRef), movementLog);
      });
      
      const item = items.find(i => i.id === processedData.itemId);
      const patient = processedData.patientId ? patients.find(p => p.id === processedData.patientId) : null;
      let description = `Movimentação de ${processedData.quantity} unidade(s) do item ${item?.name || processedData.itemId} registrada como ${processedData.type}.`;
      if (processedData.type !== 'entry') {
          const hospitalDesc = hospitals.find(h => h.id === processedData.hospitalId);
          const unitDesc = servedUnits.find(u => u.id === processedData.unitId);
          
          if (unitDesc && hospitalDesc) { 
              description += ` para ${unitDesc.name} (${hospitalDesc.name}).`;
          } else if (!processedData.hospitalId && !processedData.unitId) { 
              description += ` (Baixa/Consumo direto do Armazém Central).`;
          }
      }
      if (patient) {
        description += ` Paciente: ${patient.name}.`;
      }

      toast({
        title: "Movimentação de Estoque Registrada",
        description: description,
      });
      form.reset({
          type: 'entry',
          quantity: 1,
          date: new Date().toISOString().split('T')[0],
          notes: '',
          itemId: undefined,
          hospitalId: undefined,
          unitId: undefined,
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
  
  return (
      <Card className="max-w-2xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Nova Movimentação de Estoque</CardTitle>
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
                        defaultValue={field.value}
                        className="flex flex-col space-y-1 md:flex-row md:space-y-0 md:space-x-4"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="entry" /></FormControl>
                          <FormLabel className="font-normal">Entrada (Armazém Central)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="exit" /></FormControl>
                          <FormLabel className="font-normal">Saída (Transferência/Baixa)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl><RadioGroupItem value="consumption" /></FormControl>
                          <FormLabel className="font-normal">Consumo (Unidade Servida)</FormLabel>
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
                            value={field.value ?? CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE} 
                        >
                          <FormControl><SelectTrigger><SelectValue placeholder="Selecione um hospital ou baixa direta" /></SelectTrigger></FormControl>
                          <SelectContent>
                             <SelectItem value={CENTRAL_WAREHOUSE_DIRECT_EXIT_VALUE}>Nenhum (Baixa/Consumo direto do Armazém Central)</SelectItem>
                            {hospitals.map(hospital => <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                         <FormDescription>
                            {movementType === 'exit' && "Para transferir para uma unidade, selecione o hospital. Para baixa direta do Armazém Central, escolha 'Nenhum'."}
                            {movementType === 'consumption' && "Selecione o hospital onde o item foi consumido. Se o consumo foi direto do Armazém Central, escolha 'Nenhum'."}
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
                            disabled={!selectedHospitalId || availableUnits.length === 0}
                          >
                            <FormControl><SelectTrigger>
                                <SelectValue placeholder={availableUnits.length > 0 ? "Selecione uma unidade" : "Nenhuma unidade para este hospital"} />
                            </SelectTrigger></FormControl>
                            <SelectContent>
                              {availableUnits.map(unit => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                           <FormDescription>
                                {movementType === 'exit' && "Unidade para a qual o item está sendo transferido."}
                                {movementType === 'consumption' && "Unidade onde o item foi consumido."}
                           </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {movementType === 'consumption' && selectedUnitId && isConsumptionInUBS() && (
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
                            <FormDescription>Selecione o paciente se o consumo for individualizado (comum em UBS).</FormDescription>
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


const BatchImportMovementsForm = ({ items, servedUnits, hospitals, patients, isLoadingDataFromParent }: { items: Item[], servedUnits: ServedUnit[], hospitals: Hospital[], patients: Patient[], isLoadingDataFromParent: boolean }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

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
    const csvExampleRow4 = "ITEM001,saida,5,2024-01-18,,,,Baixa por ajuste de inventário\n";


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
    
    setIsProcessing(true);
    console.log("BATCH IMPORT: Iniciando processamento do CSV...");
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
          console.log("BATCH IMPORT: PapaParse 'complete' callback iniciado.");
          const { data: rows, errors: parseErrors } = results;

          if (parseErrors.length > 0) {
            console.error("BATCH IMPORT: Erros de parsing do CSV (objetos completos):", JSON.stringify(parseErrors, null, 2));
            const errorMessages = parseErrors.map((err: Papa.ParseError, index: number) => {
              const rowInfo = typeof err.row === 'number' ? `Linha CSV ${err.row + 2} (dados linha ${err.row +1}): ` : `Erro genérico ${index + 1}: `;
              const message = err.message || "Mensagem de erro não disponível";
              const type = err.type ? ` (Tipo: ${err.type}` : "";
              const code = err.code ? `, Código: ${err.code})` : (type ? ")" : "");
              return `${rowInfo}${message}${type}${code}`;
            });
            toast({ 
                title: "Erro ao Processar CSV", 
                description: (
                    <div className="max-h-60 overflow-y-auto text-xs">
                        <p className="font-semibold mb-1">Houve {parseErrors.length} erro(s) ao ler o arquivo:</p>
                        {errorMessages.map((msg, i) => <p key={i}>{msg}</p>)}
                        <p className="mt-2">Verifique o console para mais detalhes técnicos e o formato JSON dos erros.</p>
                    </div>
                ), 
                variant: "destructive",
                duration: 20000 
            });
            setIsProcessing(false);
            console.log("BATCH IMPORT: Processamento interrompido devido a erros de parsing.");
            return;
          }
          if (rows.length === 0) {
            toast({ title: "Arquivo Vazio", description: "O arquivo CSV não contém dados.", variant: "destructive" });
            setIsProcessing(false);
            console.log("BATCH IMPORT: Arquivo CSV vazio.");
            return;
          }

          let successfulImports = 0;
          const importErrors: string[] = [];
          console.log(`BATCH IMPORT: Iniciando processamento de ${rows.length} linhas do CSV.`);

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowIndex = i + 2; 
            let itemCodeForRow = "N/A"; 
            console.log(`BATCH IMPORT: Linha ${rowIndex} do CSV:`, JSON.stringify(row));

            try {
                const itemCode = row["Código do Item"]?.trim();
                itemCodeForRow = itemCode || "N/A";
                
                let typeStrRaw = row["Tipo"];
                let typeStr: string;

                if (typeof typeStrRaw === 'string') {
                    if (typeStrRaw.charCodeAt(0) === 0xFEFF) { // BOM Check
                        console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): BOM detectado e removido do início da string de tipo: '${typeStrRaw}'`);
                        typeStrRaw = typeStrRaw.substring(1);
                    }
                    typeStr = typeStrRaw.replace(/\s+/g, ' ').trim().toLowerCase();
                } else {
                    typeStr = ""; // Handle cases where type is undefined or not a string
                    console.warn(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): Campo 'Tipo' está indefinido ou não é uma string.`);
                }
                
                console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): Tipo lido (original): '${row["Tipo"]}', Sanitizado: '${typeStr}', Tipo JS: ${typeof typeStr}`);
                if (typeStr) {
                  console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): typeStr length: ${typeStr.length}`);
                  for (let k = 0; k < typeStr.length; k++) {
                    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): CHAR_CODE_LOG charCodeAt(${k}) ('${typeStr[k]}'): ${typeStr.charCodeAt(k)}`);
                  }
                }


                const quantityStr = row["Quantidade"]?.trim();
                const dateStr = row["Data"]?.trim(); 
                const hospitalNameCsv = row["Nome do Hospital Destino/Consumo"]?.trim();
                const unitNameCsv = row["Nome da Unidade Destino/Consumo"]?.trim();
                const patientSUS = row["Cartão SUS Paciente"]?.trim();
                const notesCsv = row["Observações"]?.trim();

                if (!itemCode || !quantityStr || !dateStr) {
                  importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Código do Item, Quantidade e Data são obrigatórios.`);
                  console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - campos obrigatórios (item, qtd, data). Item: ${itemCodeForRow}`);
                  continue;
                }
                
                if (!typeStr) { 
                    importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Tipo de movimentação é obrigatório.`);
                    console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - tipo está vazio ou undefined. Item: ${itemCodeForRow}`);
                    continue;
                }

                const isValidType = typeStr === 'entrada' || typeStr === 'saida' || typeStr === 'consumo';
                if (!isValidType) {
                    importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Tipo de movimentação inválido ('${row["Tipo"] || 'VAZIO'}'). Use 'entrada', 'saida' ou 'consumo'.`);
                    console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - tipo não corresponde. Item: ${itemCodeForRow}, Tipo CSV Original: '${row["Tipo"]}', Tipo Processado Final: '${typeStr}'`);
                     if (typeStr) { 
                        let charCodeLog = "";
                        for (let k = 0; k < typeStr.length; k++) {
                            charCodeLog += `(${typeStr[k]}: ${typeStr.charCodeAt(k)}) `;
                        }
                        console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): FAILED_TYPE_VALIDATION char codes: ${charCodeLog}`);
                    }
                    continue;
                }


                const quantity = parseInt(quantityStr, 10);
                if (isNaN(quantity) || quantity <= 0) {
                  importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Quantidade inválida ('${quantityStr}'). Deve ser um número positivo.`);
                  console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - quantidade inválida. Item: ${itemCodeForRow}, Qtd: ${quantityStr}`);
                  continue;
                }
                if (isNaN(Date.parse(dateStr))) {
                    importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Data inválida ('${dateStr}'). Use o formato AAAA-MM-DD.`);
                    console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - data inválida. Item: ${itemCodeForRow}, Data: ${dateStr}`);
                    continue;
                }

                const item = items.find(it => it.code === itemCode);
                if (!item) {
                  importErrors.push(`Linha ${rowIndex}: Item com código '${itemCode}' não encontrado.`);
                  console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - item não encontrado. Código: ${itemCodeForRow}`);
                  continue;
                }

                let hospitalId: string | undefined = undefined;
                let unitId: string | undefined = undefined;
                let patientId: string | undefined = undefined;
                let selectedHospital: Hospital | undefined = undefined;
                let selectedUnit: ServedUnit | undefined = undefined;

                if (typeStr === 'saida' || typeStr === 'consumo') {
                    if (hospitalNameCsv) {
                        selectedHospital = hospitals.find(h => h.name.toLowerCase() === hospitalNameCsv.toLowerCase());
                        if (!selectedHospital) {
                            importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Hospital '${hospitalNameCsv}' não encontrado.`);
                            console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - hospital não encontrado. Hospital CSV: ${hospitalNameCsv}`);
                            continue; 
                        }
                        hospitalId = selectedHospital.id;

                        if (unitNameCsv) {
                            selectedUnit = servedUnits.find(u => u.name.toLowerCase() === unitNameCsv.toLowerCase() && u.hospitalId === hospitalId);
                            if (!selectedUnit) {
                                importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Unidade '${unitNameCsv}' não encontrada ou não pertence ao hospital '${hospitalNameCsv}'.`);
                                console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - unidade não encontrada/não pertence. Unidade CSV: ${unitNameCsv}, Hospital: ${hospitalNameCsv}`);
                                continue; 
                            }
                            unitId = selectedUnit.id;
                        } else { 
                             importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Nome da Unidade é obrigatório se o Nome do Hospital ('${hospitalNameCsv}') for especificado para tipo '${typeStr}'. Para baixa direta do armazém, deixe ambos em branco.`);
                             console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - unidade obrigatória não fornecida. Hospital CSV: ${hospitalNameCsv}, Tipo: ${typeStr}`);
                             continue;
                        }
                    } 
                }
                
                if (typeStr === 'consumo' && patientSUS) {
                    const patient = patients.find(p => p.susCardNumber === patientSUS);
                    if (!patient) {
                        importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Paciente com Cartão SUS '${patientSUS}' não encontrado.`);
                        console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - paciente não encontrado. SUS: ${patientSUS}`);
                        continue;
                    }
                    patientId = patient.id;
                }
                
                const movementData: MovementFormData = {
                    itemId: item.id,
                    type: typeStr as MovementFormData['type'], 
                    quantity: quantity,
                    date: dateStr, // Deve ser AAAA-MM-DD
                    hospitalId: hospitalId,
                    unitId: unitId,
                    patientId: patientId,
                    notes: notesCsv,
                };

                console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): PRÉ-TRANSAÇÃO - Dados para movimentação:`, JSON.stringify(movementData));
                
                try {
                    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): Iniciando runTransaction.`);
                    await runTransaction(firestore, async (transaction) => {
                        console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): DENTRO da transação Firestore.`);
                        const itemDocRef = doc(firestore, "items", movementData.itemId);
                        let unitConfigDocRef = null;
                        let unitConfigSnap = null;
                        let unitConfigDocId = null;
                        
                        const itemSnap = await transaction.get(itemDocRef); 
                        if (!itemSnap.exists()) {
                            console.error(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION ERROR - Item ${item.name} (ID: ${movementData.itemId}) não encontrado na transação.`);
                            throw new Error(`Item ${item.name} não encontrado na transação (linha ${rowIndex}).`);
                        }
                        
                        const currentItemData = itemSnap.data() as Item;
                        let newQuantityCentral = currentItemData.currentQuantityCentral;
                        console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION - Item ${item.name}, Qtde Central ATUAL: ${newQuantityCentral}. Movimentação: ${movementData.quantity}`);

                        if ((movementData.type === 'exit' || movementData.type === 'consumption') && movementData.hospitalId && movementData.unitId) {
                            unitConfigDocId = `${movementData.itemId}_${movementData.unitId}`;
                            unitConfigDocRef = doc(firestore, "stockConfigs", unitConfigDocId);
                            console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION - Verificando config unidade ${unitConfigDocRef.path}.`);
                            unitConfigSnap = await transaction.get(unitConfigDocRef); 
                        }


                        if (movementData.type === 'entry') {
                            newQuantityCentral += movementData.quantity;
                            console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION - Tipo ENTRADA. Atualizando item ${itemDocRef.path}. Old Central Qty: ${currentItemData.currentQuantityCentral}. New Central Qty: ${newQuantityCentral}`);
                            transaction.update(itemDocRef, { currentQuantityCentral: newQuantityCentral });
                        } else if (movementData.type === 'exit' || movementData.type === 'consumption') {
                            if (movementData.hospitalId && movementData.unitId && unitConfigDocRef) { 
                                if (newQuantityCentral < movementData.quantity) {
                                    console.error(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION ERROR - Estoque insuficiente no Arm. Central. Item: ${item.name}, Atual: ${newQuantityCentral}, Necessário: ${movementData.quantity}`);
                                    throw new Error(`Estoque insuficiente (${newQuantityCentral}) no Arm. Central para ${item.name} (necessário: ${movementData.quantity}) (linha ${rowIndex})`);
                                }
                                
                                const newCentralQuantityAfterTransfer = newQuantityCentral - movementData.quantity;
                                console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION - Tipo SAIDA/CONSUMO (para Unidade). Atualizando item ${itemDocRef.path}. Old Central Qty: ${currentItemData.currentQuantityCentral}. New Central Qty: ${newCentralQuantityAfterTransfer}`);
                                transaction.update(itemDocRef, { currentQuantityCentral: newCentralQuantityAfterTransfer });

                                if (unitConfigSnap && unitConfigSnap.exists()) {
                                    const currentUnitConfigData = unitConfigSnap.data();
                                    const oldUnitQty = currentUnitConfigData.currentQuantity || 0;
                                    const newUnitQuantity = oldUnitQty + movementData.quantity;
                                    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION - Atualizando Unit Config ${unitConfigDocRef.path}. Old Unit Qty: ${oldUnitQty}. New Unit Qty: ${newUnitQuantity}`);
                                    transaction.update(unitConfigDocRef, { currentQuantity: newUnitQuantity });
                                } else { 
                                    const unitDetails = servedUnits.find(u => u.id === movementData.unitId);
                                    const dataToSet = {
                                        itemId: movementData.itemId,
                                        unitId: movementData.unitId,
                                        hospitalId: unitDetails?.hospitalId || null,
                                        currentQuantity: movementData.quantity,
                                        strategicStockLevel: 0, 
                                        minQuantity: 0, 
                                    };
                                    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION - Setting new Unit Config ${unitConfigDocRef.path}. New Unit Qty: ${movementData.quantity}. Data:`, JSON.stringify(dataToSet));
                                    transaction.set(unitConfigDocRef, dataToSet);
                                }
                            } else if (!movementData.hospitalId && !movementData.unitId) { 
                                if (newQuantityCentral < movementData.quantity) {
                                    console.error(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION ERROR - Estoque insuficiente (baixa direta). Item: ${item.name}, Atual: ${newQuantityCentral}, Necessário: ${movementData.quantity}`);
                                    throw new Error(`Estoque insuficiente (${newQuantityCentral}) no Arm. Central para ${item.name} (necessário: ${movementData.quantity}) (linha ${rowIndex})`);
                                }
                                const oldCentralQty = currentItemData.currentQuantityCentral;
                                newQuantityCentral -= movementData.quantity;
                                console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION - Tipo SAIDA/CONSUMO (Direto Arm. Central). Atualizando item ${itemDocRef.path}. Old Central Qty: ${oldCentralQty}. New Central Qty: ${newQuantityCentral}`);
                                transaction.update(itemDocRef, { currentQuantityCentral: newQuantityCentral });
                            } else {
                                console.error(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION ERROR - Configuração de saída/consumo inválida.`);
                                throw new Error(`Configuração de saída/consumo inválida na planilha (linha ${rowIndex}). Hospital/Unidade inconsistente.`);
                            }
                        }
                        
                        const patientDetailsForLog = patientId ? patients.find(p => p.id === patientId) : null;
                        const movementLog: Omit<StockMovement, 'id'> = {
                            itemId: item.id, 
                            itemName: item.name || null,
                            type: movementData.type, 
                            quantity: movementData.quantity, 
                            date: movementData.date,
                            notes: movementData.notes || null,
                            hospitalId: movementData.hospitalId || null,
                            hospitalName: selectedHospital?.name || null,
                            unitId: movementData.unitId || null,
                            unitName: selectedUnit?.name || null,
                            patientId: movementData.patientId || null,
                            patientName: patientDetailsForLog?.name || null,
                        };
                        console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): TRANSACTION - Criando log de movimentação:`, JSON.stringify(movementLog));
                        transaction.set(doc(collection(firestore, "stockMovements")), movementLog);
                        console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): DENTRO DA TRANSAÇÃO - Todas as operações da transação foram adicionadas. Preparando para commit implícito.`);
                    });
                    successfulImports++;
                    console.log(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): PÓS-TRANSAÇÃO - runTransaction CONCLUÍDO com sucesso (resolved). successfulImports: ${successfulImports}`);
                } catch (transactionError: any) { 
                    console.error(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): ERRO NA TRANSAÇÃO - `, transactionError.message, transactionError.stack);
                    importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Erro ao processar no banco: ${transactionError.message}`);
                }

            } catch (syncError: any) { 
                console.error(`BATCH IMPORT: Linha ${rowIndex} (${itemCodeForRow}): Erro de preparação/validação da linha - `, syncError.message, syncError.stack);
                importErrors.push(`Linha ${rowIndex} (${itemCodeForRow}): Erro de preparação/validação - ${syncError.message}`);
            }
          } 
          console.log("BATCH IMPORT: Processamento de todas as linhas concluído.");

          if (importErrors.length > 0) {
            toast({
              title: `Erros na Importação (${importErrors.length} falhas de ${rows.length} linhas)`,
              description: (
                <div className="max-h-60 overflow-y-auto text-xs">
                  {importErrors.map((err, i) => <p key={i}>{err}</p>)}
                </div>
              ),
              variant: "destructive",
              duration: successfulImports > 0 ? 15000 : 20000, 
            });
          }
          if (successfulImports > 0) {
            toast({
              title: "Importação Parcial/Total Concluída",
              description: `${successfulImports} de ${rows.length} movimentaçõe(s) importada(s) com sucesso.`,
              variant: "default",
              duration: 10000,
            });
          }
          if (successfulImports === 0 && importErrors.length === 0 && rows.length > 0) { 
            toast({ title: "Nenhuma Movimentação Válida", description: "Nenhuma movimentação válida encontrada na planilha ou todas falharam na validação inicial.", variant: "default" });
          }
          
          setIsProcessing(false);
          console.log("BATCH IMPORT: Estado isProcessing definido como false.");
          setFile(null);
          const fileInput = document.getElementById('batch-movements-file-input') as HTMLInputElement | null;
          if (fileInput) fileInput.value = "";
        },
        error: (err) => { 
          toast({ title: "Erro Crítico de Leitura do CSV", description: `Não foi possível processar o arquivo CSV: ${err.message}. Verifique o formato do arquivo e o console.`, variant: "destructive" });
          console.error("BATCH IMPORT: Erro crítico de parsing PapaParse:", err);
          setIsProcessing(false);
        }
      });
    };
    reader.readAsText(file, 'UTF-8'); 
  };


  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Movimentações em Lote</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo .csv contendo os dados das movimentações.
          A primeira linha da planilha deve ser o cabeçalho.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
         <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha de Movimentações</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Sua planilha CSV deve ter as seguintes colunas, nesta ordem:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Código do Item</code> (Texto, Obrigatório)</li>
                <li><code>Tipo</code> (Texto, Obrigatório - 'entrada', 'saida' ou 'consumo')</li>
                <li><code>Quantidade</code> (Número, Obrigatório - Positivo)</li>
                <li><code>Data</code> (Data AAAA-MM-DD, Obrigatório)</li>
                <li><code>Nome do Hospital Destino/Consumo</code> (Texto, Opcional/Condicional - Veja notas abaixo)</li>
                <li><code>Nome da Unidade Destino/Consumo</code> (Texto, Opcional/Condicional - Veja notas abaixo)</li>
                <li><code>Cartão SUS Paciente</code> (Texto, Opcional - 15 dígitos numéricos)</li>
                <li><code>Observações</code> (Texto, Opcional)</li>
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                <strong>Notas sobre Hospitais/Unidades:</strong><br/>
                - Para <strong>entrada</strong>: Deixe 'Nome do Hospital' e 'Nome da Unidade' em branco (entrada é sempre no Armazém Central).<br/>
                - Para <strong>saida</strong> ou <strong>consumo</strong> que seja uma <strong>baixa direta do Armazém Central</strong>: Deixe 'Nome do Hospital' e 'Nome da Unidade' em branco.<br/>
                - Para <strong>saida</strong> (transferência) ou <strong>consumo</strong> em uma <strong>unidade específica</strong>: Preencha 'Nome do Hospital' e 'Nome da Unidade'. O nome do hospital e da unidade devem corresponder exatamente aos cadastrados no sistema.
              </p>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Planilha Modelo (.csv)
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
          {isLoadingDataFromParent ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando dados...
            </>
          ) : isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" /> Processar Planilha
            </>
          )}
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
      <Tabs defaultValue="manual" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-1/2 lg:w-1/3 mb-6">
          <TabsTrigger value="manual" disabled={isLoadingData}>
            {isLoadingData && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Registrar Manualmente
          </TabsTrigger>
          <TabsTrigger value="import" disabled={isLoadingData}>
            {isLoadingData && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Importar Planilha CSV
          </TabsTrigger>
        </TabsList>
        <TabsContent value="manual">
          {isLoadingData ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Carregando dados para o formulário...</p>
            </div>
          ) : (
            <ManualMovementForm items={items} servedUnits={servedUnits} hospitals={hospitals} patients={patients} />
          )}
        </TabsContent>
        <TabsContent value="import">
         {isLoadingData ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-muted-foreground">Carregando dados de referência para importação...</p>
            </div>
          ) : (
            <BatchImportMovementsForm 
                items={items} 
                servedUnits={servedUnits} 
                hospitals={hospitals} 
                patients={patients} 
                isLoadingDataFromParent={isLoadingData}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
    

