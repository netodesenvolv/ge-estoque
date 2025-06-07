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
  historicalData: z.string().min(10, "Please provide some historical consumption data."),
  seasonalPatterns: z.string().min(5, "Describe any seasonal patterns or type 'None'.").optional(),
  strategicStockLevels: z.string().min(10, "Please provide strategic stock level information.").optional(),
});

type TrendsFormData = z.infer<typeof trendsSchema>;

// Example placeholder data based on your types/mockData
const exampleHistoricalData = `Item: Paracetamol 500mg, Date: 2024-01-15, Quantity Consumed: 20, Served Unit: Emergency Room
Item: Paracetamol 500mg, Date: 2024-01-22, Quantity Consumed: 25, Served Unit: Emergency Room
Item: Amoxicilina 250mg, Date: 2024-02-10, Quantity Consumed: 10, Served Unit: Pharmacy Main
Item: Syringe 5ml, Date: 2024-03-05, Quantity Consumed: 50, Served Unit: Pediatrics Ward`;

const exampleSeasonalPatterns = `Increased consumption of cold and flu medication (e.g., Paracetamol) during winter months (December-February).
Higher demand for first-aid supplies (e.g., Band-Aids, Gauze) during summer and holiday periods due to increased outdoor activities.`;

const exampleStrategicStockLevels = `Paracetamol 500mg (Emergency Room): Strategic Level 50 tablets, Min Quantity 20 tablets.
Paracetamol 500mg (Central Warehouse): Strategic Level 200 tablets, Min Quantity 100 tablets.
Amoxicilina 250mg (Pharmacy Main): Strategic Level 100 capsules, Min Quantity 30 capsules.
Syringe 5ml (Pediatrics Ward): Strategic Level 80 pieces, Min Quantity 40 pieces.`;


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
        seasonalPatterns: data.seasonalPatterns || 'None',
        strategicStockLevels: data.strategicStockLevels || 'Not specified, use general best practices.',
      };
      const result = await analyzeConsumptionTrends(input);
      setAnalysisResult(result);
    } catch (e) {
      console.error("Error analyzing trends:", e);
      setError("Failed to analyze consumption trends. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <PageHeader title="Consumption Trend Analysis" description="Utilize AI to visualize usage patterns and get reorder recommendations." icon={TrendingUp} />
      
      <Card className="shadow-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle className="font-headline flex items-center gap-2">
                <Bot className="h-6 w-6 text-primary" /> AI Trend Analyzer
              </CardTitle>
              <CardDescription>
                Provide the necessary data for the AI to generate insights. You can use the pre-filled example data to test.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="historicalData"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Historical Consumption Data</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Enter historical data: Item, Date, Quantity Consumed, Served Unit..." {...field} rows={6} />
                    </FormControl>
                    <FormDescription>Format: Item Name, Date (YYYY-MM-DD), Quantity Consumed, Served Unit Name (one entry per line).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="seasonalPatterns"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Seasonal Patterns (Optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Describe any known seasonal patterns or type 'None'..." {...field} rows={3} />
                    </FormControl>
                     <FormDescription>E.g., "Higher flu medicine demand in winter."</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="strategicStockLevels"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Strategic Stock Levels (Optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Describe strategic stock levels for items..." {...field} rows={4} />
                    </FormControl>
                    <FormDescription>Format: Item Name (Location): Strategic Level X units, Min Quantity Y units (one entry per line).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing...
                  </>
                ) : (
                  "Analyze Trends"
                )}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      {error && (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {analysisResult && (
        <div className="mt-8 space-y-6">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="font-headline flex items-center gap-2">
                <Lightbulb className="h-6 w-6 text-primary" /> AI Analysis Results
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg mb-2 font-headline">Trend Visualizations Description</h3>
                <p className="text-foreground/90 whitespace-pre-line">{analysisResult.trendVisualizations}</p>
              </div>
              <hr/>
              <div>
                <h3 className="font-semibold text-lg mb-2 font-headline">Reorder Recommendations</h3>
                <p className="text-foreground/90 whitespace-pre-line">{analysisResult.reorderRecommendations}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
