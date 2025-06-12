
'use client';

import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import ItemForm from '@/components/forms/ItemForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PackagePlus, Upload, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";


const BatchImportForm = () => {
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

    // Simulação de processamento de arquivo
    console.log('Arquivo para importação:', file.name, file.type);
    toast({
      title: "Processamento Simulado",
      description: `Arquivo "${file.name}" recebido. Em um cenário real, o arquivo seria processado aqui.`,
    });

    // Limpar o campo de arquivo após a simulação
    setFile(null);
    const fileInput = document.getElementById('batch-file-input') as HTMLInputElement | null;
    if (fileInput) {
      fileInput.value = ""; // Reseta o valor do input file
    }
  };

  const handleDownloadTemplate = () => {
    const BOM = "\uFEFF"; // Byte Order Mark for UTF-8
    const csvHeader = "Nome,Código,Categoria,Unidade de Medida,Qtde. Mínima (Armazém Central),Qtde. Atual (Armazém Central),Fornecedor,Data de Validade\n";
    const csvExampleRow1 = "Paracetamol 500mg,PARA500,Analgésico,Comprimido,100,500,Pharma Inc.,2025-12-31\n";
    const csvExampleRow2 = "Seringa Descartável 10ml,SER10ML,Material Hospitalar,Unidade,200,1000,MedSupply,2026-06-30\n";
    const csvExampleRow3 = "Álcool em Gel 70% 500ml,ALC500,Antisséptico,Frasco,50,200,CleanPro,\n"; // Exemplo sem data de validade
    
    const csvContent = BOM + csvHeader + csvExampleRow1 + csvExampleRow2 + csvExampleRow3;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "modelo_importacao_itens.csv");
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({
        title: "Download Iniciado",
        description: "O arquivo modelo_importacao_itens.csv está sendo baixado.",
      });
    } else {
      toast({
        title: "Erro no Download",
        description: "Seu navegador não suporta o download automático de arquivos. Por favor, copie o formato manualmente.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Itens em Lote via Planilha</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo (CSV, XLSX) contendo os dados dos itens.
          A primeira linha da planilha deve ser o cabeçalho.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Certifique-se de que sua planilha (CSV ou XLSX) siga o formato especificado. A primeira linha deve conter os seguintes cabeçalhos, nesta ordem:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Nome</code> (Texto, Obrigatório) - Nome do item.</li>
                <li><code>Código</code> (Texto, Obrigatório) - Código único do item.</li>
                <li><code>Categoria</code> (Texto, Obrigatório) - Categoria do item.</li>
                <li><code>Unidade de Medida</code> (Texto, Obrigatório) - Ex: Peça, Caixa, Comprimido.</li>
                <li><code>Qtde. Mínima (Armazém Central)</code> (Número, Obrigatório) - Nível mínimo de estoque no Armazém Central.</li>
                <li><code>Qtde. Atual (Armazém Central)</code> (Número, Obrigatório) - Quantidade inicial no Armazém Central.</li>
                <li><code>Fornecedor</code> (Texto, Opcional) - Nome do fornecedor.</li>
                <li><code>Data de Validade</code> (Data no formato AAAA-MM-DD, Opcional) - Deixe em branco se não aplicável.</li>
              </ul>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Planilha Modelo (.csv)
              </Button>
            </AlertDescription>
          </Alert>
        </div>

        <div className="grid w-full max-w-md items-center gap-2">
          <Label htmlFor="batch-file-input">Arquivo da Planilha</Label>
          <Input
            id="batch-file-input"
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

export default function AddItemPage() {
  return (
    <div>
      <PageHeader
        title="Adicionar Itens ao Catálogo"
        description="Escolha o método para adicionar novos itens: manualmente um por um ou importando uma planilha em lote."
        icon={PackagePlus}
      />
      <Tabs defaultValue="manual" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-1/2 mb-6">
          <TabsTrigger value="manual">Adicionar Manualmente</TabsTrigger>
          <TabsTrigger value="import">Importar Planilha</TabsTrigger>
        </TabsList>
        <TabsContent value="manual">
          <ItemForm />
        </TabsContent>
        <TabsContent value="import">
          <BatchImportForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}

