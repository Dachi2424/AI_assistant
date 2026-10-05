'use client'

import React, { SetStateAction, useRef, useLayoutEffect } from "react"
import "./Input.scss"

export default function Input({text, setText}: {text: string, setText: React.Dispatch<SetStateAction<string>>}) {
  
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if(!el) return
    
    el.style.overflowY = "hidden"
    el.style.height = "auto"
    
    const maxHeight = parseFloat(getComputedStyle(el).lineHeight) * 15
    el.style.height = `${el.scrollHeight}px` 
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden"
  }, [text])

  return (
    <div className="input">
      <textarea 
        ref={ref}
        className="input__input" 
        onChange={e => setText(e.target.value)}
        value={text}      
        rows={1}
      />
      {!text && <span className="input__placeholder">Ask anything...</span>}
    </div>
  )
}