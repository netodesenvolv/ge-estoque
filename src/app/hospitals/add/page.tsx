
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
    toast({
      title: "Modelo de Planilha para Hospitais",
      description: "Em uma aplicação real, o download da planilha modelo iniciaria aqui. Por favor, siga as instruções de colunas abaixo.",
    });
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Hospitais em Lote via Planilha</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo (CSV, XLSX) contendo os dados dos hospitais.
          A primeira linha da planilha deve ser o cabeçalho.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha de Hospitais</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Sua planilha (CSV ou XLSX) deve ter as seguintes colunas, nesta ordem:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Nome</code> (Texto, Obrigatório) - Nome do hospital.</li>
                <li><code>Endereço</code> (Texto, Opcional) - Endereço completo do hospital.</li>
              </ul>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Planilha Modelo (Instruções)
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
        title="Adicionar Hospitais"
        description="Cadastre um novo hospital manualmente ou importe uma lista via planilha."
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
