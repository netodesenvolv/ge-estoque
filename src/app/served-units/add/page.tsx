
'use client';

import { useState, useEffect } from 'react';
import PageHeader from '@/components/PageHeader';
import ServedUnitForm from '@/components/forms/ServedUnitForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsersRound, Upload, Download, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Papa from 'papaparse';
import { firestore } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, orderBy } from 'firebase/firestore';
import type { ServedUnit, Hospital } from '@/types';

const BatchImportServedUnitForm = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    const fetchHospitals = async () => {
      const hospitalsCollectionRef = collection(firestore, "hospitals");
      const q = query(hospitalsCollectionRef, orderBy("name", "asc"));
      try {
        const querySnapshot = await getDocs(q);
        setHospitals(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital)));
      } catch (error) {
        console.error("Erro ao buscar hospitais para importação: ", error);
        toast({
          title: "Erro ao Carregar Hospitais",
          description: "Não foi possível carregar a lista de hospitais para validação da importação.",
          variant: "destructive",
        });
      }
    };
    fetchHospitals();
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
        if (event.target) event.target.value = ""; // Limpa o input
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
    if (hospitals.length === 0) {
      toast({ title: "Aguarde", description: "A lista de hospitais ainda está carregando. Tente novamente em alguns segundos.", variant: "default" });
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
            toast({ title: "Erro ao Processar CSV", description: `Houve ${parseErrors.length} erro(s) ao ler o arquivo. Verifique o console.`, variant: "destructive" });
            setIsProcessing(false);
            return;
          }

          if (data.length === 0) {
            toast({ title: "Arquivo Vazio", description: "O arquivo CSV não contém dados.", variant: "destructive" });
            setIsProcessing(false);
            return;
          }
          
          const servedUnitsCollectionRef = collection(firestore, "servedUnits");
          const batch = writeBatch(firestore);
          let validUnitsCount = 0;
          const importErrors: string[] = [];

          data.forEach((row, index) => {
            const rowIndex = index + 2; // +1 para header, +1 para 0-indexed

            const unitName = row["Nome da Unidade"]?.trim();
            const location = row["Localização"]?.trim();
            const hospitalNameCsv = row["Nome do Hospital Associado"]?.trim();

            if (!unitName || !location || !hospitalNameCsv) {
              importErrors.push(`Linha ${rowIndex}: Faltam dados obrigatórios (Nome da Unidade, Localização, Nome do Hospital).`);
              return;
            }

            const hospital = hospitals.find(h => h.name.toLowerCase() === hospitalNameCsv.toLowerCase());
            if (!hospital) {
              importErrors.push(`Linha ${rowIndex}: Hospital "${hospitalNameCsv}" não encontrado no sistema. Cadastre o hospital primeiro.`);
              return;
            }

            const newServedUnit: Omit<ServedUnit, 'id' | 'hospitalName'> = {
              name: unitName,
              location,
              hospitalId: hospital.id,
            };
            
            const newDocRef = doc(servedUnitsCollectionRef); // Cria referência com ID automático
            batch.set(newDocRef, newServedUnit);
            validUnitsCount++;
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
          
          if (validUnitsCount > 0) {
            try {
              await batch.commit();
              toast({
                title: "Importação Concluída",
                description: `${validUnitsCount} unidade(s) servida(s) importada(s) com sucesso.`,
                variant: "default",
              });
            } catch (error) {
              console.error("Erro ao salvar unidades no Firestore: ", error);
              toast({ title: "Erro no Banco de Dados", description: "Não foi possível salvar as unidades importadas. Tente novamente.", variant: "destructive" });
            }
          } else if (importErrors.length === 0) {
             toast({ title: "Nenhuma Unidade para Importar", description: "Nenhuma unidade válida encontrada na planilha para importação.", variant: "default" });
          }

          setIsProcessing(false);
          setFile(null); 
          const fileInput = document.getElementById('batch-served-unit-file-input') as HTMLInputElement | null;
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
    const csvHeader = "Nome da Unidade,Localização,Nome do Hospital Associado\n";
    const csvExampleRow1 = "Sala de Emergência,\"Piso 1, Ala A\",Hospital Central da Cidade\n";
    const csvExampleRow2 = "UTI Neonatal,\"Piso 3, Ala C\",Hospital Infantil Sul\n";
    const csvExampleRow3 = "Consultório 1 - Clínica Geral,Térreo,UBS Vila Esperança\n";
    const csvContent = BOM + csvHeader + csvExampleRow1 + csvExampleRow2 + csvExampleRow3;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "modelo_importacao_unidades_servidas.csv");
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
       toast({
        title: "Download Iniciado",
        description: "O arquivo modelo_importacao_unidades_servidas.csv está sendo baixado.",
      });
    } else {
        toast({ title: "Erro no Download", description: "Seu navegador não suporta o download automático.", variant: "destructive" });
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">Importar Unidades Servidas em Lote via Planilha CSV</CardTitle>
        <CardDescription>
          Faça o upload de um arquivo .csv contendo os dados das unidades servidas.
          A primeira linha da planilha deve ser o cabeçalho.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Alert>
            <Download className="h-4 w-4" />
            <AlertTitle>Formato da Planilha de Unidades Servidas</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Sua planilha CSV deve ter as seguintes colunas, nesta ordem (todas obrigatórias):
              </p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><code>Nome da Unidade</code> (Texto) - Nome do setor ou departamento. Ex: "Sala de Emergência".</li>
                <li><code>Localização</code> (Texto) - Localização física da unidade dentro do hospital. Ex: "Piso 1, Ala A".</li>
                <li><code>Nome do Hospital Associado</code> (Texto) - Nome exato de um hospital ou UBS já cadastrado no sistema. Ex: "Hospital Central da Cidade".</li>
              </ul>
               <p className="mt-2 text-xs text-muted-foreground">
                Nota: O 'Nome do Hospital Associado' deve corresponder exatamente a um hospital ou UBS já existente no sistema para que a importação seja bem-sucedida.
              </p>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="mt-4">
                <Download className="mr-2 h-4 w-4" /> Baixar Planilha Modelo (.csv)
              </Button>
            </AlertDescription>
          </Alert>
        </div>

        <div className="grid w-full max-w-md items-center gap-2">
          <Label htmlFor="batch-served-unit-file-input">Arquivo CSV</Label>
          <Input
            id="batch-served-unit-file-input"
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
        <Button onClick={handleSubmit} disabled={!file || isProcessing || hospitals.length === 0}>
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

export default function AddServedUnitPage() {
  return (
    <div>
      <PageHeader
        title="Adicionar Unidades Servidas"
        description="Cadastre um novo local ou departamento que consome estoque, manualmente ou via planilha."
        icon={UsersRound}
      />
      <Tabs defaultValue="manual" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-1/2 mb-6">
          <TabsTrigger value="manual">Adicionar Manualmente</TabsTrigger>
          <TabsTrigger value="import">Importar Planilha CSV</TabsTrigger>
        </TabsList>
        <TabsContent value="manual">
          <ServedUnitForm />
        </TabsContent>
        <TabsContent value="import">
          <BatchImportServedUnitForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}

    