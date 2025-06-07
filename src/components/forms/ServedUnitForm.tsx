'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import type { ServedUnit } from '@/types';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

const servedUnitSchema = z.object({
  name: z.string().min(2, { message: "Unit name must be at least 2 characters." }),
  location: z.string().min(2, { message: "Location is required." }),
});

type ServedUnitFormData = z.infer<typeof servedUnitSchema>;

interface ServedUnitFormProps {
  initialData?: ServedUnit;
  onSubmitSuccess?: (data: ServedUnit) => void;
}

export default function ServedUnitForm({ initialData, onSubmitSuccess }: ServedUnitFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<ServedUnitFormData>({
    resolver: zodResolver(servedUnitSchema),
    defaultValues: initialData || {
      name: '',
      location: '',
    },
  });

  const onSubmit = (data: ServedUnitFormData) => {
    console.log('Served unit form submitted:', data);
    const unitId = initialData?.id || Math.random().toString(36).substring(2, 15);
    const submittedUnit: ServedUnit = { ...data, id: unitId };
    
    if (onSubmitSuccess) {
      onSubmitSuccess(submittedUnit);
    } else {
      toast({
        title: initialData ? "Served Unit Updated" : "Served Unit Added",
        description: `${data.name} has been successfully ${initialData ? 'updated' : 'added'}.`,
      });
      router.push('/served-units');
    }
  };

  return (
    <Card className="max-w-lg mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">{initialData ? 'Edit Served Unit' : 'Add New Served Unit'}</CardTitle>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Emergency Room, Pediatrics Ward" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Floor 1, Wing A" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit">
              {initialData ? 'Save Changes' : 'Add Unit'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
