'use client'

import Input from "./Input"
import "./ChatInputBox.scss"
import Attach from "./attachmentOpion/Attach"
import SendButton from "./SendButton"
import { useEffect, useState } from "react"
import axios, { isAxiosError } from "axios"

export default function ChatInputBox() {
  const [text, setText] = useState<string>("")
  const [messageLoading, setMessageLoading] = useState<boolean>(false)
  useEffect(() => {
    const saved = localStorage.getItem("prompt")
    if(saved){
      setText(saved)
      localStorage.removeItem("prompt")
    }
  }, [])


  async function handleSendPrompt(){
    function sendMessage(){
      return axios.post("/api/chat", {message: text})
    }
    setMessageLoading(true)
    try{
      const res = await sendMessage()
      console.log(res)
      setText("")
    }catch(err){
        if(!isAxiosError(err) || err.response?.status !== 401){
          return console.error(err)
        }       

        try{
          await axios.get("/api/auth/refresh")
        } catch{
          localStorage.setItem("prompt", text)
          window.location.href = "/api/auth/google"
          return;
        }

        try{
          const res = await sendMessage()
          console.log(res)
          setText("")
        } catch(err){
          throw new Error(isAxiosError(err) ? err.message : "Something went wrong, please try again")
        }
    } finally{
      setMessageLoading(false)
    }
  }




  return (
    <div className="chat-box">
      <h1 className="chat-box__title">What&#39;s on your mind today?</h1>
      <div className="chat-box__input-container">
        <Input 
          text={text} 
          setText={setText} 
          handleSendPrompt={handleSendPrompt}  
        />
        <div className="chat-box__lower-container">
          <Attach />
          <SendButton 
            text={text} 
            messageLoading={messageLoading} 
            setMessageLoading={setMessageLoading} 
            handleSendPrompt={handleSendPrompt} 
          />
        </div>
      </div>
    </div>
  )
}