import { useCallback, useState } from 'react'
import { uploadDocument, listDocuments, deleteDocument, type Document, type ChunkSettings } from '../api/client'

export function useDocuments() {
  const [docs, setDocs] = useState<Document[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await listDocuments()
      setDocs(res.data)
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Failed to load documents'
      console.error('[useDocuments] refresh error:', msg)
      setError(msg)
    }
  }, [])

  const upload = useCallback(async (file: File, chunkSettings?: ChunkSettings) => {
    setUploading(true)
    setUploadProgress(0)
    setError(null)
    console.log('[useDocuments] uploading:', file.name, chunkSettings)
    try {
      const res = await uploadDocument(file, chunkSettings, setUploadProgress)
      console.log('[useDocuments] upload response:', res.data)
      await refresh()
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? e?.message ?? 'Upload failed'
      console.error('[useDocuments] upload error:', msg)
      setError(msg)
    } finally {
      setUploading(false)
    }
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    try {
      await deleteDocument(id)
      await refresh()
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Delete failed'
      console.error('[useDocuments] delete error:', msg)
      setError(msg)
    }
  }, [refresh])

  return { docs, refresh, upload, remove, uploading, uploadProgress, error }
}
