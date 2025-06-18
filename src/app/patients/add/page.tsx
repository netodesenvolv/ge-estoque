
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
import Papa, { type ParseError } from 'papaparse';
import { firestore } from '@/lib/firebase';
import { collection, writeBatch, doc, onSnapshot, query, orderBy } from 'firebase/firestore';
import type { Patient, Hospital, PatientSex } from '@/types';

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
    if (!file) {
      toast({ title: "Erro", description: "Por favor, selecione um arquivo CSV para importar.", variant: "destructive" });
      return;
    }
    if (isLoadingHospitals) {
      toast({ title: "Aguarde", description: "A lista de UBSs ainda está carregando. Tente novamente em alguns segundos.", variant: "default" });
      return;
    }

    setIsProcessing(true);
    console.log("BATCH IMPORT: Iniciando handleSubmit.");
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
        complete: async (results) => {
          console.log("BATCH IMPORT: PapaParse 'complete' callback iniciado.");
          const { data, errors: parseErrors } = results;

          if (parseErrors.length > 0) {
            console.error("BATCH IMPORT: Erros de parsing do CSV (objetos completos):", JSON.stringify(parseErrors, null, 2));
            const errorMessages = parseErrors.map((err: Papa.ParseError) => {
                 const rowInfo = typeof err.row === 'number' ? `Linha CSV ${err.row + 2} (dados linha ${err.row +1}): ` : `Erro: `;
                 let specificAdvice = "";
                 if (err.code === "TooFewFields") {
                    specificAdvice = "Verifique se há vírgulas suficientes para todas as 8 colunas, mesmo que algumas estejam vazias. Ex: 'Valor1,,,Valor4,,,'";
                 } else if (err.code === "TooManyFields") {
                    specificAdvice = "Verifique se há vírgulas extras na linha, resultando em mais de 8 colunas.";
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
          const batch = writeBatch(firestore);
          let validPatientsCount = 0;
          const importErrors: string[] = [];
          console.log(`BATCH IMPORT: Iniciando processamento de ${data.length} linhas do CSV.`);

          data.forEach((row, index) => {
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
                  return; // continue to next iteration
                }

                if (!/^\d{15}$/.test(susCardNumber)) {
                  importErrors.push(`Linha ${rowIndex}: Número do Cartão SUS inválido ('${susCardNumber}'). Deve conter 15 dígitos numéricos.`);
                  console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - Formato do SUS inválido. SUS: ${susCardNumber}`);
                  return;
                }

                let birthDate: string | undefined = undefined;
                if (birthDateStr) {
                    const parsedDate = new Date(birthDateStr);
                    if (!isNaN(parsedDate.getTime())) {
                        const year = parsedDate.getUTCFullYear();
                        const month = (parsedDate.getUTCMonth() + 1).toString().padStart(2, '0');
                        const day = parsedDate.getUTCDate().toString().padStart(2, '0');
                        birthDate = `${year}-${month}-${day}`;
                    } else {
                        importErrors.push(`Linha ${rowIndex}: Data de Nascimento inválida ('${birthDateStr}'). Use AAAA-MM-DD ou deixe em branco.`);
                        console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - Data de Nascimento inválida. Data: ${birthDateStr}`);
                        return;
                    }
                }

                let sex: PatientSex | undefined = undefined;
                if (sexStr) {
                  if (['masculino', 'feminino', 'outro', 'ignorado'].includes(sexStr)) {
                    sex = sexStr as PatientSex;
                  } else {
                    importErrors.push(`Linha ${rowIndex}: Sexo inválido ('${row["Sexo"]}'). Use 'masculino', 'feminino', 'outro' ou 'ignorado'.`);
                    console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - Sexo inválido. Sexo: ${row["Sexo"]}`);
                    return;
                  }
                }

                let registeredUBSId: string | undefined = undefined;
                let registeredUBSName: string | undefined = undefined;
                if (registeredUBSNameCsv) {
                  const ubs = ubsList.find(u => u.name.toLowerCase() === registeredUBSNameCsv.toLowerCase());
                  if (ubs) {
                    registeredUBSId = ubs.id;
                    registeredUBSName = ubs.name;
                  } else {
                    importErrors.push(`Linha ${rowIndex}: UBS de Cadastro '${registeredUBSNameCsv}' não encontrada. Verifique o nome ou cadastre a UBS primeiro.`);
                    console.warn(`BATCH IMPORT: Linha ${rowIndex}: Validação falhou - UBS não encontrada. UBS CSV: ${registeredUBSNameCsv}`);
                    return;
                  }
                }

                const newPatient: Omit<Patient, 'id'> = {
                  name,
                  susCardNumber,
                  birthDate,
                  address: address || undefined,
                  phone: phone || undefined,
                  sex: sex || undefined,
                  healthAgentName: healthAgentName || undefined,
                  registeredUBSId,
                  registeredUBSName,
                };
                console.log(`BATCH IMPORT: Linha ${rowIndex}: Dados do paciente validados e prontos para batch:`, JSON.stringify(newPatient));

                const newDocRef = doc(patientsCollectionRef);
                batch.set(newDocRef, newPatient);
                validPatientsCount++;
            } catch (error: any) {
                console.error(`BATCH IMPORT: Erro inesperado processando linha ${rowIndex}:`, error);
                importErrors.push(`Linha ${rowIndex}: Erro inesperado durante processamento: ${error.message}`);
            }
          });
          console.log("BATCH IMPORT: Processamento de todas as linhas concluído. Erros de validação de linha:", importErrors.length, "Pacientes válidos para batch:", validPatientsCount);


          if (importErrors.length > 0) {
            toast({
              title: `Erros na Validação dos Dados (${importErrors.length} falhas)`,
              description: (
                <div className="max-h-40 overflow-y-auto">
                  {importErrors.map((err, i) => <p key={i} className="text-xs">{err}</p>)}
                </div>
              ),
              variant: "destructive",
              duration: 10000,
            });
          }

          if (validPatientsCount > 0) {
            try {
              console.log(`BATCH IMPORT: Tentando batch.commit() para ${validPatientsCount} pacientes.`);
              await batch.commit();
              console.log("BATCH IMPORT: batch.commit() bem-sucedido.");
              toast({
                title: "Importação Concluída",
                description: `${validPatientsCount} paciente(s) importado(s) com sucesso.`,
              });
            } catch (error) {
              console.error("BATCH IMPORT: Erro ao salvar pacientes no Firestore (batch.commit): ", error);
              toast({ title: "Erro no Banco de Dados", description: "Não foi possível salvar os pacientes importados.", variant: "destructive" });
            }
          } else if (importErrors.length === 0 && data.length > 0) { // Nenhuma falha de validação, mas nenhum paciente válido (pode acontecer se todas as linhas falharem na validação e retornarem)
             toast({ title: "Nenhum Paciente para Importar", description: "Nenhum paciente válido encontrado na planilha após validação.", variant: "default" });
             console.log("BATCH IMPORT: Nenhum paciente válido para commit, mas não houve erros de validação explícitos que pararam o loop.");
          } else if (data.length === 0) {
             // Este caso já foi tratado no início
          }

          console.log("BATCH IMPORT: Chegando ao final do 'complete' callback.");
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
    const csvExampleRow2 = "José Ricardo da Silva,,700987654321098,,,,,\n";
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
                <li><code>Data de Nascimento</code> (Data AAAA-MM-DD, Opcional)</li>
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

    