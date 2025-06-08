
'use client';

import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import ItemForm from '@/components/forms/ItemForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PackagePlus, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Itens em Lote via Planilha</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo (CSV, XLSX) contendo os dados dos itens.
          Certifique-se de que a planilha siga o formato esperado. As colunas devem ser: Nome, Código, Categoria, Unidade de Medida, Quantidade Mínima (Central), Quantidade Atual (Central), Fornecedor (Opcional), Data de Validade (AAAA-MM-DD, Opcional).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
