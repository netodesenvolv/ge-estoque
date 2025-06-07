
// src/ai/flows/analyze-consumption-trends.ts
'use server';

/**
 * @fileOverview Analisa dados históricos de consumo para visualizar tendências e gerar recomendações de reposição de estoque, considerando hospitais e unidades servidas.
 *
 * - analyzeConsumptionTrends - Uma função que analisa tendências de consumo e fornece recomendações de reposição.
 * - AnalyzeConsumptionTrendsInput - O tipo de entrada para a função analyzeConsumptionTrends.
 * - AnalyzeConsumptionTrendsOutput - O tipo de retorno para a função analyzeConsumptionTrends.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzeConsumptionTrendsInputSchema = z.object({
  historicalData: z
    .string()
    .describe(
      'Dados históricos de consumo, incluindo item, data, quantidade consumida, unidade servida e hospital.'
    ),
  seasonalPatterns: z
    .string()
    .describe(
      'Descrição de quaisquer padrões sazonais que afetam o consumo de itens.'
    ),
  strategicStockLevels: z
    .string()
    .describe(
      'Os níveis estratégicos de estoque para cada item no armazém central e unidades servidas (com hospital associado).'
    ),
});

export type AnalyzeConsumptionTrendsInput = z.infer<
  typeof AnalyzeConsumptionTrendsInputSchema
>;

const AnalyzeConsumptionTrendsOutputSchema = z.object({
  trendVisualizations: z
    .string()
    .describe(
      'Uma descrição das principais tendências de consumo, incluindo possivelmente variações sazonais e diferenças entre hospitais/unidades.'
    ),
  reorderRecommendations: z
    .string()
    .describe(
      'Recomendações específicas de reposição para cada item, considerando os níveis de estoque atuais, níveis estratégicos, consumo previsto e a localização (hospital/unidade ou armazém central).'
    ),
});

export type AnalyzeConsumptionTrendsOutput = z.infer<
  typeof AnalyzeConsumptionTrendsOutputSchema
>;

export async function analyzeConsumptionTrends(
  input: AnalyzeConsumptionTrendsInput
): Promise<AnalyzeConsumptionTrendsOutput> {
  return analyzeConsumptionTrendsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzeConsumptionTrendsPrompt',
  input: {schema: AnalyzeConsumptionTrendsInputSchema},
  output: {schema: AnalyzeConsumptionTrendsOutputSchema},
  prompt: `Você é um analista especialista em cadeia de suprimentos para uma rede de hospitais.

Você recebe dados históricos de consumo (incluindo hospital e unidade servida), descrições de padrões sazonais e níveis estratégicos de estoque (para armazém central e para cada unidade/hospital).

Analise os dados e gere visualizações de tendências e recomendações de reposição de estoque. Considere as diferenças de consumo entre diferentes hospitais e unidades servidas.

Dados Históricos: {{{historicalData}}}
Padrões Sazonais: {{{seasonalPatterns}}}
Níveis Estratégicos de Estoque: {{{strategicStockLevels}}}

Com base nessas informações, forneça o seguinte EM PORTUGUÊS:

Visualizações de Tendências: Uma descrição das principais tendências de consumo, incluindo variações sazonais e destacando quaisquer diferenças significativas ou padrões específicos por hospital ou unidade servida.
Recomendações de Reposição: Recomendações específicas de reposição para cada item, detalhando se a reposição é para o Armazém Central ou para uma unidade/hospital específico. Considere os níveis de estoque atuais, níveis estratégicos e consumo previsto para cada local.`,
});

const analyzeConsumptionTrendsFlow = ai.defineFlow(
  {
    name: 'analyzeConsumptionTrendsFlow',
    inputSchema: AnalyzeConsumptionTrendsInputSchema,
    outputSchema: AnalyzeConsumptionTrendsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);

