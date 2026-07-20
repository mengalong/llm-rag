import { useRef, useState, type DragEvent } from 'react'
import styles from './FileUpload.module.css'

interface Props {
  onUpload: (file: File) => void
  onNewChat?: () => void
  uploading: boolean
  progress: number
}

export default function FileUpload({ onUpload, onNewChat, uploading, progress }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(onUpload)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div>
      {onNewChat && (
        <button className={styles.newBtn} onClick={onNewChat}>
          <span>＋</span> 新建对话
        </button>
      )}
      <div
        className={`${styles.dropzone} ${dragging ? styles.dragging : ''} ${uploading ? styles.uploading : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.txt,.md,.markdown"
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploading ? (
          <div className={styles.progressWrap}>
            <div className={styles.progressBar} style={{ width: `${progress}%` }} />
            <span>{progress}%</span>
          </div>
        ) : (
          <p>上传文档<br /><small>PDF · DOCX · TXT · MD</small></p>
        )}
      </div>
    </div>
  )
}
