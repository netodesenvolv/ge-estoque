// src/ai/flows/analyze-consumption-trends.ts
'use server';

/**
 * @fileOverview Analyzes historical consumption data to visualize trends and generate stock reorder recommendations.
 *
 * - analyzeConsumptionTrends - A function that analyzes consumption trends and provides reorder recommendations.
 * - AnalyzeConsumptionTrendsInput - The input type for the analyzeConsumptionTrends function.
 * - AnalyzeConsumptionTrendsOutput - The return type for the analyzeConsumptionTrends function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzeConsumptionTrendsInputSchema = z.object({
  historicalData: z
    .string()
    .describe(
      'Historical consumption data, including item, date, quantity consumed, and served unit.'
    ),
  seasonalPatterns: z
    .string()
    .describe(
      'Description of any seasonal patterns affecting consumption of items.'
    ),
  strategicStockLevels: z
    .string()
    .describe(
      'The strategic stock levels for each item in central warehouse and served units.'
    ),
});

export type AnalyzeConsumptionTrendsInput = z.infer<
  typeof AnalyzeConsumptionTrendsInputSchema
>;

const AnalyzeConsumptionTrendsOutputSchema = z.object({
  trendVisualizations: z
    .string()
    .describe(
      'A description of key trends in consumption, potentially including seasonal variations.'
    ),
  reorderRecommendations: z
    .string()
    .describe(
      'Specific reorder recommendations for each item, considering current stock levels, strategic levels, and predicted consumption.'
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
  prompt: `You are an expert supply chain analyst.

You are provided with historical consumption data, descriptions of seasonal patterns, and strategic stock levels.

Analyze the data and generate visualizations of trends and stock reorder recommendations.

Historical Data: {{{historicalData}}}
Seasonal Patterns: {{{seasonalPatterns}}}
Strategic Stock Levels: {{{strategicStockLevels}}}

Based on this information, provide the following:

Trend Visualizations: A description of key trends in consumption, potentially including seasonal variations.
Reorder Recommendations: Specific reorder recommendations for each item, considering current stock levels, strategic levels, and predicted consumption.`,
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
