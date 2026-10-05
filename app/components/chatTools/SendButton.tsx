import "./SendButton.scss"
import { ArrowUp } from "lucide-react"

export default function SendButton({text} : {text: string}) {

  return (
    <button 
      className="button"
      disabled={!text}  
    >
      <ArrowUp 
        strokeWidth={2}
        size={16}
        color="white"  
      />
    </button>
  )
}