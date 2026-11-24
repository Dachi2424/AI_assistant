'use client'

import { useState } from "react"
import { Download, Sparkles } from "lucide-react"
import type { MessageAttachment } from "@/app/context/ChatContext"
import "./GeneratedImage.scss"

// A picture the AI made. It is kept with the account and served to its owner, so the page only needs its id.
// While the picture is still being loaded, an animated square of the same kind of shape takes its place, and the
// download button only comes with the picture.
export default function GeneratedImage({image}: {image: MessageAttachment}) {
  const src = `/api/attachments/${image.id}`
  const [loaded, setLoaded] = useState<boolean>(false)
  const [failed, setFailed] = useState<boolean>(false)

  if(failed) return <p className="generated-image__failed">The picture couldn&#39;t be loaded.</p>

  return (
    <div className="generated-image">
      {!loaded && (
        <div className="generated-image__placeholder" aria-label="Loading the picture" role="status">
          <Sparkles className="generated-image__sparkle" size={32} strokeWidth={1.5} />
        </div>
      )}

      {/* The picture loads while it is hidden, and is shown once it is all there. A picture from our own server, so
          next/image has nothing to optimize. A cached one can be ready before the page listens, so it is checked too */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={element => { if(element?.complete && element.naturalWidth > 0) setLoaded(true) }}
        className={`generated-image__picture ${loaded ? "generated-image__picture--ready" : ""}`}
        src={src}
        alt={image.name}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />

      {loaded && (
        // same address with the download attribute, so the browser saves it under its name
        <a className="generated-image__download" href={src} download={image.name} aria-label={`Download ${image.name}`} title="Download">
          <Download size={16} />
        </a>
      )}
    </div>
  )
}
