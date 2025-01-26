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
      "https://solacium-ai-frontend-k00bpjb3z-kyrin-s-projects.vercel.app",
      "https://www.solacium.one",
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
            Based on the user's query, perform a targeted search of recent,
            credible information on immigration from authoritative sources, such as government websites, legal advisories, and trusted immigration resources.
            Provide responses in a structured JSON format with the following schema:
            {
              "response": {
                "mainAnswer": string,  // Direct, concise answer to the query
                "steps": [{           // Optional array of steps if applicable
                  "title": string,    // Step title/header
                  "description": string, // Step details
                  "links": [{         // Optional relevant links
                    "text": string,   // Link text
                    "url": string     // Link URL
                  }]
                }],
                "sources": [{        // Optional authoritative sources
                  "name": string,    // Source name
                  "url": string      // Source URL
                }],
                "language": string   // Response language code (e.g. "en", "es")
              }
            }
            
            Keep responses concise and clear. When a yes/no response is sufficient, answer decisively without prefacing.
            If the query is unrelated to immigration, respond with a refusal message in the same language.
            Always respond in the user's query language.
            `,
          },
          ...parsedHistory.map((entry: { query: string; response: string }) => [
            { role: "user", content: entry.query },
            { role: "assistant", content: entry.response },
          ]).flat(),
          { role: "user", content: message },
        ],
        response_format: { 
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              response: {
                type: "object",
                properties: {
                  mainAnswer: { type: "string" },
                  steps: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        links: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              text: { type: "string" },
                              url: { type: "string" }
                            },
                            required: ["text", "url"],
                            additionalProperties: false
                          }
                        }
                      },
                      required: ["title", "description"],
                      additionalProperties: false
                    }
                  },
                  sources: {
                    type: "array", 
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        url: { type: "string" }
                      },
                      required: ["name", "url"],
                      additionalProperties: false
                    }
                  },
                  language: { type: "string" }
                },
                required: ["mainAnswer", "language"],
                additionalProperties: false
              }
            },
            required: ["response"],
            additionalProperties: false
          }
        },
        stream: true,
      },
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      responseType: "stream",
    });

    let buffer = '';

    openAIResponse.data.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(5).trim(); // Remove "data: " prefix
    
          // Handle end of stream or flush remaining buffer
          if (!data || data === "[DONE]") {
            if (buffer.trim()) {
              try {
                const cleanToken = formatBuffer(buffer);
                res.write(`data: ${JSON.stringify({ token: cleanToken })}\n\n`);
                buffer = '';
              } catch (err) {
                console.error("Error processing buffer content:", err);
              }
            }
            if (data === "[DONE]") {
              res.write(`data: [DONE]\n\n`);
              res.end();
              return;
            }
            continue;
          }
    
          try {
            // Handle partial JSON chunks
            let jsonData = data;
            try {
              const parsed = JSON.parse(jsonData);
              const token = parsed.choices?.[0]?.delta?.content;
    
              if (token) {
                buffer += token;
                
                // Try to parse accumulated buffer as JSON when we have a complete object
                if (buffer.includes('}')) {
                  try {
                    const parsedJson = JSON.parse(buffer);
                    // If successful parse, send the structured response
                    res.write(`data: ${JSON.stringify({ 
                      structured: true,
                      response: parsedJson.response 
                    })}\n\n`);
                    buffer = '';
                  } catch (parseError) {
                    // Not complete JSON yet, continue accumulating
                    if (buffer.match(/[.!?]\s*$/) || buffer.includes('\n\n')) {
                      const cleanToken = formatBuffer(buffer);
                      res.write(`data: ${JSON.stringify({ token: cleanToken })}\n\n`);
                      buffer = '';
                    }
                  }
                }
              }
            } catch (parseError) {
              console.log("Incomplete JSON chunk received:", jsonData);
              continue;
            }
          } catch (err: unknown) {
            console.error("Stream processing error:", err instanceof Error ? err.message : String(err));
          }
        }
      }
    });
    
    // Helper function to format the buffer content
    function formatBuffer(buffer: string) {
      return buffer
        .replace(
          /\[(.*?)\]\(\[Click here\]\((.*?)\)\)/g,
          (_, text, url) => `[${text}](${url})`
        ) // Properly format nested "Click here" links
        .replace(/\[Click here\]/g, '') // Remove redundant "Click here"
        .replace(/\(\s*Click here\s*\)/g, '') // Remove remaining parentheses with "Click here"
        .replace(/\s*\)\)/g, ')') // Remove double closing parentheses
        .trim(); // Remove extra spaces
    }

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