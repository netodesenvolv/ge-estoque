'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { TrendingDown, CheckCircle } from 'lucide-react';
import type { Item, ServedUnit } from '@/types';
import { mockItems, mockServedUnits } from '@/data/mockData';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useParams, useRouter } from 'next/navigation';

const consumptionSchema = z.object({
  itemId: z.string().min(1, "Item selection is required."),
  quantityConsumed: z.coerce.number().positive("Quantity must be a positive number."),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Invalid date." }),
});

type ConsumptionFormData = z.infer<typeof consumptionSchema>;

export default function RecordConsumptionPage() {
  const params = useParams();
  const unitId = params.id as string;
  const [items, setItems] = useState<Item[]>([]);
  const [servedUnit, setServedUnit] = useState<ServedUnit | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setItems(mockItems);
    const unit = mockServedUnits.find(u => u.id === unitId);
    setServedUnit(unit || null);
  }, [unitId]);

  const form = useForm<ConsumptionFormData>({
    resolver: zodResolver(consumptionSchema),
    defaultValues: {
      quantityConsumed: 1,
      date: new Date().toISOString().split('T')[0],
    },
  });

  const onSubmit = (data: ConsumptionFormData) => {
    console.log('Stock consumption submitted:', { ...data, servedUnitId: unitId });
    toast({
      title: "Consumption Recorded",
      description: `${data.quantityConsumed} unit(s) of item ID ${data.itemId} consumed at ${servedUnit?.name}.`,
      action: <CheckCircle className="text-green-500" />,
    });
    form.reset({ 
        quantityConsumed: 1, 
        date: new Date().toISOString().split('T')[0],
        itemId: '' 
    });
  };

  if (!servedUnit) {
    return <PageHeader title="Error" description="Served unit not found." />;
  }

  return (
    <div className="container mx-auto py-2 max-w-md">
      <PageHeader 
        title={`Record Consumption`} 
        description={`For ${servedUnit.name} (${servedUnit.location})`} 
        icon={TrendingDown} 
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl">Log Item Consumption</CardTitle>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="itemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item Consumed</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an item" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {items.map(item => (
                          <SelectItem key={item.id} value={item.id}>{item.name} ({item.code})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="quantityConsumed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity Consumed</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="e.g., 1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of Consumption</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full">Record Consumption</Button>
              <Button type="button" variant="outline" onClick={() => router.back()} className="w-full">
                Back to Units
            </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
