'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ArrowRightLeft } from 'lucide-react';
import type { Item, ServedUnit, StockMovementType } from '@/types';
import { mockItems, mockServedUnits } from '@/data/mockData';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

const movementSchema = z.object({
  itemId: z.string().min(1, "Item selection is required."),
  type: z.enum(['entry', 'exit', 'consumption'], { required_error: "Movement type is required." }),
  quantity: z.coerce.number().positive("Quantity must be a positive number."),
  unitId: z.string().optional(), // Optional: for central warehouse, this is undefined/null
  date: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Invalid date." }),
  notes: z.string().optional(),
});

type MovementFormData = z.infer<typeof movementSchema>;

export default function StockMovementsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setItems(mockItems);
    setServedUnits(mockServedUnits);
  }, []);

  const form = useForm<MovementFormData>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      type: 'entry',
      quantity: 1,
      date: new Date().toISOString().split('T')[0], // Default to today
      notes: '',
    },
  });

  const movementType = form.watch('type');

  const onSubmit = (data: MovementFormData) => {
    console.log('Stock movement submitted:', data);
    // Simulate API call
    toast({
      title: "Stock Movement Recorded",
      description: `Movement of ${data.quantity} unit(s) of item ID ${data.itemId} has been recorded as ${data.type}.`,
    });
    form.reset();
    // Potentially redirect or update a list of movements
  };

  return (
    <div>
      <PageHeader title="Record Stock Movement" description="Register entries, exits, or consumptions of stock items." icon={ArrowRightLeft} />
      <Card className="max-w-2xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">New Stock Movement</CardTitle>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Movement Type</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1 md:flex-row md:space-y-0 md:space-x-4"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="entry" />
                          </FormControl>
                          <FormLabel className="font-normal">Stock Entry</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="exit" />
                          </FormControl>
                          <FormLabel className="font-normal">Stock Exit (Transfer)</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="consumption" />
                          </FormControl>
                          <FormLabel className="font-normal">Consumption</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="itemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Item</FormLabel>
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
              
              {(movementType === 'exit' || movementType === 'consumption') && (
                 <FormField
                    control={form.control}
                    name="unitId"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>
                        {movementType === 'exit' ? 'Destination Unit (Optional - for Central Warehouse transfer out)' : 'Consumed At (Served Unit)'}
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                            <SelectTrigger>
                            <SelectValue placeholder={movementType === 'exit' ? "Select destination or leave for Central exit" : "Select served unit"} />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            <SelectItem value="">Central Warehouse (if applicable for exit)</SelectItem>
                            {servedUnits.map(unit => (
                            <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>
                            ))}
                        </SelectContent>
                        </Select>
                        <FormDescription>
                          {movementType === 'exit' && "If transferring from Central Warehouse to a served unit, select the unit. If just reducing Central stock, leave blank."}
                          {movementType === 'consumption' && "Select the unit where the item was consumed."}
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                    )}
                />
              )}

              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="e.g., 10" {...field} />
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
                    <FormLabel>Date of Movement</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="e.g., Reason for movement, batch number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button type="submit">Record Movement</Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
