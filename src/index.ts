// src/index.ts
import express, { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
}));
app.use(express.json());

app.get("/api/chat", async (req: Request, res: Response) => {
  try {
    const message = req.query.message as string;
    
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key is not configured");
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4",
        messages: [
          { 
            role: "system", 
            content: "You are a helpful AI assistant specializing in immigration law and procedures. Based on the user's query, perform a targeted search of recent, credible information on immigration from authoritative sources, such as government websites, legal advisories, and trusted immigration resources. Provide a concise, accurate response addressing the user's question directly.\n\nWhen a yes or no response is sufficient, answer decisively without prefacing with unnecessary phrases. Aim for simplicity, clarity, and brevity in all responses.\n\nIf applicable and for users seeking additional information, include a Markdown link without accompanying text for seamless navigation:\n\n- Example: [Understanding Work Permit Extensions for Asylum Seekers](#)\n\nReturn the response in Markdown format, ensuring the main response is conversational, clear, and very concise. The response should focus on directly answering the query, with supplemental information accessible through a link when relevant. if there is no relevant information, respond with 'No information found'." 
          },
          { 
            role: "user", 
            content: message 
          }
        ],
        stream: true,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        responseType: 'stream'
      }
    );

    // Handle the stream
    response.data.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      
      for (const line of lines) {
        if (line.trim().startsWith('data: ')) {
          const data = line.slice(6);
          
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            
            if (content) {
              // Send each token immediately
              res.write(`data: ${JSON.stringify({ token: content })}\n\n`);
            }
          } catch (error) {
            console.error('Error parsing chunk:', error);
          }
        }
      }
    });

    response.data.on('end', () => {
      res.write('event: done\ndata: stream ended\n\n');
      res.end();
    });

  } catch (error: any) {
    console.error("Error details:", error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});