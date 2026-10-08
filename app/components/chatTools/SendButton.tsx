'use client'

import "./SendButton.scss"
import { ArrowUp } from "lucide-react"

export default function SendButton(
  {text, messageLoading, handleSendPrompt} : 
  {
    text: string, 
    messageLoading: boolean, 
    handleSendPrompt: () => void
}) {

  

  

  return (
    <button 
      className="button"
      disabled={!text || messageLoading}  
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