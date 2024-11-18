// src/index.ts
import express, { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
    origin: 'http://localhost:3000', // or whatever port your frontend is running on
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
})); // Allow cross-origin requests
app.use(express.json()); // Parse JSON request bodies

// Add a test GET endpoint
app.get("/", (req: Request, res: Response) => {
  res.json({ message: "Server is running" });
});

// Define the proxy endpoint
app.post("/api/langflow", async (req: Request, res: Response) => {
  try {
    const { input_value, input_type, output_type, tweaks } = req.body;
    
    const response = await axios.post(
      `https://api.langflow.astra.datastax.com/lf/${process.env.LANGFLOW_ID}/api/v1/run/${process.env.FLOW_ID}`,
      {
        input_value,
        input_type,
        output_type,
        tweaks
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LANGFLOW_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    res.json(response.data);
  } catch (error: any) {
    console.error("Error in proxy request:", error.response ? error.response.data : error.message || error);
    res.status(error.response?.status || 500).send("Error in proxy request");
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});