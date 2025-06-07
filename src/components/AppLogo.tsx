import Link from 'next/link';
import { Package } from 'lucide-react';

export default function AppLogo() {
  return (
    <Link href="/" className="flex items-center gap-2" prefetch={false}>
      <Package className="h-6 w-6 text-primary" />
      <span className="font-headline text-xl font-semibold text-foreground">
        GE-Gestão de Estoque
      </span>
    </Link>
  );
}
