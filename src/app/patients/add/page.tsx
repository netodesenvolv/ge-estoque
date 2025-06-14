
'use client';

import { useState } from 'react';
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
import Papa from 'papaparse';
import { firestore } from '@/lib/firebase';
import { collection, writeBatch, doc } from 'firebase/firestore';
import type { Patient } from '@/types';

const BatchImportPatientForm = () => {
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

  const handleSubmit = async () => {
    if (!file) {
      toast({
        title: "Erro",
        description: "Por favor, selecione um arquivo CSV para importar.",
        variant: "destructive",
      });
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
          const { data, errors: parseErrors } = results;

          if (parseErrors.length > 0) {
            console.error("Erros de parsing do CSV:", parseErrors);
            toast({
              title: "Erro ao Processar CSV",
              description: `Houve ${parseErrors.length} erro(s) ao ler o arquivo. Verifique o console.`,
              variant: "destructive",
            });
            setIsProcessing(false);
            return;
          }

          if (data.length === 0) {
            toast({ title: "Arquivo Vazio", description: "O arquivo CSV não contém dados.", variant: "destructive" });
            setIsProcessing(false);
            return;
          }
          
          const patientsCollectionRef = collection(firestore, "patients");
          const batch = writeBatch(firestore);
          let validPatientsCount = 0;
          const importErrors: string[] = [];

          data.forEach((row, index) => {
            const rowIndex = index + 2; // +1 para header, +1 para 0-indexed

            const name = row["Nome Completo"]?.trim();
            const susCardNumber = row["Número do Cartão SUS"]?.trim();
            const birthDateStr = row["Data de Nascimento"]?.trim();

            if (!name || !susCardNumber) {
              importErrors.push(`Linha ${rowIndex}: Nome Completo e Número do Cartão SUS são obrigatórios.`);
              return;
            }

            if (!/^\d{15}$/.test(susCardNumber)) {
              importErrors.push(`Linha ${rowIndex}: Número do Cartão SUS inválido. Deve conter 15 dígitos numéricos.`);
              return;
            }
            
            let birthDate: string | undefined = undefined;
            if (birthDateStr) {
                const parsedDate = new Date(birthDateStr); // Interpreta "YYYY-MM-DD" como YYYY-MM-DDT00:00:00Z (UTC)
                if (!isNaN(parsedDate.getTime())) {
                    // Usar componentes UTC para evitar deslocamento de fuso
                    const year = parsedDate.getUTCFullYear();
                    const month = (parsedDate.getUTCMonth() + 1).toString().padStart(2, '0'); // getUTCMonth é 0-indexed
                    const day = parsedDate.getUTCDate().toString().padStart(2, '0');
                    birthDate = `${year}-${month}-${day}`;
                } else {
                    importErrors.push(`Linha ${rowIndex}: Data de Nascimento inválida ('${birthDateStr}'). Use AAAA-MM-DD ou deixe em branco.`);
                    return;
                }
            }

            const newPatient: Omit<Patient, 'id'> = {
              name,
              susCardNumber,
              birthDate,
            };
            
            const newDocRef = doc(patientsCollectionRef); // Cria referência com ID automático
            batch.set(newDocRef, newPatient);
            validPatientsCount++;
          });

          if (importErrors.length > 0) {
            toast({
              title: `Erros na Importação (${importErrors.length} falhas)`,
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
              await batch.commit();
              toast({
                title: "Importação Concluída",
                description: `${validPatientsCount} paciente(s) importado(s) com sucesso.`,
                variant: "default",
              });
            } catch (error) {
              console.error("Erro ao salvar pacientes no Firestore: ", error);
              toast({
                title: "Erro no Banco de Dados",
                description: "Não foi possível salvar os pacientes importados. Tente novamente.",
                variant: "destructive",
              });
            }
          } else if (importErrors.length === 0) {
             toast({ title: "Nenhum Paciente para Importar", description: "Nenhum paciente válido encontrado na planilha para importação.", variant: "default" });
          }

          setIsProcessing(false);
          setFile(null); 
          const fileInput = document.getElementById('batch-patient-file-input') as HTMLInputElement | null;
          if (fileInput) fileInput.value = "";
        },
        error: (error) => {
          console.error("Erro de parsing PapaParse:", error);
          toast({ title: "Erro de Leitura", description: "Não foi possível processar o arquivo CSV.", variant: "destructive" });
          setIsProcessing(false);
        }
      });
    };

    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const BOM = "\uFEFF"; // Byte Order Mark for UTF-8
    const csvHeader = "Nome Completo,Número do Cartão SUS,Data de Nascimento\n";
    const csvExampleRow1 = "Maria Joaquina de Amaral Pereira Góes,700123456789012,1985-07-22\n";
    const csvExampleRow2 = "José Ricardo da Silva,700987654321098,\n";
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
       toast({
        title: "Download Iniciado",
        description: "O arquivo modelo_importacao_pacientes.csv está sendo baixado.",
      });
    } else {
        toast({
            title: "Erro no Download",
            description: "Seu navegador não suporta o download automático de arquivos.",
            variant: "destructive",
        });
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Pacientes em Lote via Planilha CSV</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo .csv contendo os dados dos pacientes.
          A primeira linha da planilha deve ser o cabeçalho.
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
                <li><code>Nome Completo</code> (Texto, Obrigatório) - Nome completo do paciente.</li>
                <li><code>Número do Cartão SUS</code> (Número, Obrigatório) - 15 dígitos do Cartão Nacional de Saúde.</li>
                <li><code>Data de Nascimento</code> (Data no formato AAAA-MM-DD, Opcional) - Ex: 1990-12-31. Deixe em branco se não for fornecer.</li>
              </ul>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Planilha Modelo (.csv)
              </Button>
            </AlertDescription>
          </Alert>
        </div>

        <div className="grid w-full max-w-md items-center gap-2">
          <Label htmlFor="batch-patient-file-input">Arquivo CSV</Label>
          <Input
            id="batch-patient-file-input"
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="cursor-pointer file:cursor-pointer file:font-semibold file:text-primary"
            disabled={isProcessing}
          />
          {file && <p className="text-sm text-muted-foreground mt-2">Arquivo selecionado: {file.name}</p>}
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSubmit} disabled={!file || isProcessing}>
          {isProcessing ? (
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
