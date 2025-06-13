
'use client';

import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import ItemForm, { type ItemFormData } from '@/components/forms/ItemForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PackagePlus, Upload, Download, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Papa from 'papaparse';
import { firestore } from '@/lib/firebase';
import { collection, writeBatch, doc } from 'firebase/firestore';
import type { Item } from '@/types';

const BatchImportForm = () => {
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
        if (event.target) event.target.value = ""; // Limpa o input
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
          
          const itemsCollectionRef = collection(firestore, "items");
          const batch = writeBatch(firestore);
          let validItemsCount = 0;
          const importErrors: string[] = [];

          data.forEach((row, index) => {
            const rowIndex = index + 2; // +1 para header, +1 para 0-indexed

            const name = row["Nome"]?.trim();
            const code = row["Código"]?.trim();
            const category = row["Categoria"]?.trim();
            const unitOfMeasure = row["Unidade de Medida"]?.trim();
            const minQuantityStr = row["Qtde. Mínima (Armazém Central)"]?.trim();
            const currentQuantityCentralStr = row["Qtde. Atual (Armazém Central)"]?.trim();
            const supplier = row["Fornecedor"]?.trim() || undefined;
            const expirationDateStr = row["Data de Validade"]?.trim();

            if (!name || !code || !category || !unitOfMeasure || !minQuantityStr || !currentQuantityCentralStr) {
              importErrors.push(`Linha ${rowIndex}: Faltam dados obrigatórios (Nome, Código, Categoria, Un. Medida, Qtde. Mín., Qtde. Atual).`);
              return;
            }

            const minQuantity = parseInt(minQuantityStr, 10);
            const currentQuantityCentral = parseInt(currentQuantityCentralStr, 10);

            if (isNaN(minQuantity) || minQuantity < 0) {
              importErrors.push(`Linha ${rowIndex}: Quantidade Mínima inválida.`);
              return;
            }
            if (isNaN(currentQuantityCentral) || currentQuantityCentral < 0) {
              importErrors.push(`Linha ${rowIndex}: Quantidade Atual inválida.`);
              return;
            }
            
            let expirationDate: string | null = null;
            if (expirationDateStr) {
                const parsedDate = new Date(expirationDateStr);
                if (!isNaN(parsedDate.getTime())) {
                    // Formatar para YYYY-MM-DD. Cuidado com fuso horário se as datas no CSV não forem UTC.
                    // Simplesmente assumindo que a string já está correta ou que a conversão padrão é aceitável.
                    const year = parsedDate.getFullYear();
                    const month = (parsedDate.getMonth() + 1).toString().padStart(2, '0');
                    const day = parsedDate.getDate().toString().padStart(2, '0');
                    expirationDate = `${year}-${month}-${day}`;
                } else {
                    importErrors.push(`Linha ${rowIndex}: Data de Validade inválida ('${expirationDateStr}'). Use AAAA-MM-DD ou deixe em branco.`);
                    return;
                }
            }


            const newItem: Omit<Item, 'id'> = {
              name,
              code,
              category,
              unitOfMeasure,
              minQuantity,
              currentQuantityCentral,
              supplier: supplier || '',
              expirationDate: expirationDate || null,
            };
            
            const newDocRef = doc(itemsCollectionRef); // Cria referência com ID automático
            batch.set(newDocRef, newItem);
            validItemsCount++;
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
          
          if (validItemsCount > 0) {
            try {
              await batch.commit();
              toast({
                title: "Importação Concluída",
                description: `${validItemsCount} item(ns) importado(s) com sucesso.`,
                variant: "default",
              });
            } catch (error) {
              console.error("Erro ao salvar itens no Firestore: ", error);
              toast({
                title: "Erro no Banco de Dados",
                description: "Não foi possível salvar os itens importados. Tente novamente.",
                variant: "destructive",
              });
            }
          } else if (importErrors.length === 0) {
             toast({ title: "Nenhum Item para Importar", description: "Nenhum item válido encontrado na planilha para importação.", variant: "default" });
          }

          setIsProcessing(false);
          setFile(null); 
          const fileInput = document.getElementById('batch-file-input') as HTMLInputElement | null;
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
    const BOM = "\uFEFF";
    const csvHeader = "Nome,Código,Categoria,Unidade de Medida,Qtde. Mínima (Armazém Central),Qtde. Atual (Armazém Central),Fornecedor,Data de Validade\n";
    const csvExampleRow1 = "Paracetamol 500mg,PARA500,Analgésico,Comprimido,100,500,Pharma Inc.,2025-12-31\n";
    const csvExampleRow2 = "Seringa Descartável 10ml,SER10ML,Material Hospitalar,Unidade,200,1000,MedSupply,2026-06-30\n";
    const csvExampleRow3 = "Álcool em Gel 70% 500ml,ALC500,Antisséptico,Frasco,50,200,CleanPro,\n";
    
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
      toast({ title: "Download Iniciado", description: "O arquivo modelo_importacao_itens.csv está sendo baixado." });
    } else {
      toast({ title: "Erro no Download", description: "Seu navegador não suporta o download automático.", variant: "destructive" });
    }
  };

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Itens em Lote via Planilha CSV</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo .csv contendo os dados dos itens.
          A primeira linha da planilha deve ser o cabeçalho.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha CSV</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Certifique-se de que sua planilha CSV siga o formato especificado. A primeira linha deve conter os seguintes cabeçalhos, nesta ordem:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Nome</code> (Texto, Obrigatório)</li>
                <li><code>Código</code> (Texto, Obrigatório)</li>
                <li><code>Categoria</code> (Texto, Obrigatório)</li>
                <li><code>Unidade de Medida</code> (Texto, Obrigatório)</li>
                <li><code>Qtde. Mínima (Armazém Central)</code> (Número, Obrigatório)</li>
                <li><code>Qtde. Atual (Armazém Central)</code> (Número, Obrigatório)</li>
                <li><code>Fornecedor</code> (Texto, Opcional)</li>
                <li><code>Data de Validade</code> (Data AAAA-MM-DD, Opcional)</li>
              </ul>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Planilha Modelo (.csv)
              </Button>
            </AlertDescription>
          </Alert>
        </div>

        <div className="grid w-full max-w-md items-center gap-2">
          <Label htmlFor="batch-file-input">Arquivo CSV</Label>
          <Input
            id="batch-file-input"
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
          <TabsTrigger value="import">Importar Planilha CSV</TabsTrigger>
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
