'use client'

import axios, { isAxiosError } from "axios"
import "./SendButton.scss"
import { ArrowUp } from "lucide-react"
import { SetStateAction } from "react"

export default function SendButton(
  {text, messageLoading, setMessageLoading, handleSendPrompt} : 
  {
    text: string, 
    messageLoading: boolean, 
    setMessageLoading: React.Dispatch<SetStateAction<boolean>>,
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