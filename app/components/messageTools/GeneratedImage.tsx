'use client'

import { useState } from "react"
import { Download } from "lucide-react"
import type { MessageAttachment } from "@/app/context/ChatContext"
import { saveFile } from "@/lib/saveFile"
import "./GeneratedImage.scss"

// A picture the AI made. It is kept with the account and served to its owner, so the page only needs its id.
// Without `image` the picture is still being made. Until it is made and loaded, an animated square stands in its
// place, and the download button only comes with the picture.
export default function GeneratedImage({image}: {image?: MessageAttachment}) {
  const src = image ? `/api/attachments/${image.id}` : null
  const [loaded, setLoaded] = useState<boolean>(false)
  const [failed, setFailed] = useState<boolean>(false)

  if(failed) return <p className="generated-image__failed">The picture couldn&#39;t be loaded.</p>

  return (
    <div className="generated-image">
      {!loaded && <div className="generated-image__placeholder" aria-label="Making the picture" role="status" />}

      {image && src && (
        <>
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
            <button type="button" className="generated-image__download" aria-label={`Download ${image.name}`} title="Download" onClick={() => saveFile(src, image.name, image.type)}>
              <Download size={16} />
            </button>
          )}
        </>
      )}
    </div>
  )
}
