'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, PlusCircle, Edit3, Trash2, TrendingUp, Eye } from 'lucide-react';
import type { ServedUnit } from '@/types';
import { mockServedUnits } from '@/data/mockData';

export default function ServedUnitsPage() {
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);

  useEffect(() => {
    // Simulate API call
    setServedUnits(mockServedUnits);
  }, []);

  const handleEdit = (id: string) => {
    console.log('Edit served unit:', id);
    // router.push(`/served-units/${id}/edit`);
  };

  const handleDelete = (id: string) => {
    console.log('Delete served unit:', id);
    setServedUnits(prevUnits => prevUnits.filter(unit => unit.id !== id));
  };

  return (
    <div>
      <PageHeader
        title="Served Units"
        description="Manage locations or departments that consume stock."
        icon={Users}
        actions={
          <Button asChild>
            <Link href="/served-units/add">
              <PlusCircle className="mr-2 h-4 w-4" /> Add New Unit
            </Link>
          </Button>
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">All Served Units</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servedUnits.length > 0 ? (
                  servedUnits.map((unit) => (
                    <TableRow key={unit.id}>
                      <TableCell className="font-medium">{unit.name}</TableCell>
                      <TableCell>{unit.location}</TableCell>
                      <TableCell className="text-center space-x-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/served-units/${unit.id}/consumption`}>
                            <TrendingUp className="mr-1 h-4 w-4" /> Record Consumption
                          </Link>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(unit.id)} className="hover:text-primary">
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(unit.id)} className="hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center h-24">
                      No served units found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
