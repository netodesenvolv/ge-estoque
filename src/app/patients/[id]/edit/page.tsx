
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import PatientForm, { type PatientFormData } from '@/components/forms/PatientForm';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import { UserCog, Loader2 } from 'lucide-react'; // Changed icon to UserCog
import type { Patient } from '@/types';

export default function EditPatientPage() {
  const params = useParams();
  const router = useRouter();
  const patientId = params.id as string;

  const [patientData, setPatientData] = useState<Partial<PatientFormData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) {
      setError("ID do paciente não fornecido.");
      setLoading(false);
      return;
    }

    const fetchPatient = async () => {
      setLoading(true);
      setError(null);
      try {
        const patientDocRef = doc(firestore, 'patients', patientId);
        const patientSnap = await getDoc(patientDocRef);

        if (patientSnap.exists()) {
          const data = patientSnap.data() as Patient;
          // Garantir que os campos opcionais sejam strings vazias ou o valor, e datas sejam no formato AAAA-MM-DD
          setPatientData({
            name: data.name,
            susCardNumber: data.susCardNumber,
            birthDate: data.birthDate || '', // Assegurar que é string
            address: data.address || '',
            phone: data.phone || '',
            sex: data.sex || undefined,
            healthAgentName: data.healthAgentName || '',
            registeredUBSId: data.registeredUBSId || undefined,
            // registeredUBSName não é parte do PatientFormData, mas é bom ter no 'data'
          });
        } else {
          setError('Paciente não encontrado.');
        }
      } catch (err) {
        console.error("Erro ao buscar paciente:", err);
        setError('Falha ao carregar o paciente.');
      } finally {
        setLoading(false);
      }
    };

    fetchPatient();
  }, [patientId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Carregando dados do paciente...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <PageHeader title="Erro" description={error} icon={UserCog} />
        <Button onClick={() => router.push('/patients')}>Voltar para a Lista de Pacientes</Button>
      </div>
    );
  }

  if (!patientData) {
     return (
      <div className="container mx-auto py-8">
        <PageHeader title="Erro" description="Dados do paciente não puderam ser carregados." icon={UserCog} />
        <Button onClick={() => router.push('/patients')}>Voltar para a Lista de Pacientes</Button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Editar Paciente"
        description={`Modificando detalhes para: ${patientData?.name || 'Carregando...'}`}
        icon={UserCog}
      />
      <PatientForm initialData={patientData} patientId={patientId} />
    </div>
  );
}
