import type { Queryable } from '../../db/queryable.js'

export async function assertDatabaseReady(db: Queryable): Promise<void> {
  await db.query('SELECT 1')
}

export async function registerUploadedFile(db: Queryable, companyId: string, userId: string, key: string, documentId: string | null): Promise<void> {
  const result = await db.query(`INSERT INTO uploaded_files(storage_key,company_id,owner_user_id,company_period_id,document_id)
    SELECT $1,$2,$3,period_id,$4 FROM company_memberships WHERE company_id=$2 AND user_id=$3
      AND ended_at IS NULL AND status='ACTIVE'`, [key,companyId,userId,documentId])
  if (result.rowCount !== 1) throw new Error('active membership required for upload')
}
