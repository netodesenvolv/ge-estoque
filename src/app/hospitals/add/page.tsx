
'use client';

import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import HospitalForm from '@/components/forms/HospitalForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building, Upload, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const BatchImportHospitalForm = () => {
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

    console.log('Arquivo para importação de hospitais:', file.name, file.type);
    toast({
      title: "Processamento Simulado",
      description: `Arquivo de hospitais "${file.name}" recebido. Em um cenário real, o arquivo seria processado aqui.`,
    });

    setFile(null);
    const fileInput = document.getElementById('batch-hospital-file-input') as HTMLInputElement | null;
    if (fileInput) {
      fileInput.value = "";
    }
  };

  const handleDownloadTemplate = () => {
    const BOM = "\uFEFF"; // Byte Order Mark for UTF-8
    const csvHeader = "Nome,Endereço\n";
    const csvExampleRow1 = "Hospital Central da Cidade,\"Rua Principal, 123, Centro\"\n";
    const csvExampleRow2 = "UBS Vila Esperança,\n"; // Exemplo sem endereço
    const csvContent = BOM + csvHeader + csvExampleRow1 + csvExampleRow2;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "modelo_importacao_hospitais.csv");
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
       toast({
        title: "Download Iniciado",
        description: "O arquivo modelo_importacao_hospitais.csv está sendo baixado.",
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
        <CardTitle className="font-headline">Importar Hospitais/UBS em Lote via Planilha</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo (CSV, XLSX) contendo os dados dos hospitais ou UBS.
          A primeira linha da planilha deve ser o cabeçalho.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha de Hospitais/UBS</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Sua planilha (CSV ou XLSX) deve ter as seguintes colunas, nesta ordem:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Nome</code> (Texto, Obrigatório) - Nome do hospital ou UBS.</li>
                <li><code>Endereço</code> (Texto, Opcional) - Endereço completo.</li>
              </ul>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Planilha Modelo (.csv)
              </Button>
            </AlertDescription>
          </Alert>
        </div>

        <div className="grid w-full max-w-md items-center gap-2">
          <Label htmlFor="batch-hospital-file-input">Arquivo da Planilha</Label>
          <Input
            id="batch-hospital-file-input"
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

export default function AddHospitalPage() {
  return (
    <div>
      <PageHeader
        title="Adicionar Hospitais/UBS"
        description="Cadastre um novo hospital/UBS manualmente ou importe uma lista via planilha."
        icon={Building}
      />
      <Tabs defaultValue="manual" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-1/2 mb-6">
          <TabsTrigger value="manual">Adicionar Manualmente</TabsTrigger>
          <TabsTrigger value="import">Importar Planilha</TabsTrigger>
        </TabsList>
        <TabsContent value="manual">
          <HospitalForm />
        </TabsContent>
        <TabsContent value="import">
          <BatchImportHospitalForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
