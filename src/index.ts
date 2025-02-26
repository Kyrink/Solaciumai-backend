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
        connectSrc: [
          "'self'",
          "https://solacium-ai-frontend.vercel.app",
          "https://solacium-ai-frontend-k00bpjb3z-kyrin-s-projects.vercel.app",
          "https://www.solacium.one",
          "http://localhost:3000",
          "http://localhost:8080"
        ],
        fontSrc: ["'self'", "https:", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        styleSrc: ["'self'", "https:", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: []
      }
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
  res.setHeader('Access-Control-Allow-Credentials', 'true');
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
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: `You are a helpful AI assistant specializing in immigration law and procedures.
            Based on the user's query, provide accurate information from authoritative sources.
            
            You MUST respond with valid JSON in this exact format:
            {
              "response": {
                "mainAnswer": "your direct, concise answer here",
                "steps": [
                  {
                    "title": "step title",
                    "description": "step details",
                    "links": [
                      {
                        "text": "link text",
                        "url": "link url"
                      }
                    ]
                  }
                ],
                "sources": [
                  {
                    "name": "source name",
                    "url": "source url"
                  }
                ],
                "language": "en"
              }
            }
            
            Guidelines:
            1. Keep responses concise and clear
            2. When a yes/no response is sufficient, answer decisively
            3. If the query is unrelated to immigration, respond with a refusal message
            4. Always respond in the user's query language (default: en)
            5. The steps and sources arrays are optional, but mainAnswer and language are required
            6. All URLs must be from authoritative sources
            7. DO NOT include any text outside the JSON structure
            8. Always answer based on US immigration law and procedures unless otherwise specified`
          },
          ...parsedHistory.map((entry: { query: string; response: string }) => [
            { role: "user", content: entry.query },
            { role: "assistant", content: entry.response },
          ]).flat(),
          { role: "user", content: message as string },
        ],
        response_format: { "type": "json_object" },
        temperature: 0.7,
        stream: true,
      },
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      responseType: "stream",
    });

    let buffer = '';
    let hasMainAnswer = false;
    let stepCount = 0;
    let hasShownSources = false;

    openAIResponse.data.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line.trim() === '') continue;
        
        if (line.startsWith("data: ")) {
          const data = line.slice(5).trim();
          
          if (!data || data === "[DONE]") {
            if (buffer.trim()) {
              try {
                const cleanToken = formatBuffer(buffer);
                if (cleanToken.trim()) {
                  res.write(`data: ${JSON.stringify({ token: cleanToken })}\n\n`);
                }
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
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content;

            if (token) {
              buffer += token;
              
              // If we have a complete JSON object
              if (buffer.includes('}')) {
                try {
                  // Try to parse the buffer as JSON
                  const parsedJson = JSON.parse(buffer);
                  
                  // If we successfully parsed the JSON and it has a 'response' object
                  if (parsedJson.response) {
                    const response = parsedJson.response;
                    
                    // Format the response into a well-formatted markdown string
                    let formattedMarkdown = '';
                    
                    // Add main answer
                    formattedMarkdown += response.mainAnswer + '\n\n';
                    
                    // Add steps if any
                    if (response.steps && response.steps.length > 0) {
                      response.steps.forEach((step: any, index: number) => {
                        formattedMarkdown += `**${index + 1}. ${step.title}**\n    ${step.description}\n`;
                        
                        if (step.links && step.links.length > 0) {
                          // Add the first link on the same line as "Helpful links:"
                          formattedMarkdown += `\nHelpful links: [${step.links[0].text}](${step.links[0].url})`;
                          
                          // Add remaining links as bullet points (if any)
                          if (step.links.length > 1) {
                            formattedMarkdown += "\n";
                            step.links.slice(1).forEach((link: any) => {
                              formattedMarkdown += `* [${link.text}](${link.url})\n`;
                            });
                          } else {
                            formattedMarkdown += "\n"; // Just a newline if there's only one link
                          }
                        }
                        
                        formattedMarkdown += '\n';
                      });
                    }
                    
                    // Add sources if any
                    if (response.sources && response.sources.length > 0) {
                      formattedMarkdown += '---\n\n**Sources:**\n';
                      response.sources.forEach((source: any) => {
                        formattedMarkdown += `* [${source.name}](${source.url})\n`;
                      });
                    }
                    
                    // Send the formatted markdown string as token
                    res.write(`data: ${JSON.stringify({ token: formattedMarkdown })}\n\n`);
                    
                    // Also send the structured data for reference
                    res.write(`data: ${JSON.stringify({ structured: response })}\n\n`);
                    
                    buffer = '';
                    hasMainAnswer = true;
                    stepCount = response.steps ? response.steps.length : 0;
                    hasShownSources = true;
                  }
                } catch (parseError) {
                  // Not complete JSON yet, continue accumulating
                  if (buffer.match(/[.!?]\s*$/) || buffer.includes('\n\n')) {
                    const cleanToken = formatBuffer(buffer);
                    if (cleanToken.trim()) {
                      res.write(`data: ${JSON.stringify({ token: cleanToken })}\n\n`);
                    }
                    buffer = '';
                  }
                }
              }
            }
          } catch (parseError) {
            console.error("Error parsing chunk:", parseError);
            continue;
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