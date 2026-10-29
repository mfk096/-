import type { WorkBook } from 'xlsx'
import type {
  equipmentWorkbook,
  journalWorkbook,
  verificationQueueWorkbook,
} from '@/lib/excel/build'

type EquipmentRows = Parameters<typeof equipmentWorkbook>[0]
type JournalRows = Parameters<typeof journalWorkbook>[0]
type QueueRows = Parameters<typeof verificationQueueWorkbook>[0]

async function save(book: WorkBook, filename: string) {
  const { downloadWorkbook } = await import('@/lib/excel/download')
  downloadWorkbook(book, filename)
}

export async function saveEquipmentWorkbook(rows: EquipmentRows, filename: string) {
  const { equipmentWorkbook } = await import('@/lib/excel/build')
  await save(equipmentWorkbook(rows), filename)
}

export async function saveJournalWorkbook(rows: JournalRows, filename: string) {
  const { journalWorkbook } = await import('@/lib/excel/build')
  await save(journalWorkbook(rows), filename)
}

export async function saveVerificationQueueWorkbook(rows: QueueRows, filename: string) {
  const { verificationQueueWorkbook } = await import('@/lib/excel/build')
  await save(verificationQueueWorkbook(rows), filename)
}
