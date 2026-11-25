'use client'

import { Download, FileText } from "lucide-react"
import { downloadCreatedFile, type CreatedFile } from "@/lib/createdFiles"
import "./FileCard.scss"

// A file the AI created. The content is already in the browser, so the download is made from it.
export default function FileCard({file}: {file: CreatedFile}) {
  return (
    <div className="file-card">
      <FileText size={28} className="file-card__icon" />
      <span className="file-card__name" title={file.name}>{file.name}</span>
      <button type="button" className="file-card__download" aria-label={`Download ${file.name}`} onClick={() => downloadCreatedFile(file)}>
        <Download size={16} />
        Download
      </button>
    </div>
  )
}
