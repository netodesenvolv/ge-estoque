
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, PlusCircle, Edit3, Trash2, TrendingUp, Search } from 'lucide-react';
import type { ServedUnit, Hospital } from '@/types';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';


export default function ServedUnitsPage() {
  const [servedUnits, setServedUnits] = useState<ServedUnit[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [hospitalFilter, setHospitalFilter] = useState('all');
  const router = useRouter();
  const { toast } = useToast();


  useEffect(() => {
    const hospitalsCollectionRef = collection(firestore, "hospitals");
    const qHospitals = query(hospitalsCollectionRef, orderBy("name", "asc"));
    const unsubscribeHospitals = onSnapshot(qHospitals, (querySnapshot) => {
      setHospitals(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital)));
    }, (error) => {
      console.error("Erro ao buscar hospitais: ", error);
      toast({ title: "Erro ao Carregar Hospitais", variant: "destructive" });
    });

    const servedUnitsCollectionRef = collection(firestore, "servedUnits");
    const qServedUnits = query(servedUnitsCollectionRef, orderBy("name", "asc"));
    const unsubscribeServedUnits = onSnapshot(qServedUnits, (querySnapshot) => {
      const unitsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as ServedUnit));
      setServedUnits(unitsData);
    }, (error) => {
      console.error("Erro ao buscar unidades servidas: ", error);
      toast({ title: "Erro ao Carregar Unidades Servidas", variant: "destructive" });
    });

    return () => {
      unsubscribeHospitals();
      unsubscribeServedUnits();
    };
  }, [toast]);

  const handleEdit = (id: string) => {
    // router.push(`/served-units/${id}/edit`); // Futuramente
     toast({
      title: "Funcionalidade Pendente",
      description: `A edição da unidade com ID: ${id} ainda não foi implementada.`,
    });
  };

  const handleDelete = async (id: string) => {
    const unitDocRef = doc(firestore, "servedUnits", id);
    try {
      await deleteDoc(unitDocRef);
      toast({
        title: "Unidade Servida Excluída",
        description: "A unidade foi removida do banco de dados.",
      });
    } catch (error) {
      console.error("Erro ao excluir unidade: ", error);
      toast({
        title: "Erro ao Excluir",
        description: "Não foi possível excluir a unidade. Tente novamente.",
        variant: "destructive",
      });
    }
  };
  
  const getHospitalName = (hospitalId: string) => {
    return hospitals.find(h => h.id === hospitalId)?.name || 'Hospital Desconhecido';
  };

  const filteredUnits = servedUnits.filter(unit => {
    const nameMatch = unit.name.toLowerCase().includes(searchTerm.toLowerCase());
    const hospitalMatch = hospitalFilter === 'all' || unit.hospitalId === hospitalFilter;
    return nameMatch && hospitalMatch;
  }).map(unit => ({
      ...unit,
      hospitalName: getHospitalName(unit.hospitalId)
  }));


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
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Buscar por nome da unidade..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10"
                />
            </div>
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
