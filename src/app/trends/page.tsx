'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { TrendingUp, Bot, Loader2, Lightbulb } from 'lucide-react';
import { analyzeConsumptionTrends, type AnalyzeConsumptionTrendsInput, type AnalyzeConsumptionTrendsOutput } from '@/ai/flows/analyze-consumption-trends';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const trendsSchema = z.object({
  historicalData: z.string().min(10, "Por favor, forneça alguns dados históricos de consumo."),
  seasonalPatterns: z.string().min(5, "Descreva quaisquer padrões sazonais ou digite 'Nenhum'.").optional(),
  strategicStockLevels: z.string().min(10, "Por favor, forneça informações sobre os níveis estratégicos de estoque.").optional(),
});

type TrendsFormData = z.infer<typeof trendsSchema>;

const exampleHistoricalData = `Item: Paracetamol 500mg, Data: 2024-01-15, Quantidade Consumida: 20, Unidade Servida: Sala de Emergência
Item: Paracetamol 500mg, Data: 2024-01-22, Quantidade Consumida: 25, Unidade Servida: Sala de Emergência
Item: Amoxicilina 250mg, Data: 2024-02-10, Quantidade Consumida: 10, Unidade Servida: Farmácia Principal
Item: Seringa 5ml, Data: 2024-03-05, Quantidade Consumida: 50, Unidade Servida: Ala Pediátrica`;

const exampleSeasonalPatterns = `Aumento do consumo de medicamentos para resfriado e gripe (ex: Paracetamol) durante os meses de inverno (Dezembro-Fevereiro).
Maior demanda por suprimentos de primeiros socorros (ex: Curativos, Gaze) durante o verão e períodos de férias devido ao aumento de atividades ao ar livre.`;

const exampleStrategicStockLevels = `Paracetamol 500mg (Sala de Emergência): Nível Estratégico 50 comprimidos, Quantidade Mínima 20 comprimidos.
Paracetamol 500mg (Armazém Central): Nível Estratégico 200 comprimidos, Quantidade Mínima 100 comprimidos.
Amoxicilina 250mg (Farmácia Principal): Nível Estratégico 100 cápsulas, Quantidade Mínima 30 cápsulas.
Seringa 5ml (Ala Pediátrica): Nível Estratégico 80 peças, Quantidade Mínima 40 peças.`;


export default function TrendsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalyzeConsumptionTrendsOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<TrendsFormData>({
    resolver: zodResolver(trendsSchema),
    defaultValues: {
      historicalData: exampleHistoricalData,
      seasonalPatterns: exampleSeasonalPatterns,
      strategicStockLevels: exampleStrategicStockLevels,
    },
  });

  const onSubmit = async (data: TrendsFormData) => {
    setIsLoading(true);
    setAnalysisResult(null);
    setError(null);
    try {
      const input: AnalyzeConsumptionTrendsInput = {
        historicalData: data.historicalData,
        seasonalPatterns: data.seasonalPatterns || 'Nenhum',
        strategicStockLevels: data.strategicStockLevels || 'Não especificado, usar melhores práticas gerais.',
      };
      const result = await analyzeConsumptionTrends(input);
      setAnalysisResult(result);
    } catch (e) {
      console.error("Erro ao analisar tendências:", e);
      setError("Falha ao analisar tendências de consumo. Por favor, tente novamente.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <PageHeader title="Análise de Tendências de Consumo" description="Utilize IA para visualizar padrões de uso e obter recomendações de reabastecimento." icon={TrendingUp} />
      
      <Card className="shadow-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle className="font-headline flex items-center gap-2">
                <Bot className="h-6 w-6 text-primary" /> Analisador de Tendências IA
              </CardTitle>
              <CardDescription>
                Forneça os dados necessários para a IA gerar insights. Você pode usar os dados de exemplo pré-preenchidos para testar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="historicalData"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dados Históricos de Consumo</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Insira dados históricos: Item, Data, Quantidade Consumida, Unidade Servida..." {...field} rows={6} />
                    </FormControl>
                    <FormDescription>Formato: Nome do Item, Data (AAAA-MM-DD), Quantidade Consumida, Nome da Unidade Servida (uma entrada por linha).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="seasonalPatterns"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Padrões Sazonais (Opcional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Descreva quaisquer padrões sazonais conhecidos ou digite 'Nenhum'..." {...field} rows={3} />
                    </FormControl>
                     <FormDescription>Ex: "Maior demanda por medicamentos para gripe no inverno."</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="strategicStockLevels"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Níveis Estratégicos de Estoque (Opcional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Descreva os níveis estratégicos de estoque para itens..." {...field} rows={4} />
                    </FormControl>
                    <FormDescription>Formato: Nome do Item (Localização): Nível Estratégico X unidades, Quantidade Mínima Y unidades (uma entrada por linha).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analisando...
                  </>
                ) : (
                  "Analisar Tendências"
                )}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      {error && (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {analysisResult && (
        <div className="mt-8 space-y-6">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="font-headline flex items-center gap-2">
                <Lightbulb className="h-6 w-6 text-primary" /> Resultados da Análise IA
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg mb-2 font-headline">Descrição das Visualizações de Tendência</h3>
                <p className="text-foreground/90 whitespace-pre-line">{analysisResult.trendVisualizations}</p>
              </div>
              <hr/>
              <div>
                <h3 className="font-semibold text-lg mb-2 font-headline">Recomendações de Reabastecimento</h3>
                <p className="text-foreground/90 whitespace-pre-line">{analysisResult.reorderRecommendations}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
