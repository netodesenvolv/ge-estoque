
'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import PatientForm from '@/components/forms/PatientForm';
import { UserPlus, Upload, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Papa, { type ParseError, type ParseResult } from 'papaparse';
import { firestore } from '@/lib/firebase';
import { collection, writeBatch, doc, onSnapshot, query, orderBy } from 'firebase/firestore';
import type { Patient, Hospital, PatientSex } from '@/types';

const BATCH_SIZE = 400; // Firestore batch limit is 500, using 400 for safety

const BatchImportPatientForm = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [ubsList, setUbsList] = useState<Hospital[]>([]);
  const [isLoadingHospitals, setIsLoadingHospitals] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    setIsLoadingHospitals(true);
    const hospitalsCollectionRef = collection(firestore, "hospitals");
    const q = query(hospitalsCollectionRef, orderBy("name", "asc"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const allHospitalsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital));
      setHospitals(allHospitalsData);
      setUbsList(allHospitalsData.filter(h => h.name.toLowerCase().includes('ubs')));
      setIsLoadingHospitals(false);
    }, (error) => {
      console.error("Erro ao buscar hospitais/UBSs: ", error);
      toast({
        title: "Erro ao Carregar Hospitais/UBSs",
        description: "Não foi possível carregar a lista de hospitais/UBSs para validação.",
        variant: "destructive",
      });
      setIsLoadingHospitals(false);
    });
    return () => unsubscribe();
  }, [toast]);


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

  const handleSubmit = async () => {
    console.log("BATCH IMPORT: Botão 'Processar Planilha' clicado.");
    if (!file) {
      toast({ title: "Erro", description: "Por favor, selecione um arquivo CSV para importar.", variant: "destructive" });
      return;
    }
    if (isLoadingHospitals) {
      toast({ title: "Aguarde", description: "A lista de UBSs ainda está carregando. Tente novamente em alguns segundos.", variant: "default" });
      return;
    }

    setIsProcessing(true);
    console.log("BATCH IMPORT: Iniciando handleSubmit. isProcessing definido como true.");
    const reader = new FileReader();

    reader.onload = async (e) => {
      console.log("BATCH IMPORT: FileReader onload triggered.");
      const csvText = e.target?.result as string;
      if (!csvText) {
        toast({ title: "Erro", description: "Não foi possível ler o arquivo.", variant: "destructive" });
        setIsProcessing(false);
        console.error("BATCH IMPORT: csvText is null or undefined.");
        return;
      }

      Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
        delimiter: ",", 
        complete: async (results: ParseResult<Record<string, string>>) => {
          console.log("BATCH IMPORT: PapaParse 'complete' callback iniciado.");
          const { data, errors: parseErrors, meta } = results;
           console.log("BATCH IMPORT: Delimitador detectado/usado:", meta.delimiter);
           console.log("BATCH IMPORT: Quebra de linha detectada/usada:", meta.linebreak);
           console.log("BATCH IMPORT: Cabeçalhos lidos:", meta.fields);

          if (parseErrors.length > 0) {
            console.error("BATCH IMPORT: Erros de parsing do CSV (objetos completos):", JSON.stringify(parseErrors, null, 2));
            const errorMessages = parseErrors.map((err: Papa.ParseError) => {
                 const rowInfo = typeof err.row === 'number' ? `Linha CSV ${err.row + 2} (dados linha ${err.row +1}): ` : `Erro: `;
                 let specificAdvice = "";
                 if (err.code === "TooFewFields" || err.code === "TooManyFields") {
                    specificAdvice = `Esperados ${meta.fields?.length || 'N/A'} campos. Verifique o número de vírgulas na linha.`;
                 }
                 return `${rowInfo}${err.message}. ${specificAdvice}`;
            });
            toast({
              title: "Erro ao Processar CSV",
              description: (
                <div className="max-h-60 overflow-y-auto text-xs">
                  <p className="font-semibold mb-1">Houve {parseErrors.length} erro(s) ao ler o arquivo:</p>
                  {errorMessages.map((msg, i) => <p key={i}>{msg}</p>)}
                  <p className="mt-2">Verifique o console para mais detalhes técnicos.</p>
                </div>
              ),
              variant: "destructive",
              duration: 15000,
            });
            setIsProcessing(false);
            console.log("BATCH IMPORT: Processamento interrompido devido a erros de parsing.");
            return;
          }

          if (data.length === 0) {
            toast({ title: "Arquivo Vazio", description: "O arquivo CSV não contém dados.", variant: "destructive" });
            setIsProcessing(false);
            console.log("BATCH IMPORT: Arquivo CSV vazio.");
            return;
          }

          const patientsCollectionRef = collection(firestore, "patients");
          let currentBatch = writeBatch(firestore);
          let operationsInCurrentBatch = 0;
          let totalValidPatientsProcessed = 0;
          const importErrors: string[] = [];
          console.log(`BATCH IMPORT: Iniciando processamento de ${data.length} linhas do CSV. Tamanho do lote: ${BATCH_SIZE}`);

          for (let index = 0; index < data.length; index++) {
            const row = data[index];
            const rowIndex = index + 2; 
            console.log(`BATCH IMPORT: Processando linha ${rowIndex} do CSV:`, JSON.stringify(row));
            try {
                const name = row["Nome Completo"]?.trim();
                const susCardNumber = row["Número do Cartão SUS"]?.trim();
                const birthDateStr = row["Data de Nascimento"]?.trim();
                const address = row["Endereço"]?.trim();
                const phone = row["Telefone"]?.trim();
                const sexStr = row["Sexo"]?.trim().toLowerCase();
                const healthAgentName = row["Agente de Saúde"]?.trim();
                const registeredUBSNameCsv = row["Nome da UBS de Cadastro"]?.trim();

                if (!name || !susCardNumber) {
                  importErrors.push(`Linha ${rowIndex}: Nome Completo e Número do Cartão SUS são obrigatórios.`);
                  console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - Nome ou SUS obrigatórios. Nome: ${name}, SUS: ${susCardNumber}`);
                  continue; 
                }

                if (!/^\d{15}$/.test(susCardNumber)) {
                  importErrors.push(`Linha ${rowIndex}: Número do Cartão SUS inválido ('${susCardNumber}'). Deve conter 15 dígitos numéricos.`);
                  console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - Formato do SUS inválido. SUS: ${susCardNumber}`);
                  continue;
                }

                const patientPayload: Partial<Omit<Patient, 'id'>> = {
                  name: name,
                  name_lowercase: name.toLowerCase(),
                  susCardNumber: susCardNumber,
                };
                
                if (birthDateStr) {
                    let parsedDate: Date | null = null;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(birthDateStr)) { 
                        parsedDate = new Date(birthDateStr + 'T00:00:00Z'); 
                    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(birthDateStr)) { 
                        const parts = birthDateStr.split('/');
                        parsedDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`);
                    } else if (/^\d{2}-\d{2}-\d{4}$/.test(birthDateStr)) { 
                        const parts = birthDateStr.split('-');
                        parsedDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`);
                    }

                    if (parsedDate && !isNaN(parsedDate.getTime())) {
                        const year = parsedDate.getUTCFullYear();
                        const month = (parsedDate.getUTCMonth() + 1).toString().padStart(2, '0');
                        const day = parsedDate.getUTCDate().toString().padStart(2, '0');
                        patientPayload.birthDate = `${year}-${month}-${day}`;
                         console.log(`BATCH IMPORT: Linha ${rowIndex}: Data de Nascimento processada: ${birthDateStr} -> ${patientPayload.birthDate}`);
                    } else {
                        importErrors.push(`Linha ${rowIndex}: Data de Nascimento inválida ('${birthDateStr}'). Use AAAA-MM-DD, DD/MM/AAAA ou DD-MM-AAAA, ou deixe em branco.`);
                        console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - Data de Nascimento inválida. Data: ${birthDateStr}`);
                        continue;
                    }
                }
                if (address) patientPayload.address = address;
                if (phone) patientPayload.phone = phone;

                if (sexStr) {
                  if (['masculino', 'feminino', 'outro', 'ignorado'].includes(sexStr)) {
                    patientPayload.sex = sexStr as PatientSex;
                  } else {
                    importErrors.push(`Linha ${rowIndex}: Sexo inválido ('${row["Sexo"]}'). Use 'masculino', 'feminino', 'outro' ou 'ignorado'.`);
                    console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - Sexo inválido. Sexo: ${row["Sexo"]}`);
                    continue;
                  }
                }
                if (healthAgentName) patientPayload.healthAgentName = healthAgentName;
                
                if (registeredUBSNameCsv) {
                  const ubs = ubsList.find(u => u.name.toLowerCase() === registeredUBSNameCsv.toLowerCase());
                  if (ubs) {
                    patientPayload.registeredUBSId = ubs.id;
                    patientPayload.registeredUBSName = ubs.name;
                  } else {
                    importErrors.push(`Linha ${rowIndex}: UBS de Cadastro '${registeredUBSNameCsv}' não encontrada. Verifique o nome ou cadastre a UBS primeiro.`);
                    console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - UBS não encontrada. UBS CSV: ${registeredUBSNameCsv}`);
                    continue;
                  }
                }
                
                console.log(`BATCH IMPORT: Linha ${rowIndex}: Dados do paciente validados e prontos para batch:`, JSON.stringify(patientPayload));

                const newDocRef = doc(patientsCollectionRef);
                currentBatch.set(newDocRef, patientPayload as Omit<Patient, 'id'>);
                operationsInCurrentBatch++;
                totalValidPatientsProcessed++;

                if (operationsInCurrentBatch >= BATCH_SIZE) {
                  console.log(`BATCH IMPORT: Commitando lote de ${operationsInCurrentBatch} pacientes...`);
                  await currentBatch.commit();
                  console.log(`BATCH IMPORT: Lote de ${operationsInCurrentBatch} pacientes commitado com sucesso.`);
                  currentBatch = writeBatch(firestore); // Inicia um novo lote
                  operationsInCurrentBatch = 0;
                   toast({
                    title: "Lote Parcial Importado",
                    description: `${totalValidPatientsProcessed} pacientes processados até agora.`,
                    duration: 3000, // Mensagem mais curta
                  });
                }

            } catch (error: any) {
                console.error(`BATCH IMPORT: Erro inesperado processando linha ${rowIndex}:`, error);
                importErrors.push(`Linha ${rowIndex}: Erro inesperado durante processamento: ${error.message}`);
            }
          }
          console.log("BATCH IMPORT: Processamento de todas as linhas concluído. Erros de validação de linha:", importErrors.length, "Pacientes válidos para batch:", totalValidPatientsProcessed);

          // Commit do último lote, se houver operações pendentes
          if (operationsInCurrentBatch > 0) {
            console.log(`BATCH IMPORT: Commitando lote final de ${operationsInCurrentBatch} pacientes...`);
            try {
              await currentBatch.commit();
              console.log(`BATCH IMPORT: Lote final de ${operationsInCurrentBatch} pacientes commitado com sucesso.`);
            } catch (batchError: any) {
                console.error("BATCH IMPORT: Erro ao commitar lote final de pacientes no Firestore: ", batchError);
                importErrors.push(`Erro ao salvar o último lote de pacientes: ${batchError.message}`);
            }
          }

          if (importErrors.length > 0) {
            toast({
              title: `Erros na Validação dos Dados (${importErrors.length} falhas)`,
              description: (
                <div className="max-h-40 overflow-y-auto">
                  {importErrors.map((err, i) => <p key={i} className="text-xs">{err}</p>)}
                </div>
              ),
              variant: "destructive",
              duration: totalValidPatientsProcessed > 0 ? 15000 : 10000,
            });
          }

          if (totalValidPatientsProcessed > 0) {
            toast({
              title: "Importação Concluída",
              description: `${totalValidPatientsProcessed} paciente(s) importado(s) com sucesso.`,
            });
          } else if (importErrors.length === 0 && data.length > 0) { 
             toast({ title: "Nenhum Paciente para Importar", description: "Nenhum paciente válido encontrado na planilha após validação.", variant: "default" });
             console.log("BATCH IMPORT: Nenhum paciente válido para commit, mas não houve erros de validação explícitos que pararam o loop.");
          }

          console.log("BATCH IMPORT: Chegando ao final do 'complete' callback. isProcessing será definido como false.");
          setIsProcessing(false);
          setFile(null);
          const fileInput = document.getElementById('batch-patient-file-input') as HTMLInputElement | null;
          if (fileInput) fileInput.value = "";
        },
        error: (error: Papa.ParseError) => {
          console.error("BATCH IMPORT: Erro de parsing PapaParse:", error);
          toast({ title: "Erro de Leitura", description: `Não foi possível processar o arquivo CSV: ${error.message}`, variant: "destructive" });
          setIsProcessing(false);
        }
      });
    };

    reader.readAsText(file, 'UTF-8'); 
  };

  const handleDownloadTemplate = () => {
    const BOM = "\uFEFF"; 
    const csvHeader = "Nome Completo,Data de Nascimento,Número do Cartão SUS,Endereço,Telefone,Sexo,Agente de Saúde,Nome da UBS de Cadastro\n";
    const csvExampleRow1 = "Maria Joaquina de Amaral Pereira Góes,1985-07-22,700123456789012,\"Rua das Palmeiras, 45, Centro, Cidade Exemplo - EX\",(11) 98765-4321,feminino,José Agente,UBS Central Exemplo\n";
    const csvExampleRow2 = "João Ricardo da Silva,,700987654321098,,,,,\n"; 
    const csvContent = BOM + csvHeader + csvExampleRow1 + csvExampleRow2;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "modelo_importacao_pacientes.csv");
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
       toast({ title: "Download Iniciado", description: "O arquivo modelo_importacao_pacientes.csv está sendo baixado." });
    } else {
        toast({ title: "Erro no Download", description: "Seu navegador não suporta o download automático.", variant: "destructive" });
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Pacientes em Lote via Planilha CSV</CardTitle>
        <CardDescription>
          A primeira linha da planilha deve ser o cabeçalho. Certifique-se que o arquivo está codificado em UTF-8.
          Grandes arquivos serão processados em lotes de {BATCH_SIZE} pacientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha CSV de Pacientes</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Sua planilha CSV deve ter as seguintes colunas, nesta ordem:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Nome Completo</code> (Texto, Obrigatório)</li>
                <li><code>Data de Nascimento</code> (Data AAAA-MM-DD, DD/MM/AAAA ou DD-MM-AAAA, Opcional)</li>
                <li><code>Número do Cartão SUS</code> (Número, Obrigatório - 15 dígitos)</li>
                <li><code>Endereço</code> (Texto, Opcional)</li>
                <li><code>Telefone</code> (Texto, Opcional)</li>
                <li><code>Sexo</code> (Texto, Opcional - 'masculino', 'feminino', 'outro', 'ignorado')</li>
                <li><code>Agente de Saúde</code> (Texto, Opcional - Nome do agente)</li>
                <li><code>Nome da UBS de Cadastro</code> (Texto, Opcional - Nome exato da UBS cadastrada no sistema)</li>
              </ul>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Planilha Modelo (.csv)
              </Button>
            </AlertDescription>
          </Alert>
        </div>

        <div className="grid w-full max-w-md items-center gap-2">
          <Label htmlFor="batch-patient-file-input">Arquivo CSV (UTF-8)</Label>
          <Input
            id="batch-patient-file-input"
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="cursor-pointer file:cursor-pointer file:font-semibold file:text-primary"
            disabled={isProcessing || isLoadingHospitals}
          />
          {file && <p className="text-sm text-muted-foreground mt-2">Arquivo selecionado: {file.name}</p>}
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSubmit} disabled={!file || isProcessing || isLoadingHospitals}>
          {isLoadingHospitals ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando UBSs...</> :
           isProcessing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando...</> :
           <><Upload className="mr-2 h-4 w-4" /> Processar Planilha</>}
        </Button>
      </CardFooter>
    </Card>
  );
};


export default function AddPatientPage() {
  return (
    <div>
      <PageHeader
        title="Adicionar Pacientes"
        description="Cadastre um novo paciente manualmente ou importe uma lista via planilha."
        icon={UserPlus}
      />
      <Tabs defaultValue="manual" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-1/2 mb-6">
          <TabsTrigger value="manual">Adicionar Manualmente</TabsTrigger>
          <TabsTrigger value="import">Importar Planilha CSV</TabsTrigger>
        </TabsList>
        <TabsContent value="manual">
          <PatientForm />
        </TabsContent>
        <TabsContent value="import">
          <BatchImportPatientForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
