
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, PlusCircle, Edit3, Trash2, TrendingUp } from 'lucide-react';
import type { ServedUnit, Hospital } from '@/types';
import { mockServedUnits, mockHospitals } from '@/data/mockData';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


export default function ServedUnitsPage() {
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [hospitalFilter, setHospitalFilter] = useState('all');


  useEffect(() => {
    setServedUnits(mockServedUnits.map(unit => ({
      ...unit,
      hospitalName: mockHospitals.find(h => h.id === unit.hospitalId)?.name || 'Hospital Desconhecido'
    })));
    setHospitals(mockHospitals);
  }, []);

  const handleEdit = (id: string) => {
    console.log('Editar unidade servida:', id);
    // router.push(`/served-units/${id}/edit`); // Futuramente
  };

  const handleDelete = (id: string) => {
    console.log('Excluir unidade servida:', id);
    setServedUnits(prevUnits => prevUnits.filter(unit => unit.id !== id));
  };

  const filteredUnits = servedUnits.filter(unit => {
    const nameMatch = unit.name.toLowerCase().includes(searchTerm.toLowerCase());
    const hospitalMatch = hospitalFilter === 'all' || unit.hospitalId === hospitalFilter;
    return nameMatch && hospitalMatch;
  });


  return (
    <div>
      <PageHeader
        title="Unidades Servidas (Setores)"
        description="Gerencie locais ou departamentos que consomem estoque, organizados por hospital."
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
           <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              type="search"
              placeholder="Buscar por nome da unidade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full"
            />
            <Select value={hospitalFilter} onValueChange={setHospitalFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filtrar por Hospital" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Hospitais</SelectItem>
                {hospitals.map(hospital => (
                  <SelectItem key={hospital.id} value={hospital.id}>{hospital.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome da Unidade (Setor)</TableHead>
                  <TableHead>Hospital</TableHead>
                  <TableHead>Localização (no Hospital)</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUnits.length > 0 ? (
                  filteredUnits.map((unit) => (
                    <TableRow key={unit.id}>
                      <TableCell className="font-medium">{unit.name}</TableCell>
                      <TableCell>{unit.hospitalName}</TableCell>
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
                    <TableCell colSpan={4} className="text-center h-24">
                      Nenhuma unidade servida encontrada para os filtros atuais.
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
