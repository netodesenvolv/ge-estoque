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
    setServedUnits(mockServedUnits);
  }, []);

  const handleEdit = (id: string) => {
    console.log('Editar unidade servida:', id);
  };

  const handleDelete = (id: string) => {
    console.log('Excluir unidade servida:', id);
    setServedUnits(prevUnits => prevUnits.filter(unit => unit.id !== id));
  };

  return (
    <div>
      <PageHeader
        title="Unidades Servidas"
        description="Gerencie locais ou departamentos que consomem estoque."
        icon={Users}
        actions={
          <Button asChild>
            <Link href="/served-units/add">
              <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Nova Unidade
            </Link>
          </Button>
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Todas as Unidades Servidas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
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
                            <TrendingUp className="mr-1 h-4 w-4" /> Registrar Consumo
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
                      Nenhuma unidade servida encontrada.
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
