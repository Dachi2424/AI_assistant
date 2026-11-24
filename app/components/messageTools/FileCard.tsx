'use client'

import { Download, FileText } from "lucide-react"
import type { CreatedFile } from "@/lib/createdFiles"
import "./FileCard.scss"

// A file the AI created. The content is already in the browser, so the download is made here from it.
export default function FileCard({file}: {file: CreatedFile}) {
  function download(){
    const url = URL.createObjectURL(new Blob([file.content], {type: `${file.type};charset=utf-8`}))
    const link = document.createElement("a")
    link.href = url
    link.download = file.name
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="file-card">
      <FileText size={28} className="file-card__icon" />
      <span className="file-card__name" title={file.name}>{file.name}</span>
      <button type="button" className="file-card__download" aria-label={`Download ${file.name}`} onClick={download}>
        <Download size={16} />
        Download
      </button>
    </div>
  )
}
