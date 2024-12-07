// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware: CORS
app.use(
  cors({
    origin: [
      "https://solacium-ai-frontend.vercel.app",
      "https://solacium-ai-frontend-hy7kqaexw-kyrin-s-projects.vercel.app",
      "http://localhost:3000", // for local development
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin"],
    credentials: true,
    exposedHeaders: ["Content-Type", "Authorization"],
  })
);

// Middleware: JSON Parsing
app.use(express.json());

// Middleware: Helmet (for security)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "https://solacium-ai-frontend.vercel.app"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
  })
);

// Route: SSE Chat
app.get("/api/chat", async (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.flushHeaders();
  
  try {
    const { message, history } = req.query;

    if (!process.env.OPENAI_API_KEY) {
      res.write(`data: ${JSON.stringify({ error: "OpenAI API key is not configured" })}\n\n`);
      res.end();
      return;
    }

    const parsedHistory = history ? JSON.parse(decodeURIComponent(history as string)) : [];

    const openAIResponse = await axios({
      method: "post", 
      url: "https://api.openai.com/v1/chat/completions",
      data: {
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `
            You are a helpful AI assistant specializing in immigration law and procedures. 
            Based on the user's query, perform a targeted search of recent, credible information on immigration from authoritative sources, such as government websites, legal advisories, and trusted immigration resources. 
            Provide a concise, accurate response addressing the user's question directly.

            - Always respond in the same language as the user's query.
            - For immigration-related queries, translate and tailor your response to align with the grammar, style, and nuances of the user's language.
            - If a yes or no response is sufficient, answer decisively without prefacing with unnecessary phrases.
            - Ensure simplicity, clarity, and brevity in responses.

            If additional information is helpful, include a Markdown link without accompanying text for seamless navigation:

            - Always return responses in Markdown format.
            FORMATTING GUIDELINES:
            - Use **bold** for important terms, deadlines, or document names
            - Use *italics* for emphasis or definitions
            - Create clear paragraphs with line breaks
            - Use numbered lists (1., 2., 3.) for sequential steps
            - Use bullet points (*) for non-sequential items
            - Create section headers with ###
            - Include links in [text](url) format
            - Indent sub-points when needed
            - Use > for important quotes or notes
            - Keep formatting natural and intuitive

            - For queries unrelated to immigration, respond in the user's language with: 
              "I am an AI agent designed to assist with immigration-related questions. I cannot help with this."
            - If no relevant information is found, respond with "No information found" in the user's language.

            Ensure all responses reflect conversational tone, clarity, and accessibility, respecting linguistic and cultural accuracy.
            `,
          },
          ...parsedHistory.map((entry: { query: string; response: string }) => [
            { role: "user", content: entry.query },
            { role: "assistant", content: entry.response },
          ]).flat(),
          { role: "user", content: message },
        ],
        stream: true,
      },
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      responseType: "stream",
    });

    let buffer = '';
    openAIResponse.data.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(5).trim();
          
          // Skip empty data lines
          if (!data) continue;
          
          if (data === "[DONE]") {
            if (buffer.trim()) {
              res.write(`data: ${JSON.stringify({ token: buffer.trim() })}\n\n`);
            }
            res.write(`data: [DONE]\n\n`);
            res.end();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              buffer += token;
              
              // Only send when we have a complete sentence or significant chunk
              if (buffer.match(/[.!?]\s*$/) || buffer.length > 100) {
                const cleanToken = buffer
                  .replace(/\n{2,}/g, '\n')
                  .replace(/\s{2,}/g, ' ')
                  .trim();
                
                if (cleanToken) {
                  res.write(`data: ${JSON.stringify({ token: cleanToken })}\n\n`);
                  buffer = '';
                }
              }
            }
          } catch (err) {
            // Log the problematic data for debugging
            console.error("Error parsing SSE chunk. Data:", data);
            console.error("Error details:", err);
            // Continue processing without breaking the stream
            continue;
          }
        }
      }
    });

    // Handle stream end
    openAIResponse.data.on("end", () => {
      // Send any remaining buffer content
      if (buffer.trim()) {
        res.write(`data: ${JSON.stringify({ token: buffer.trim() })}\n\n`);
      }
      res.write(`data: [DONE]\n\n`);
      res.end();
    });

    // Handle stream errors
    openAIResponse.data.on("error", (error: any) => {
      console.error("Stream error:", error);
      res.write(`data: ${JSON.stringify({ error: "Stream error occurred" })}\n\n`);
      res.end();
    });

    req.on("close", () => {
      openAIResponse.data.destroy();
      res.end();
    });
  } catch (error: any) {
    console.error("Error in SSE handler:", error.message);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// Middleware: Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Error:", err);
  res.status(500).json({ error: err.message });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});