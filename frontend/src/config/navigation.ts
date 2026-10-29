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
  stage: string
  icon: LucideIcon
  mobile?: boolean
}

export const navItems: NavItem[] = [
  {
    to: '/',
    label: 'Главная',
    description: 'Обзор разделов системы учёта оборудования.',
    stage: 'Этап 1',
    icon: Home,
    mobile: true,
  },
  {
    to: '/units',
    label: 'Единицы',
    description: 'Конкретные экземпляры с кодами вида KYOC-001, статусом и местом установки.',
    stage: 'Доступно',
    icon: Boxes,
    mobile: true,
  },
  {
    to: '/history',
    label: 'Журнал',
    description: 'Лента перемещений и смен статуса: кто, когда, откуда и куда.',
    stage: 'Доступно',
    icon: History,
  },
  {
    to: '/nomenclature',
    label: 'Номенклатура',
    description: 'Типы и модели оборудования. У каждой модели свой префикс кода, например KYOC.',
    stage: 'Доступно',
    icon: Tags,
  },
  {
    to: '/locations',
    label: 'Места установки',
    description:
      'Дерево мест произвольной глубины: завод, цех, участок и дальше. У узла есть ответственный.',
    stage: 'Доступно',
    icon: MapPin,
  },
  {
    to: '/verifications',
    label: 'Поверки',
    description: 'График и журнал только для номенклатуры с флагом «Требует поверки».',
    stage: 'Этап 6',
    icon: ClipboardCheck,
  },
  {
    to: '/import-export',
    label: 'Импорт/экспорт',
    description:
      'Загрузка номенклатуры, мест и единиц из Excel с проверкой и выгрузка текущих списков.',
    stage: 'Этап 6',
    icon: FileSpreadsheet,
  },
  {
    to: '/scan',
    label: 'Сканер',
    description: 'Камера считывает QR с кодом единицы и открывает карточку.',
    stage: 'Доступно',
    icon: ScanLine,
    mobile: true,
  },
  {
    to: '/labels',
    label: 'Этикетки',
    description: 'Печать QR-этикеток. В коде только номер единицы, без адреса сервера.',
    stage: 'Доступно',
    icon: QrCode,
    mobile: true,
  },
  {
    to: '/users',
    label: 'Пользователи',
    description: 'До десяти учётных записей. Регистрация закрыта, людей добавляет администратор.',
    stage: 'После профилей в базе',
    icon: Users,
  },
]
