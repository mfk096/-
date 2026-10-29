import {
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  History,
  Home,
  MapPin,
  QrCode,
  ScanLine,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  to: string
  label: string
  description: string
  icon: LucideIcon
  mobile?: boolean
}

export const navItems: NavItem[] = [
  {
    to: '/',
    label: 'Главная',
    description: 'Обзор разделов системы учёта оборудования.',
    icon: Home,
    mobile: true,
  },
  {
    to: '/units',
    label: 'Единицы',
    description: 'Конкретные экземпляры с кодами вида KYOC-001, статусом и местом установки.',
    icon: Boxes,
    mobile: true,
  },
  {
    to: '/history',
    label: 'Журнал',
    description: 'Лента перемещений и смен статуса: кто, когда, откуда и куда.',
    icon: History,
  },
  {
    to: '/nomenclature',
    label: 'Номенклатура',
    description: 'Типы и модели оборудования. У каждой модели свой префикс кода, например KYOC.',
    icon: Tags,
  },
  {
    to: '/locations',
    label: 'Места установки',
    description:
      'Дерево мест произвольной глубины: завод, цех, участок и дальше. У узла есть ответственный.',
    icon: MapPin,
  },
  {
    to: '/verifications',
    label: 'Поверки',
    description: 'График и журнал только для номенклатуры с флагом «Требует поверки».',
    icon: ClipboardCheck,
  },
  {
    to: '/import-export',
    label: 'Импорт/экспорт',
    description:
      'Загрузка номенклатуры, мест, сотрудников и единиц из Excel с проверкой и выгрузка списков.',
    icon: FileSpreadsheet,
  },
  {
    to: '/scan',
    label: 'Сканер',
    description: 'Камера считывает QR со ссылкой или с кодом единицы и открывает карточку.',
    icon: ScanLine,
    mobile: true,
  },
  {
    to: '/labels',
    label: 'Этикетки',
    description: 'Печать QR-этикеток. В QR ссылка на карточку, код единицы напечатан текстом.',
    icon: QrCode,
    mobile: true,
  },
  {
    to: '/users',
    label: 'Пользователи',
    description:
      'До десяти активных учётных записей. Регистрация закрыта, людей добавляет администратор.',
    icon: Users,
  },
]
