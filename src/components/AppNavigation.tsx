
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
  UserPlus,
  Contact,
  FileText,
  BarChart3,
  UserCheck,
  CalendarClock,
  History,
  ChevronDown,
  ListChecks,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SidebarMenuItem,
  SidebarMenuButton,
  sidebarMenuButtonVariants,
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
    label: 'Pacientes',
    icon: Contact,
    subItems: [
      { href: '/patients', label: 'Ver Pacientes', icon: Users },
      { href: '/patients/add', label: 'Adicionar Paciente', icon: UserPlus },
    ],
  },
  {
    label: 'Hospitais e UBS',
    icon: Building,
    subItems: [
      { href: '/hospitals', label: 'Ver Hospitais/UBS', icon: Building },
      { href: '/hospitals/add', label: 'Adicionar Hospital/UBS', icon: PlusCircle },
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
  { href: '/trends', label: 'Tendências de Consumo', icon: TrendingUp },
  {
    label: 'Relatórios',
    icon: FileText,
    subItems: [
      { href: '/reports/general-consumption', label: 'Consumo Geral', icon: BarChart3 },
      { href: '/reports/patient-consumption', label: 'Consumo por Paciente', icon: UserCheck },
      { href: '/reports/expiring-items', label: 'Itens a Vencer', icon: CalendarClock },
      { href: '/reports/consumption-history', label: 'Histórico de Consumo', icon: History },
      { href: '/reports/low-stock-levels', label: 'Níveis Baixos/Alerta', icon: ListChecks },
    ],
  },
  {
    label: 'Configuração',
    icon: Settings2,
    subItems: [
      { href: '/config/stock-levels', label: 'Níveis Estratégicos', icon: ShoppingCart },
    ],
  },
];

export default function AppNavigation() {
  const pathname = usePathname();
  const { state: sidebarState, isMobile } = useSidebar();

  const defaultOpenAccordionItems = navItems.reduce<string[]>((acc, item, index) => {
    if (item.subItems && item.subItems.some(sub => pathname.startsWith(sub.href))) {
      acc.push(`item-${index}`);
    }
    return acc;
  }, []);


  return (
    <nav className="flex flex-col p-2">
      <Accordion type="multiple" className="w-full" defaultValue={defaultOpenAccordionItems}>
        {navItems.map((item, index) => {
          const isDirectActive = !item.subItems && pathname === item.href;
          const isSubItemActive = item.subItems && item.subItems.some(sub => pathname.startsWith(sub.href));
          const isActive = isDirectActive || isSubItemActive;

          const menuItemContent = item.subItems ? (
            <AccordionItem value={`item-${index}`} key={item.label} className="border-none">
              <Tooltip>
                <TooltipTrigger asChild>
                  <AccordionTrigger
                    asChild
                    className={cn(
                      sidebarMenuButtonVariants({ size: 'default' }),
                       "w-full justify-between text-base font-normal text-left p-2 group/accordion",
                       isActive && !isDirectActive && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 font-medium"
                    )}
                  >
                     <SidebarMenuButton
                        className={cn(
                          isActive && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 font-medium",
                           "w-full justify-between"
                        )}
                        isActive={isActive}
                        // variant="ghost" // Ensure this does not override accordion trigger styles
                      >
                        <span className="flex items-center gap-2">
                          <item.icon className="h-5 w-5" />
                          {(sidebarState === 'expanded' || isMobile) && <span className="truncate">{item.label}</span>}
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]/accordion:rotate-180" />
                      </SidebarMenuButton>
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
                          className={cn(
                            "w-full justify-start text-sm",
                             pathname.startsWith(subItem.href)
                              ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                              : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          )}
                          isActive={pathname.startsWith(subItem.href)}
                        >
                           <span className="flex items-center gap-2 truncate">
                            <subItem.icon className="h-4 w-4" />
                            {subItem.label}
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
