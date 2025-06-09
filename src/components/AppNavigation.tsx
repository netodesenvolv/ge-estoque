
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Package,
  PlusCircle,
  Archive,
  ArrowRightLeft,
  Warehouse,
  Users,
  Settings2,
  TrendingUp,
  ShoppingCart,
  ClipboardList,
  Building,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SidebarMenuItem,
  SidebarMenuButton,
  sidebarMenuButtonVariants, // Importando as variantes
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  useSidebar,
} from '@/components/ui/sidebar';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';


const navItems = [
  { href: '/', label: 'Painel', icon: Home },
  {
    label: 'Catálogo',
    icon: Package,
    subItems: [
      { href: '/items', label: 'Ver Itens', icon: Archive },
      { href: '/items/add', label: 'Adicionar Item', icon: PlusCircle },
    ],
  },
  {
    label: 'Estoque',
    icon: Warehouse,
    subItems: [
      { href: '/stock', label: 'Estoque Atual', icon: ClipboardList },
      { href: '/stock/movements', label: 'Registrar Movimentação', icon: ArrowRightLeft },
    ],
  },
  {
    label: 'Hospitais',
    icon: Building,
    subItems: [
      { href: '/hospitals', label: 'Ver Hospitais', icon: Building },
      { href: '/hospitals/add', label: 'Adicionar Hospital', icon: PlusCircle },
    ],
  },
  {
    label: 'Unidades Servidas',
    icon: Users,
    subItems: [
      { href: '/served-units', label: 'Ver Unidades', icon: Users },
      { href: '/served-units/add', label: 'Adicionar Unidade', icon: PlusCircle },
    ],
  },
  {
    label: 'Configuração',
    icon: Settings2,
    subItems: [
      { href: '/config/stock-levels', label: 'Níveis Estratégicos', icon: ShoppingCart },
    ],
  },
  { href: '/trends', label: 'Tendências de Consumo', icon: TrendingUp },
];

export default function AppNavigation() {
  const pathname = usePathname();
  const { state: sidebarState, isMobile } = useSidebar();

  return (
    <nav className="flex flex-col p-2">
      <Accordion type="multiple" className="w-full">
        {navItems.map((item, index) => {
          const isActive = item.subItems ?
                           item.subItems.some(sub => pathname === sub.href || pathname.startsWith(sub.href + '/')) :
                           pathname === item.href;

          const menuItemContent = item.subItems ? (
            <AccordionItem value={`item-${index}`} key={item.label} className="border-none">
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* AccordionTrigger NÃO usa asChild aqui. Ele é o botão. */}
                  <AccordionTrigger
                    className={cn(
                      sidebarMenuButtonVariants({ size: 'default' }), // Aplicando estilos base do SidebarMenuButton
                      "w-full justify-between text-base font-normal text-left p-2", // Ajuste de padding e justify
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      "focus-visible:ring-2 focus-visible:ring-sidebar-ring outline-none",
                      isActive && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 font-medium",
                      // A rotação do chevron é tratada pelo AccordionTrigger interno quando não é asChild
                    )}
                  >
                    {/* Conteúdo visual do botão/trigger */}
                    <span className="flex items-center gap-2">
                      <item.icon className="h-5 w-5" />
                      {(sidebarState === 'expanded' || isMobile) && <span className="truncate">{item.label}</span>}
                    </span>
                    {/* O ChevronDown é renderizado pelo AccordionTrigger (de ui/accordion.tsx)
                        quando sua prop asChild é false (que é o caso aqui).
                        Os estilos de rotação estão em ui/accordion.tsx:
                        "[&[data-state=open]>svg]:rotate-180"
                        Se precisarmos de um chevron customizado aqui, podemos adicioná-lo.
                    */}
                  </AccordionTrigger>
                </TooltipTrigger>
                <TooltipContent side="right" align="center" hidden={sidebarState === "expanded" || isMobile}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
              <AccordionContent className="pb-0 pl-4 border-l border-sidebar-border ml-[18px]">
                <SidebarMenuSub className="border-none p-0 m-0">
                  {item.subItems.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.href}>
                      <Link href={subItem.href}>
                        <SidebarMenuSubButton
                          asChild
                          className={cn(
                            "w-full justify-start text-sm",
                            pathname === subItem.href && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                          )}
                          isActive={pathname === subItem.href}
                        >
                          <span className="flex items-center gap-2">
                            <subItem.icon className="h-4 w-4" />
                            <span className="truncate">{subItem.label}</span>
                          </span>
                        </SidebarMenuSubButton>
                      </Link>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </AccordionContent>
            </AccordionItem>
          ) : (
            <SidebarMenuItem key={item.href}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href={item.href}>
                     <SidebarMenuButton
                        asChild
                        className={cn(
                          "w-full justify-start text-base",
                          isActive && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                        )}
                        isActive={isActive}
                      >
                        <span className="flex items-center gap-2">
                          <item.icon className="h-5 w-5" />
                          {(sidebarState === 'expanded' || isMobile) && <span className="truncate">{item.label}</span>}
                        </span>
                      </SidebarMenuButton>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" align="center" hidden={sidebarState === "expanded" || isMobile}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            </SidebarMenuItem>
          );

          return menuItemContent;
        })}
      </Accordion>
    </nav>
  );
}

    