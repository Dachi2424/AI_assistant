'use client'

import "./SendButton.scss"
import { ArrowUp } from "lucide-react"

export default function SendButton(
  {text, hasFiles, messageLoading, handleSendPrompt} :
  {
    text: string,
    // files are attached, so a message can be sent without any text
    hasFiles: boolean,
    messageLoading: boolean,
    handleSendPrompt: () => void
}) {

  

  

  return (
    <button 
      className="button"
      disabled={(!text && !hasFiles) || messageLoading}
      onClick={handleSendPrompt}
    >
      {!messageLoading ? (
        <ArrowUp 
          strokeWidth={2}
          size={16}
          color="white"  
        />
      ): (
        <div className="button__loader"></div>
      )}
      
    </button>
  )
}