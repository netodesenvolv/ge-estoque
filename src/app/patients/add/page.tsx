
'use client';

import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import PatientForm from '@/components/forms/PatientForm';
import { UserPlus, Upload, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const BatchImportPatientForm = () => {
  const [file, setFile] = useState<File | null>(null);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      setFile(event.target.files[0]);
    } else {
      setFile(null);
    }
  };

  const handleSubmit = async () => {
    if (!file) {
      toast({
        title: "Erro",
        description: "Por favor, selecione um arquivo para importar.",
        variant: "destructive",
      });
      return;
    }

    console.log('Arquivo para importação de pacientes:', file.name, file.type);
    toast({
      title: "Processamento Simulado",
      description: `Arquivo de pacientes "${file.name}" recebido. Em um cenário real, o arquivo seria processado aqui.`,
    });

    setFile(null);
    const fileInput = document.getElementById('batch-patient-file-input') as HTMLInputElement | null;
    if (fileInput) {
      fileInput.value = "";
    }
  };

  const handleDownloadTemplate = () => {
    const csvHeader = "Nome Completo,Número do Cartão SUS,Data de Nascimento\n";
    const csvExampleRow1 = "Maria Joaquina de Amaral Pereira Goes,700123456789012,1985-07-22\n";
    const csvExampleRow2 = "José Ricardo da Silva,700987654321098,\n"; // Exemplo sem data de nascimento
    const csvContent = csvHeader + csvExampleRow1 + csvExampleRow2;

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
            description: "Seu navegador não suporta o download automático de arquivos. Por favor, copie o formato manualmente.",
            variant: "destructive",
        });
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Pacientes em Lote via Planilha</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo (CSV, XLSX) contendo os dados dos pacientes.
          A primeira linha da planilha deve ser o cabeçalho.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha de Pacientes</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Sua planilha (CSV ou XLSX) deve ter as seguintes colunas, nesta ordem:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Nome Completo</code> (Texto, Obrigatório) - Nome completo do paciente.</li>
                <li><code>Número do Cartão SUS</code> (Texto/Número, Obrigatório) - 15 dígitos do Cartão Nacional de Saúde.</li>
                <li><code>Data de Nascimento</code> (Data no formato AAAA-MM-DD, Opcional) - Ex: 1990-12-31. Deixe em branco se não for fornecer.</li>
              </ul>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Planilha Modelo (.csv)
              </Button>
            </AlertDescription>
          </Alert>
        </div>

        <div className="grid w-full max-w-md items-center gap-2">
          <Label htmlFor="batch-patient-file-input">Arquivo da Planilha</Label>
          <Input
            id="batch-patient-file-input"
            type="file"
            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
            onChange={handleFileChange}
            className="cursor-pointer file:cursor-pointer file:font-semibold file:text-primary"
          />
          {file && <p className="text-sm text-muted-foreground mt-2">Arquivo selecionado: {file.name}</p>}
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSubmit} disabled={!file}>
          <Upload className="mr-2 h-4 w-4" /> Processar Planilha (Simulação)
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
          <TabsTrigger value="import">Importar Planilha</TabsTrigger>
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
