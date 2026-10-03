import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI
if(!uri){
  throw new Error("MONGODB_URI is not found")
}

const client = new MongoClient(uri)
export async function connectToDatabase(){
  await client.connect()

  return client.db("ai-assistant")
}