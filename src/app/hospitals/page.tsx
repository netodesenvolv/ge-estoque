
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building, PlusCircle, Edit3, Trash2 } from 'lucide-react';
import type { Hospital } from '@/types';
import { mockHospitals } from '@/data/mockData';

export default function HospitalsPage() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);

  useEffect(() => {
    setHospitals(mockHospitals);
  }, []);

  const handleEdit = (id: string) => {
    console.log('Editar hospital:', id);
    // router.push(`/hospitals/${id}/edit`); // Futuramente
  };

  const handleDelete = (id: string) => {
    console.log('Excluir hospital:', id);
    setHospitals(prevHospitals => prevHospitals.filter(hospital => hospital.id !== id));
    // Adicionar toast de sucesso/erro
  };

  return (
    <div>
      <PageHeader
        title="Hospitais"
        description="Gerencie os hospitais atendidos pelo almoxarifado."
        icon={Building}
        actions={
          <Button asChild>
            <Link href="/hospitals/add">
              <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Hospital
            </Link>
          </Button>
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Todos os Hospitais</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Endereço</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hospitals.length > 0 ? (
                  hospitals.map((hospital) => (
                    <TableRow key={hospital.id}>
                      <TableCell className="font-medium">{hospital.name}</TableCell>
                      <TableCell>{hospital.address || 'N/A'}</TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(hospital.id)} className="hover:text-primary mr-2">
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(hospital.id)} className="hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center h-24">
                      Nenhum hospital encontrado.
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
