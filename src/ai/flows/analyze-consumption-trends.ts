// src/ai/flows/analyze-consumption-trends.ts
'use server';

/**
 * @fileOverview Analisa dados históricos de consumo para visualizar tendências e gerar recomendações de reposição de estoque.
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
      'Dados históricos de consumo, incluindo item, data, quantidade consumida e unidade servida.'
    ),
  seasonalPatterns: z
    .string()
    .describe(
      'Descrição de quaisquer padrões sazonais que afetam o consumo de itens.'
    ),
  strategicStockLevels: z
    .string()
    .describe(
      'Os níveis estratégicos de estoque para cada item no armazém central e unidades servidas.'
    ),
});

export type AnalyzeConsumptionTrendsInput = z.infer<
  typeof AnalyzeConsumptionTrendsInputSchema
>;

const AnalyzeConsumptionTrendsOutputSchema = z.object({
  trendVisualizations: z
    .string()
    .describe(
      'Uma descrição das principais tendências de consumo, incluindo possivelmente variações sazonais.'
    ),
  reorderRecommendations: z
    .string()
    .describe(
      'Recomendações específicas de reposição para cada item, considerando os níveis de estoque atuais, níveis estratégicos e consumo previsto.'
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
  prompt: `Você é um analista especialista em cadeia de suprimentos.

Você recebe dados históricos de consumo, descrições de padrões sazonais e níveis estratégicos de estoque.

Analise os dados e gere visualizações de tendências e recomendações de reposição de estoque.

Dados Históricos: {{{historicalData}}}
Padrões Sazonais: {{{seasonalPatterns}}}
Níveis Estratégicos de Estoque: {{{strategicStockLevels}}}

Com base nessas informações, forneça o seguinte EM PORTUGUÊS:

Visualizações de Tendências: Uma descrição das principais tendências de consumo, incluindo possivelmente variações sazonais.
Recomendações de Reposição: Recomendações específicas de reposição para cada item, considerando os níveis de estoque atuais, níveis estratégicos e consumo previsto.`,
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
