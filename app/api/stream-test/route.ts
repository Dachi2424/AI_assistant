import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

export async function POST(request: Request){
  try{
    const {content} = await request.json()

    const stream = await ai.models.generateContentStream({
      model: "gemini-3.6-flash",
      contents: {
        parts: [{text: content}]
      }
    })

    const encoder = new TextEncoder()

    async function sendChunks(controller: ReadableStreamDefaultController){
      for await (const chunk of stream){
        if(chunk.text) controller.enqueue(encoder.encode(chunk.text))
      }
      controller.close()
    }
    
    const readable = new ReadableStream({ start: sendChunks })

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    })
  } catch(err){
    console.error(err)
    return Response.json(
      {error: "Something went wrong"},
      {status: 500}
    )
  }
}