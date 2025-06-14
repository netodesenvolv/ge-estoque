
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building, PlusCircle, Edit3, Trash2, Search } from 'lucide-react';
import type { Hospital } from '@/types';
import { Input } from '@/components/ui/input';
import { firestore } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

export default function HospitalsPage() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const hospitalsCollectionRef = collection(firestore, "hospitals");
    const q = query(hospitalsCollectionRef, orderBy("name", "asc"));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const hospitalsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as Hospital));
      setHospitals(hospitalsData);
    }, (error) => {
      console.error("Erro ao buscar hospitais: ", error);
      toast({
        title: "Erro ao Carregar Hospitais/UBS",
        description: "Não foi possível carregar os hospitais/UBS do banco de dados.",
        variant: "destructive",
      });
    });

    return () => unsubscribe();
  }, [toast]);

  const filteredHospitals = hospitals.filter(hospital =>
    hospital.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (hospital.address && hospital.address.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleEdit = (id: string) => {
    router.push(`/hospitals/${id}/edit`);
  };

  const handleDelete = async (id: string) => {
    const hospitalDocRef = doc(firestore, "hospitals", id);
    try {
      await deleteDoc(hospitalDocRef);
      toast({
        title: "Hospital/UBS Excluído",
        description: "O hospital/UBS foi removido do banco de dados.",
      });
    } catch (error) {
      console.error("Erro ao excluir hospital/UBS: ", error);
      toast({
        title: "Erro ao Excluir",
        description: "Não foi possível excluir o hospital/UBS. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Hospitais e UBS"
        description="Gerencie os hospitais e UBS atendidos pelo almoxarifado."
        icon={Building}
        actions={
          <Button asChild>
            <Link href="/hospitals/add">
              <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Hospital/UBS
            </Link>
          </Button>
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Todos os Hospitais e UBS</CardTitle>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por nome ou endereço..."
              className="pl-10 w-full md:w-1/2"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
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
                {filteredHospitals.length > 0 ? (
                  filteredHospitals.map((hospital) => (
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
                      Nenhum hospital ou UBS encontrado.
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
